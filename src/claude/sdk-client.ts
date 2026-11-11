import * as sdk from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";
import type { AskOptions, AskResult, ClaudeClient, HistoryMessage } from "./types";

/** 用到的 SDK 消息字段。只写我们读的那几个，SDK 加字段不影响这里 */
interface SdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  terminal_reason?: string;
  errors?: string[];
  result?: string;
  parent_tool_use_id?: string | null;
  event?: { type: string; delta?: { type: string; text?: string } };
  message?: { content?: unknown };
}

/** 用到的 SDK 函数。默认是真的 SDK；测试里换成假的 */
export interface SdkFunctions {
  query(params: { prompt: string; options?: Options }): AsyncIterable<unknown>;
  forkSession(sessionId: string, options?: { upToMessageId?: string }): Promise<{ sessionId: string }>;
  getSessionMessages(sessionId: string): Promise<{ type: string; uuid: string; message: unknown }[]>;
  deleteSession(sessionId: string): Promise<void>;
}

const realSdk: SdkFunctions = {
  query: (p) => sdk.query(p),
  forkSession: (id, o) => sdk.forkSession(id, o),
  getSessionMessages: (id) => sdk.getSessionMessages(id),
  deleteSession: (id) => sdk.deleteSession(id),
};

export function createClaudeClient(fns: SdkFunctions = realSdk): ClaudeClient {
  return {
    async ask(opts: AskOptions): Promise<AskResult> {
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      if (opts.signal?.aborted) abort.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      const canUseTool: CanUseTool = async (toolName, input, extra) => {
        const suggestions = extra.suggestions ?? [];
        const decision = opts.onPermission ? await opts.onPermission({ tool: toolName, input, canRemember: suggestions.length > 0 }) : "deny";
        if (decision === "deny") return { behavior: "deny", message: "用户没有批准这个操作" };
        // “以后都允许”：把 SDK 给的建议原样交回去
        return decision === "allow-always" ? { behavior: "allow", updatedInput: input, updatedPermissions: suggestions } : { behavior: "allow", updatedInput: input };
      };

      const options: Options = {
        cwd: opts.cwd,
        abortController: abort,
        includePartialMessages: true,
        systemPrompt: { type: "preset", preset: "claude_code" },
        canUseTool,
        ...(opts.sessionId ? { resume: opts.sessionId } : {}),
      };

      let sessionId: string | null = opts.sessionId ?? null;
      let text = "";
      let outcome: AskResult["outcome"] = "interrupted"; // 没收到结果消息就算没答完
      let error: string | null = null;

      try {
        for await (const raw of fns.query({ prompt: opts.prompt, options })) {
          const m = raw as SdkMessage;
          if (m.session_id) sessionId = m.session_id;
          if (m.type === "system" && m.subtype === "init") opts.onEvent?.({ type: "started" });

          if (m.type === "stream_event" && !m.parent_tool_use_id) {
            const d = m.event?.delta;
            if (m.event?.type === "content_block_delta" && d?.type === "text_delta" && d.text) opts.onEvent?.({ type: "text", text: d.text });
          } else if (m.type === "assistant" && !m.parent_tool_use_id) {
            for (const block of asBlocks(m.message?.content)) {
              if (block.type === "text" && typeof block.text === "string") text += block.text;
              if (block.type === "tool_use" && typeof block.name === "string") {
                opts.onEvent?.({ type: "tool", tool: block.name, input: (block.input as Record<string, unknown>) ?? {} });
              }
            }
          } else if (m.type === "result") {
            // 实测（2026-11-10）：正常结束是 success / is_error:false / terminal_reason:"completed"
            const ok = m.subtype === "success" && m.is_error !== true && (m.terminal_reason === undefined || m.terminal_reason === "completed");
            if (ok) {
              outcome = "completed";
            } else if (m.terminal_reason === "aborted_streaming" || m.terminal_reason === "aborted_tools") {
              outcome = "interrupted";
            } else {
              outcome = "failed";
              error = m.errors?.join("; ") || m.terminal_reason || m.subtype || "未知错误";
            }
          }
        }
      } catch (e) {
        // 实测：abort 之后收不到结果消息，query() 直接抛出 "Operation aborted"
        if (abort.signal.aborted) {
          outcome = "interrupted";
        } else {
          outcome = "failed";
          error = e instanceof Error ? e.message : String(e);
        }
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }
      if (abort.signal.aborted && outcome === "completed") outcome = "interrupted";

      const ids = sessionId ? await stopMessageIds(fns, sessionId, opts.afterMessageId) : { promptMessageId: null, lastMessageId: null };
      return { outcome, sessionId, text, error, ...ids };
    },

    async fork(sessionId, upToMessageId) {
      const r = await fns.forkSession(sessionId, upToMessageId ? { upToMessageId } : {});
      return r.sessionId;
    },

    async history(sessionId): Promise<HistoryMessage[]> {
      const msgs = await fns.getSessionMessages(sessionId);
      return msgs.map((m) => ({ id: m.uuid, role: m.type as HistoryMessage["role"], content: (m.message as { content?: unknown } | null)?.content ?? m.message }));
    },

    deleteSession: (sessionId) => fns.deleteSession(sessionId),
  };
}

/**
 * 这一站在会话历史里的起止：提问那条消息、最后一条消息。
 * 从会话文件读（不启动进程）。分叉时要把“最后一条消息”的 ID 交给 forkSession。
 */
async function stopMessageIds(fns: SdkFunctions, sessionId: string, afterMessageId?: string) {
  try {
    const msgs = await fns.getSessionMessages(sessionId);
    const from = afterMessageId ? msgs.findIndex((m) => m.uuid === afterMessageId) + 1 : 0;
    const prompt = msgs.slice(from).find((m) => m.type === "user" && isPrompt(m.message));
    return { promptMessageId: prompt?.uuid ?? null, lastMessageId: msgs.at(-1)?.uuid ?? null };
  } catch {
    return { promptMessageId: null, lastMessageId: null };
  }
}

function asBlocks(content: unknown): { type?: string; text?: unknown; name?: unknown; input?: unknown }[] {
  return Array.isArray(content) ? (content as { type?: string }[]) : [];
}

/** 用户自己打的提问（而不是工具结果） */
function isPrompt(message: unknown): boolean {
  const c = (message as { content?: unknown } | null)?.content;
  return typeof c === "string" || asBlocks(c).some((b) => b.type === "text");
}
