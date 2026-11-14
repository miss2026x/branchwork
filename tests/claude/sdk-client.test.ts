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
    startup: async () => {
      throw new Error("这个测试没有用到提前启动");
    },
    forkSession: async (_id, o) => ({ sessionId: `fork-up-to-${o?.upToMessageId ?? "end"}` }),
    getSessionMessages: async () => transcript,
    deleteSession: async () => {},
    listSessions: async () => [
      { sessionId: "s-new", summary: "摘要", lastModified: 2, firstPrompt: "看一下  过期问题" },
      { sessionId: "s-old", summary: "旧的", lastModified: 1, customTitle: "自己起的名" },
    ],
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
    expect(r).toEqual({ outcome: "completed", sessionId: "S1", text: "改好了", error: null, promptMessageId: "u2", lastMessageId: "a3", contextTokens: null });
    expect(events).toEqual([
      { type: "started" },
      { type: "text", text: "改" },
      { type: "text", text: "好了" },
      { type: "tool", tool: "Edit", input: { file_path: "a.ts" } },
      { type: "answered" },
    ]);
    expect(seen?.prompt).toBe("第二站");
    expect(seen?.options).toMatchObject({ cwd: "/wt/r1", resume: "S1", includePartialMessages: true });
  });

  it("环境说明接在 Claude Code 自带的系统提示后面；提前启动的进程也带着", async () => {
    const seen: unknown[] = [];
    const fns = fakeSdk([init, success], {
      onQuery: (p) => seen.push((p.options as { systemPrompt: unknown }).systemPrompt),
      startup: async (p) => {
        seen.push((p.options as { systemPrompt: unknown }).systemPrompt);
        throw new Error("不用真的启动");
      },
    });
    const client = createClaudeClient(fns, { appendSystemPrompt: "你在 Branchwork 里" });
    client.warm("/wt");
    await client.ask({ cwd: "/wt", prompt: "x" });
    expect(seen).toEqual([
      { type: "preset", preset: "claude_code", append: "你在 Branchwork 里" },
      { type: "preset", preset: "claude_code", append: "你在 Branchwork 里" },
    ]);
    const plain: unknown[] = [];
    await createClaudeClient(fakeSdk([init, success], { onQuery: (p) => plain.push((p.options as { systemPrompt: unknown }).systemPrompt) })).ask({ cwd: "/wt", prompt: "x" });
    expect(plain).toEqual([{ type: "preset", preset: "claude_code" }]);
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

describe("提前启动：启动 Claude 要几十秒的机器上，问的时候不用再等", () => {
  /** 假的 SDK：记录每次 startup / query；startup 要手动放行才算启动完 */
  function warmSdk() {
    const log: string[] = [];
    const starts: { options: Record<string, unknown>; finish: () => void; fail: () => void; closed: boolean }[] = [];
    const turn = (label: string, options: Record<string, unknown>) =>
      (async function* () {
        log.push(label);
        yield { type: "system", subtype: "init", session_id: (options.resume as string) ?? "NEW" };
        yield success;
      })();
    const fns = fakeSdk([], {
      query: (p) => turn(`cold:${p.prompt}`, p.options as never),
      startup: (p) =>
        new Promise((resolve, reject) => {
          const s = {
            options: p.options as Record<string, unknown>,
            closed: false,
            finish: () => resolve({ query: (prompt: string) => turn(`warm:${prompt}`, p.options as never), close: () => void (s.closed = true) }),
            fail: () => reject(new Error("startup timeout")),
          };
          starts.push(s);
        }),
    });
    return { fns, log, starts };
  }

  it("提前启动好了：直接用它问，不再现启动；一个进程只用一次", async () => {
    const { fns, log, starts } = warmSdk();
    const client = createClaudeClient(fns);
    client.warm("/wt/r1", "S1");
    client.warm("/wt/r1", "S1"); // 重复要求不会启动第二个
    expect(starts).toHaveLength(1);
    expect(starts[0]!.options).toMatchObject({ cwd: "/wt/r1", resume: "S1" });
    starts[0]!.finish();
    const events: ClaudeEvent[] = [];
    expect(await client.ask({ cwd: "/wt/r1", prompt: "第三站", sessionId: "S1", onEvent: (e) => events.push(e) })).toMatchObject({ outcome: "completed" });
    expect(events[0]).toEqual({ type: "started" });
    await client.ask({ cwd: "/wt/r1", prompt: "第四站", sessionId: "S1" });
    expect(log).toEqual(["warm:第三站", "cold:第四站"]);
  });

  it("还在启动时就问了：等它启动完再用，不另起一个", async () => {
    const { fns, log, starts } = warmSdk();
    const client = createClaudeClient(fns);
    client.warm("/wt/r1");
    const asking = client.ask({ cwd: "/wt/r1", prompt: "第一站" });
    await new Promise((r) => setTimeout(r, 10));
    expect(log).toEqual([]);
    starts[0]!.finish();
    await asking;
    expect(log).toEqual(["warm:第一站"]);
  });

  it("提前启动失败：问的时候照常现启动，不报错", async () => {
    const { fns, log, starts } = warmSdk();
    const client = createClaudeClient(fns);
    client.warm("/wt/r1", "S1");
    starts[0]!.fail();
    expect(await client.ask({ cwd: "/wt/r1", prompt: "x", sessionId: "S1" })).toMatchObject({ outcome: "completed" });
    expect(log).toEqual(["cold:x"]);
  });

  it("同一个目录里问的是别的会话（比如提炼摘要的临时会话）：现启动，不动为这一路准备好的那个", async () => {
    const { fns, log, starts } = warmSdk();
    const client = createClaudeClient(fns);
    client.warm("/wt/r1", "S1");
    starts[0]!.finish();
    await client.ask({ cwd: "/wt/r1", prompt: "提炼", sessionId: "TEMP" });
    expect(log).toEqual(["cold:提炼"]);
    expect(starts[0]!.closed).toBe(false);
    await client.ask({ cwd: "/wt/r1", prompt: "下一站", sessionId: "S1" });
    expect(log).toEqual(["cold:提炼", "warm:下一站"]);
  });

  it("这一路换了会话后再准备：旧的关掉，换成新的", async () => {
    const { fns, starts } = warmSdk();
    const client = createClaudeClient(fns);
    client.warm("/wt/r1", "OLD");
    starts[0]!.finish();
    client.warm("/wt/r1", "NEW");
    await new Promise((r) => setTimeout(r, 0));
    expect(starts[0]!.closed).toBe(true);
    expect(starts[1]!.options).toMatchObject({ resume: "NEW" });
  });

  it("最多同时留 3 个，最旧的被关掉；dispose 全部关掉；maxWarm 为 0 时不提前启动", async () => {
    const { fns, starts } = warmSdk();
    const client = createClaudeClient(fns);
    for (const r of ["a", "b", "c", "d"]) client.warm(`/wt/${r}`);
    starts.forEach((s) => s.finish());
    await new Promise((r) => setTimeout(r, 0));
    expect(starts.map((s) => s.closed)).toEqual([true, false, false, false]);
    client.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(starts.map((s) => s.closed)).toEqual([true, true, true, true]);

    const off = warmSdk();
    createClaudeClient(off.fns, { maxWarm: 0 }).warm("/wt/a");
    expect(off.starts).toHaveLength(0);
  });

  it("用提前启动的进程时，批准和停车照样有效", async () => {
    const decisions: unknown[] = [];
    const ac = new AbortController();
    const fns = fakeSdk([], {
      startup: async (p) => ({
        close: () => {},
        query: () =>
          (async function* () {
            const o = p.options as { canUseTool: (...a: unknown[]) => Promise<unknown>; abortController: AbortController };
            decisions.push(await o.canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal }));
            ac.abort();
            if (o.abortController.signal.aborted) throw new Error("Operation aborted");
            yield success;
          })(),
      }),
    });
    const client = createClaudeClient(fns);
    client.warm("/wt/r1");
    const r = await client.ask({ cwd: "/wt/r1", prompt: "x", signal: ac.signal, onPermission: async () => "allow" });
    expect(decisions[0]).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });
    expect(r.outcome).toBe("interrupted");
  });
});

describe("模型、应用自己的工具、起名", () => {
  const options = async (run: (client: ReturnType<typeof createClaudeClient>) => Promise<unknown>) => {
    let seen: Record<string, unknown> | undefined;
    const client = createClaudeClient(fakeSdk([init, success], { onQuery: (p) => (seen = p.options) }));
    await run(client);
    return seen!;
  };

  it("选了模型就交给 SDK；没选不传", async () => {
    expect(await options((c) => c.ask({ cwd: "/wt", prompt: "x", model: "opus" }))).toMatchObject({ model: "opus" });
    expect(await options((c) => c.ask({ cwd: "/wt", prompt: "x" }))).not.toHaveProperty("model");
  });

  it("提前启动的进程用的是另一个模型：不能用，关掉后现启动", async () => {
    const log: string[] = [];
    let closed = false;
    const turn = (label: string) =>
      (async function* () {
        log.push(label);
        yield init;
        yield success;
      })();
    const client = createClaudeClient(
      fakeSdk([], {
        query: (p) => turn(`cold:${String((p.options as { model?: string }).model)}`),
        startup: async (p) => ({ query: () => turn(`warm:${String((p.options as { model?: string }).model)}`), close: () => void (closed = true) }),
      }),
    );
    client.warm("/wt", undefined, "sonnet");
    await client.ask({ cwd: "/wt", prompt: "x", model: "opus" });
    expect(log).toEqual(["cold:opus"]);
    await new Promise((r) => setImmediate(r));
    expect(closed).toBe(true);
    // 模型对得上就用提前启动的
    client.warm("/wt", "S1", "opus");
    await client.ask({ cwd: "/wt", prompt: "y", sessionId: "S1", model: "opus" });
    expect(log).toEqual(["cold:opus", "warm:opus"]);
  });

  it("应用自己的工具挂到 Claude 上；只读的不问批准，别的问批准时用给人看的名字", async () => {
    const asked: unknown[] = [];
    const answers: unknown[] = [];
    const calls: unknown[] = [];
    const client = createClaudeClient(
      fakeSdk([], {
        query: (p) =>
          (async function* () {
            yield init;
            const o = p.options as { canUseTool: (...a: unknown[]) => Promise<unknown>; mcpServers: Record<string, { type: string; name: string }> };
            expect(Object.keys(o.mcpServers)).toEqual(["branchwork"]);
            expect(o.mcpServers.branchwork).toMatchObject({ type: "sdk", name: "branchwork" });
            const extra = { signal: new AbortController().signal };
            answers.push(await o.canUseTool("mcp__branchwork__peek", { id: "t1" }, extra));
            answers.push(await o.canUseTool("mcp__branchwork__launch", { command: "npm run dev" }, extra));
            yield assistant({ type: "tool_use", name: "mcp__branchwork__launch", input: { command: "npm run dev" } });
            yield success;
          })(),
      }),
    );
    client.useTools([
      { name: "launch", title: "后台终端", description: "开", params: { command: { type: "string", description: "命令" } }, run: async (input, ctx) => (calls.push([input, ctx]), "ok") },
      { name: "peek", title: "看输出", description: "看", params: { id: { type: "string", description: "编号" }, lines: { type: "number", description: "行数", optional: true } }, readonly: true, run: async () => "ok" },
    ]);
    const events: ClaudeEvent[] = [];
    await client.ask({ cwd: "/wt", prompt: "x", onEvent: (e) => events.push(e), onPermission: async (req) => (asked.push(req), "allow") });
    expect(answers[0]).toEqual({ behavior: "allow", updatedInput: { id: "t1" } });
    expect(asked).toEqual([{ tool: "后台终端", input: { command: "npm run dev" }, canRemember: false }]);
    expect(events).toContainEqual({ type: "tool", tool: "后台终端", input: { command: "npm run dev" } });
    // 没有工具时不挂这个服务
    expect(await options((c) => c.ask({ cwd: "/wt", prompt: "x" }))).not.toHaveProperty("mcpServers");
  });

  it("起名：一个进程反复用，一问一答；名字去掉引号和句号；起不出来返回 null", async () => {
    const queries: Record<string, unknown>[] = [];
    const replies = ["“修复登录按钮”。", "标题：加一个导出功能", "", "这是一个非常非常长的、根本不像标题的回答，它把提问从头到尾回答了一遍"];
    const fns = fakeSdk([], {
      query: (p) => {
        queries.push(p.options as Record<string, unknown>);
        return (async function* () {
          yield init;
          for await (const m of p.prompt as AsyncIterable<{ message: { content: string } }>) {
            expect(m.message.content).toContain("<提问>");
            const reply = replies.shift()!;
            yield reply ? { type: "result", subtype: "success", is_error: false, result: reply } : { type: "result", subtype: "error_during_execution", is_error: true };
          }
        })();
      },
    });
    const client = createClaudeClient(fns);
    const names = await Promise.all([client.name("登录页点了没反应"), client.name("加导出"), client.name("会失败的"), client.name("太长的")]);
    expect(names).toEqual(["修复登录按钮", "加一个导出功能", null, null]);
    expect(queries).toHaveLength(1); // 只启动了一次
    expect(queries[0]).toMatchObject({ model: "haiku", tools: [], persistSession: false });
    expect(await client.name("   ")).toBeNull();
    client.dispose();
  });

  it("起名的进程启动不了或一直不回：不卡住，返回 null", async () => {
    const broken = createClaudeClient(
      fakeSdk([], {
        query: () =>
          (async function* () {
            throw new Error("spawn failed");
          })(),
      }),
    );
    expect(await broken.name("x")).toBeNull();
    const silent = createClaudeClient(fakeSdk([], { query: () => (async function* () { await new Promise(() => {}); })() }), { namingTimeoutMs: 50 });
    expect(await silent.name("x")).toBeNull();
  });
});

describe("上下文用量", () => {
  it("取最后一条回答消息的用量：读进去的（含缓存）加写出来的", async () => {
    const withUsage = (usage: Record<string, number>) => ({ type: "assistant", message: { content: [{ type: "text", text: "x" }], usage } });
    const client = createClaudeClient(fakeSdk([init, withUsage({ input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 5 }), withUsage({ input_tokens: 20, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300, output_tokens: 80 }), success]));
    expect((await client.ask({ cwd: "/wt", prompt: "x" })).contextTokens).toBe(2400);
  });
});

describe("终端里开过的会话、运行环境", () => {
  it("列出这个目录下的会话：标题优先用自己起的名字，其次是第一个提问", async () => {
    const client = createClaudeClient(fakeSdk([]));
    expect(await client.listSessions("/repo")).toEqual([
      { id: "s-new", title: "看一下 过期问题", lastModified: 2 },
      { id: "s-old", title: "自己起的名", lastModified: 1 },
    ]);
  });

  it("运行环境：能读到随 SDK 带的 Claude 版本；设了密钥就算已登录", async () => {
    const before = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test";
    try {
      const env = await createClaudeClient(fakeSdk([])).environment();
      expect(env.version).toMatch(/^\d+\.\d+/);
      expect(env.loggedIn).toBe(true);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before;
    }
  });
});
