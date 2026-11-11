import { randomUUID } from "node:crypto";
import type { AskOptions, AskResult, ClaudeClient, HistoryMessage } from "../../src/claude";
import type { PermissionDecision } from "../../src/shared";

export interface FakeTurn {
  cwd: string;
  prompt: string;
  sessionId: string;
  /** 这一站之前，这个会话里说过的提问 */
  earlierPrompts: string[];
  signal: AbortSignal;
  say(text: string): void;
  tool(name: string, input?: Record<string, unknown>): void;
  askPermission(tool: string, input?: Record<string, unknown>, canRemember?: boolean): Promise<PermissionDecision>;
}

/** 这一站里假 Claude 做什么。返回值是这一站怎么结束；不返回算正常结束 */
export type FakeScript = (turn: FakeTurn) => Promise<AskResult["outcome"] | void> | AskResult["outcome"] | void;

/** 假的 Claude：不联网，按脚本在工作区里改文件。会话历史记在内存里。 */
export class FakeClaude implements ClaudeClient {
  readonly sessions = new Map<string, HistoryMessage[]>();
  readonly asks: AskOptions[] = [];
  script: FakeScript = () => {};

  async ask(opts: AskOptions): Promise<AskResult> {
    this.asks.push(opts);
    const sessionId = opts.sessionId ?? randomUUID();
    const history = this.sessions.get(sessionId) ?? [];
    this.sessions.set(sessionId, history);
    const earlierPrompts = history.filter((m) => m.role === "user").map((m) => String(m.content));
    const promptMessageId = randomUUID();
    history.push({ id: promptMessageId, role: "user", content: opts.prompt });

    let text = "";
    let outcome: AskResult["outcome"] = "completed";
    let error: string | null = null;
    try {
      opts.onEvent?.({ type: "started" });
      const r = await this.script({
        cwd: opts.cwd,
        prompt: opts.prompt,
        sessionId,
        earlierPrompts,
        signal: opts.signal ?? new AbortController().signal,
        say: (t) => {
          text += t;
          opts.onEvent?.({ type: "text", text: t });
        },
        tool: (name, input = {}) => opts.onEvent?.({ type: "tool", tool: name, input }),
        askPermission: (tool, input = {}, canRemember = true) => (opts.onPermission ? opts.onPermission({ tool, input, canRemember }) : Promise.resolve("deny")),
      });
      if (r) outcome = r;
    } catch (e) {
      outcome = "failed";
      error = e instanceof Error ? e.message : String(e);
    }
    if (opts.signal?.aborted) outcome = "interrupted";
    if (outcome === "failed" && !error) error = "error_during_execution";
    history.push({ id: randomUUID(), role: "assistant", content: text });
    return { outcome, sessionId, text, error, promptMessageId, lastMessageId: history.at(-1)!.id };
  }

  async fork(sessionId: string, upToMessageId?: string): Promise<string> {
    const src = this.sessions.get(sessionId);
    if (!src) throw new Error(`no session ${sessionId}`);
    const end = upToMessageId ? src.findIndex((m) => m.id === upToMessageId) + 1 : src.length;
    if (end === 0) throw new Error(`Message ${upToMessageId} not found`);
    const id = randomUUID();
    this.sessions.set(id, src.slice(0, end).map((m) => ({ ...m })));
    return id;
  }

  async history(sessionId: string): Promise<HistoryMessage[]> {
    return this.sessions.get(sessionId) ?? [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
