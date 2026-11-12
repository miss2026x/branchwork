import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AskOptions, AskResult, ClaudeClient, HistoryMessage } from "./types";

/**
 * 演示用的假 Claude：不联网、不需要登录，按固定剧本回答，并真的在工作区里改一个文件。
 * 设置环境变量 BRANCHWORK_DEMO=1 启动应用时使用。用途：不等真 Claude 也能试界面；自动测试整个应用。
 * 剧本：先说两句 → 申请批准写文件 → 写 demo-notes.md → 说完。提问里带“慢”字会多等几秒。
 */
export function createDemoClaudeClient(): ClaudeClient {
  const sessions = new Map<string, HistoryMessage[]>();
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    });

  return {
    async ask(opts: AskOptions): Promise<AskResult> {
      const sessionId = opts.sessionId ?? randomUUID();
      const history = sessions.get(sessionId) ?? [];
      sessions.set(sessionId, history);
      const promptMessageId = randomUUID();
      history.push({ id: promptMessageId, role: "user", content: opts.prompt });
      const n = history.filter((m) => m.role === "user").length;
      const blocks: { type: string; text?: string; name?: string; input?: unknown }[] = [];
      const stopped = () => opts.signal?.aborted === true;
      const say = async (text: string) => {
        for (const piece of text.match(/[\s\S]{1,4}/g) ?? []) {
          if (stopped()) return;
          const last = blocks.at(-1);
          if (last?.type === "text") last.text += piece;
          else blocks.push({ type: "text", text: piece });
          opts.onEvent?.({ type: "text", text: piece });
          await sleep(30, opts.signal);
        }
      };

      await sleep(opts.prompt.includes("慢") ? 4000 : 600, opts.signal);
      let outcome: AskResult["outcome"] = "completed";
      if (!stopped()) {
        opts.onEvent?.({ type: "started" });
        await say(`这是演示模式，没有真的调用 Claude。这是这一路的第 ${n} 个问题：\n\n> ${opts.prompt}\n\n我会在工作区里往 \`demo-notes.md\` 追加一行。\n\n`);
      }
      if (!stopped()) {
        const file = path.join(opts.cwd, "demo-notes.md");
        const input = { file_path: file };
        blocks.push({ type: "tool_use", name: "Write", input });
        opts.onEvent?.({ type: "tool", tool: "Write", input });
        const decision = opts.onPermission ? await opts.onPermission({ tool: "Write", input, canRemember: true }) : "deny";
        if (decision === "deny") {
          await say("你没有批准，文件没有改。");
        } else if (!stopped()) {
          await fs.appendFile(file, `- 第 ${n} 站：${opts.prompt.replace(/\s+/g, " ")}\n`);
          await say("写好了。到站后这个改动会同步到 Local。");
        }
      }
      if (stopped()) outcome = "interrupted";
      else opts.onEvent?.({ type: "answered" });
      history.push({ id: randomUUID(), role: "assistant", content: blocks });
      return { outcome, sessionId, text: blocks.map((b) => b.text ?? "").join(""), error: null, promptMessageId, lastMessageId: history.at(-1)!.id };
    },
    async fork(sessionId, upToMessageId) {
      const src = sessions.get(sessionId) ?? [];
      const end = upToMessageId ? src.findIndex((m) => m.id === upToMessageId) + 1 : src.length;
      const id = randomUUID();
      sessions.set(id, src.slice(0, end));
      return id;
    },
    history: async (sessionId) => sessions.get(sessionId) ?? [],
    deleteSession: async (sessionId) => void sessions.delete(sessionId),
    warm() {},
    cool() {},
    dispose() {},
  };
}
