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
  /** 提前启动 Claude 进程；返回的对象只能问一次 */
  startup(params: { options?: Options; initializeTimeoutMs?: number }): Promise<{ query(prompt: string): AsyncIterable<unknown>; close(): void }>;
  forkSession(sessionId: string, options?: { upToMessageId?: string }): Promise<{ sessionId: string }>;
  getSessionMessages(sessionId: string): Promise<{ type: string; uuid: string; message: unknown }[]>;
  deleteSession(sessionId: string): Promise<void>;
}

const realSdk: SdkFunctions = {
  query: (p) => sdk.query(p),
  startup: (p) => sdk.startup(p),
  forkSession: (id, o) => sdk.forkSession(id, o),
  getSessionMessages: (id) => sdk.getSessionMessages(id),
  deleteSession: (id) => sdk.deleteSession(id),
};

export interface ClaudeClientOptions {
  /** 最多同时留几个提前启动好的 Claude 进程（每个占一份内存）。默认 3，设 0 关闭 */
  maxWarm?: number;
  /** 提前启动最多等多久。默认 3 分钟 */
  warmTimeoutMs?: number;
  /** 接在 Claude Code 自带的系统提示后面的说明（告诉 Claude 它所处的环境） */
  appendSystemPrompt?: string;
}

/** 一次提问期间才有的东西。进程可能是提前启动的，启动时还不知道这些，所以放在一个可以后填的格子里 */
interface Turn {
  onPermission?: AskOptions["onPermission"];
}

/** 一个 Claude 进程用的配置：目录、接着哪个会话、怎么停、怎么问批准 */
function processOptions(cwd: string, sessionId: string | undefined, abort: AbortController, turn: Turn, append?: string): Options {
  const canUseTool: CanUseTool = async (toolName, input, extra) => {
    const suggestions = extra.suggestions ?? [];
    const decision = turn.onPermission ? await turn.onPermission({ tool: toolName, input, canRemember: suggestions.length > 0 }) : "deny";
    if (decision === "deny") return { behavior: "deny", message: "用户没有批准这个操作" };
    // “以后都允许”：把 SDK 给的建议原样交回去
    return decision === "allow-always" ? { behavior: "allow", updatedInput: input, updatedPermissions: suggestions } : { behavior: "allow", updatedInput: input };
  };
  return {
    cwd,
    abortController: abort,
    includePartialMessages: true,
    systemPrompt: { type: "preset", preset: "claude_code", ...(append ? { append } : {}) },
    canUseTool,
    ...(sessionId ? { resume: sessionId } : {}),
  };
}

interface Warm {
  cwd: string;
  sessionId: string | undefined;
  abort: AbortController;
  turn: Turn;
  /** 启动好了得到可以提问的对象；启动失败得到 null */
  ready: Promise<{ query(prompt: string): AsyncIterable<unknown>; close(): void } | null>;
}

export function createClaudeClient(fns: SdkFunctions = realSdk, clientOpts: ClaudeClientOptions = {}): ClaudeClient {
  const maxWarm = clientOpts.maxWarm ?? 3;
  /** 提前启动好的进程，按目录找；Map 的先后就是新旧，最旧的先被挤掉 */
  const warmed = new Map<string, Warm>();

  const discard = (w: Warm) => {
    if (warmed.get(w.cwd) === w) warmed.delete(w.cwd);
    void w.ready.then((q) => q?.close());
    w.abort.abort();
  };

  return {
    warm(cwd, sessionId) {
      if (maxWarm <= 0) return;
      const existing = warmed.get(cwd);
      if (existing) {
        if (existing.sessionId === sessionId) return; // 已经在准备了
        discard(existing); // 会话变了，旧的没用了
      }
      const abort = new AbortController();
      const turn: Turn = {};
      const w: Warm = {
        cwd,
        sessionId,
        abort,
        turn,
        ready: fns.startup({ options: processOptions(cwd, sessionId, abort, turn, clientOpts.appendSystemPrompt), initializeTimeoutMs: clientOpts.warmTimeoutMs ?? 180_000 }).catch(() => {
          if (warmed.get(cwd) === w) warmed.delete(cwd);
          return null;
        }),
      };
      warmed.set(cwd, w);
      while (warmed.size > maxWarm) discard(warmed.values().next().value!);
    },

    cool(cwd) {
      const w = warmed.get(cwd);
      if (w) discard(w);
    },

    dispose() {
      for (const w of [...warmed.values()]) discard(w);
    },

    async ask(opts: AskOptions): Promise<AskResult> {
      // 有没有为这一路提前启动好的进程（目录和会话都对得上才能用）
      let abort = new AbortController();
      let turn: Turn = {};
      let stream: AsyncIterable<unknown> | null = null;
      let prewarmed = false;
      // 会话对不上的不动它：那是给这一路自己的下一站准备的，现在问的是别的会话（比如提炼摘要用的临时会话）
      const w = warmed.get(opts.cwd);
      if (w && w.sessionId === opts.sessionId) {
        warmed.delete(opts.cwd);
        const q = await w.ready; // 还在启动的话等它：已经跑了一段，比现在重新启动快
        if (q && !w.abort.signal.aborted) {
          abort = w.abort;
          turn = w.turn;
          stream = q.query(opts.prompt);
          prewarmed = true;
        }
      }
      turn.onPermission = opts.onPermission;
      const onAbort = () => abort.abort();
      if (opts.signal?.aborted) abort.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      let sessionId: string | null = opts.sessionId ?? null;
      let text = "";
      let outcome: AskResult["outcome"] = "interrupted"; // 没收到结果消息就算没答完
      let error: string | null = null;
      let started = false;
      const markStarted = () => {
        if (!started) opts.onEvent?.({ type: "started" });
        started = true;
      };

      try {
        stream ??= fns.query({ prompt: opts.prompt, options: processOptions(opts.cwd, opts.sessionId, abort, turn, clientOpts.appendSystemPrompt) });
        if (prewarmed) markStarted(); // 进程早就启动好了
        for await (const raw of stream) {
          const m = raw as SdkMessage;
          if (m.session_id) sessionId = m.session_id;
          if (m.type === "system" && m.subtype === "init") markStarted();

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
            opts.onEvent?.({ type: "answered" });
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
        turn.onPermission = undefined;
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
