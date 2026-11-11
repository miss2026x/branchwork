import { describe, expect, it } from "vitest";
import { createClaudeClient, type ClaudeEvent, type SdkFunctions } from "../../src/claude";

type Msg = Record<string, unknown>;
const init = { type: "system", subtype: "init", session_id: "S1" };
const delta = (text: string) => ({ type: "stream_event", session_id: "S1", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
const assistant = (...content: Msg[]) => ({ type: "assistant", session_id: "S1", parent_tool_use_id: null, message: { content } });
const success = { type: "result", subtype: "success", is_error: false, terminal_reason: "completed", session_id: "S1" };

/** 假的 SDK：query 依次吐出给定的消息 */
function fakeSdk(messages: Msg[], extra: Partial<SdkFunctions> & { onQuery?: (p: { prompt: string; options?: Record<string, unknown> }) => void; throwAfter?: Error } = {}) {
  const transcript = [
    { type: "user", uuid: "u1", message: { content: "第一站" } },
    { type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "好" }] } },
    { type: "user", uuid: "u2", message: { content: [{ type: "text", text: "第二站" }] } },
    { type: "assistant", uuid: "a2", message: { content: [{ type: "tool_use", name: "Edit", input: {} }] } },
    { type: "user", uuid: "t2", message: { content: [{ type: "tool_result", content: "ok" }] } },
    { type: "assistant", uuid: "a3", message: { content: [{ type: "text", text: "改好了" }] } },
  ];
  const fns: SdkFunctions = {
    query: (p) => {
      extra.onQuery?.(p as never);
      return (async function* () {
        for (const m of messages) yield m;
        if (extra.throwAfter) throw extra.throwAfter;
      })();
    },
    forkSession: async (_id, o) => ({ sessionId: `fork-up-to-${o?.upToMessageId ?? "end"}` }),
    getSessionMessages: async () => transcript,
    deleteSession: async () => {},
    ...extra,
  };
  return fns;
}

describe("Claude 封装：把 SDK 的消息流变成“一站的结果”", () => {
  it("正常结束：流式文字和工具作为事件发出，结果里有完整文字、会话 ID 和这一站的起止消息", async () => {
    const events: ClaudeEvent[] = [];
    let seen: { prompt: string; options?: Record<string, unknown> } | undefined;
    const client = createClaudeClient(
      fakeSdk([init, delta("改"), delta("好了"), assistant({ type: "tool_use", name: "Edit", input: { file_path: "a.ts" } }), assistant({ type: "text", text: "改好了" }), success], {
        onQuery: (p) => (seen = p),
      }),
    );
    const r = await client.ask({ cwd: "/wt/r1", prompt: "第二站", sessionId: "S1", afterMessageId: "a1", onEvent: (e) => events.push(e) });
    expect(r).toEqual({ outcome: "completed", sessionId: "S1", text: "改好了", error: null, promptMessageId: "u2", lastMessageId: "a3" });
    expect(events).toEqual([
      { type: "started" },
      { type: "text", text: "改" },
      { type: "text", text: "好了" },
      { type: "tool", tool: "Edit", input: { file_path: "a.ts" } },
    ]);
    expect(seen?.prompt).toBe("第二站");
    expect(seen?.options).toMatchObject({ cwd: "/wt/r1", resume: "S1", includePartialMessages: true });
  });

  it("新会话不传 resume；会话 ID 从消息里取", async () => {
    let seen: Record<string, unknown> | undefined;
    const client = createClaudeClient(fakeSdk([init, success], { onQuery: (p) => (seen = p.options) }));
    const r = await client.ask({ cwd: "/wt", prompt: "第一站" });
    expect(seen).not.toHaveProperty("resume");
    expect(r).toMatchObject({ sessionId: "S1", promptMessageId: "u1" });
  });

  it.each([
    ["error_max_turns", { subtype: "error_max_turns", is_error: true, errors: ["hit max turns"] }, "hit max turns"],
    ["error_during_execution", { subtype: "error_during_execution", is_error: true, errors: [] }, "error_during_execution"],
    ["success 但 is_error", { subtype: "success", is_error: true, terminal_reason: "api_error" }, "api_error"],
    ["success 但没走完", { subtype: "success", is_error: false, terminal_reason: "max_turns" }, "max_turns"],
  ])("结果是 %s：算失败，不算正常结束", async (_name, result, error) => {
    const client = createClaudeClient(fakeSdk([init, { type: "result", session_id: "S1", ...result }]));
    expect(await client.ask({ cwd: "/wt", prompt: "x" })).toMatchObject({ outcome: "failed", error });
  });

  it("停车：SDK 抛出 Operation aborted，算没答完而不是失败", async () => {
    const ac = new AbortController();
    const client = createClaudeClient(
      fakeSdk([init, delta("写到一")], {
        query: () =>
          (async function* () {
            yield init;
            yield delta("写到一");
            ac.abort();
            throw new Error("Operation aborted");
          })(),
      }),
    );
    const r = await client.ask({ cwd: "/wt", prompt: "x", signal: ac.signal });
    expect(r).toMatchObject({ outcome: "interrupted", error: null, sessionId: "S1" });
  });

  it("消息流断了却没有结果消息（进程崩溃）：算没答完", async () => {
    const client = createClaudeClient(fakeSdk([init, assistant({ type: "text", text: "半截" })]));
    expect(await client.ask({ cwd: "/wt", prompt: "x" })).toMatchObject({ outcome: "interrupted", text: "半截" });
  });

  it("结果标着被中止：算没答完", async () => {
    const client = createClaudeClient(fakeSdk([init, { type: "result", subtype: "success", is_error: false, terminal_reason: "aborted_tools", session_id: "S1" }]));
    expect(await client.ask({ cwd: "/wt", prompt: "x" })).toMatchObject({ outcome: "interrupted" });
  });

  it("不是停车造成的异常：算失败并带上原因", async () => {
    const client = createClaudeClient(fakeSdk([init], { throwAfter: new Error("Native CLI binary not found") }));
    expect(await client.ask({ cwd: "/wt", prompt: "x" })).toMatchObject({ outcome: "failed", error: "Native CLI binary not found" });
  });

  it("子任务（subagent）的文字不算进这一站的回答", async () => {
    const sub = { type: "assistant", session_id: "S1", parent_tool_use_id: "tool-1", message: { content: [{ type: "text", text: "子任务的话" }] } };
    const client = createClaudeClient(fakeSdk([init, sub, assistant({ type: "text", text: "主回答" }), success]));
    expect((await client.ask({ cwd: "/wt", prompt: "x" })).text).toBe("主回答");
  });

  it("等你批准：允许、以后都允许、拒绝分别对应 SDK 的三种回答", async () => {
    const suggestions = [{ type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" }];
    const answers: unknown[] = [];
    const seenByUser: unknown[] = [];
    const run = (decision: "allow" | "allow-always" | "deny", withSuggestions = true) =>
      createClaudeClient(
        fakeSdk([], {
          query: (p) =>
            (async function* () {
              yield init;
              const canUseTool = (p.options as { canUseTool: (...a: unknown[]) => Promise<unknown> }).canUseTool;
              answers.push(await canUseTool("Bash", { command: "npm test" }, { signal: new AbortController().signal, suggestions: withSuggestions ? suggestions : undefined }));
              yield success;
            })(),
        }),
      ).ask({
        cwd: "/wt",
        prompt: "x",
        onPermission: async (req) => {
          seenByUser.push(req);
          return decision;
        },
      });
    await run("allow");
    await run("allow-always");
    await run("deny");
    await run("allow", false);
    expect(answers[0]).toEqual({ behavior: "allow", updatedInput: { command: "npm test" } });
    expect(answers[1]).toEqual({ behavior: "allow", updatedInput: { command: "npm test" }, updatedPermissions: suggestions });
    expect(answers[2]).toMatchObject({ behavior: "deny" });
    expect(seenByUser[0]).toEqual({ tool: "Bash", input: { command: "npm test" }, canRemember: true });
    expect(seenByUser[3]).toMatchObject({ canRemember: false });
  });

  it("没有人能批准时一律拒绝", async () => {
    let answer: unknown;
    await createClaudeClient(
      fakeSdk([], {
        query: (p) =>
          (async function* () {
            answer = await (p.options as { canUseTool: (...a: unknown[]) => Promise<unknown> }).canUseTool("Write", {}, { signal: new AbortController().signal });
            yield success;
          })(),
      }),
    ).ask({ cwd: "/wt", prompt: "x" });
    expect(answer).toMatchObject({ behavior: "deny" });
  });

  it("分叉把“到哪条消息为止”交给 SDK；历史按消息返回", async () => {
    const client = createClaudeClient(fakeSdk([]));
    expect(await client.fork("S1", "a1")).toBe("fork-up-to-a1");
    expect(await client.fork("S1")).toBe("fork-up-to-end");
    const h = await client.history("S1");
    expect(h).toHaveLength(6);
    expect(h[0]).toEqual({ id: "u1", role: "user", content: "第一站" });
  });
});
