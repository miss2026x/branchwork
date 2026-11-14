import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { AskOptions, AskResult, ClaudeClient, ClaudeTool, HistoryMessage } from "./types";

/**
 * 演示用的假 Claude：不联网、不需要登录，按固定剧本回答，并真的在工作区里改一个文件。
 * 设置环境变量 BRANCHWORK_DEMO=1 启动应用时使用。用途：不等真 Claude 也能试界面；自动测试整个应用。
 * 剧本：先说两句 → 申请批准写文件 → 写 demo-notes.md → 说完。提问里带“慢”字会多等几秒，带“拖”字会在写完文件后再等几秒；
 * 带“终端”两个字会另外开一个后台终端（每秒打印一行，并报一个端口）；带“起名”两个字会在稍后把站名换成“演示起的名字”。
 */
export function createDemoClaudeClient(): ClaudeClient {
  const sessions = new Map<string, HistoryMessage[]>();
  let tools: ClaudeTool[] = [];
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
        if (decision === "deny" || typeof decision === "object") {
          await say("你没有批准，文件没有改。");
        } else if (!stopped()) {
          await fs.appendFile(file, `- 第 ${n} 站：${opts.prompt.replace(/\s+/g, " ")}\n`);
          // 带“拖”字：写完文件后再磨蹭几秒，方便试“改了一半就停车”
          if (opts.prompt.includes("拖")) await sleep(6000, opts.signal);
          await say("写好了。到站后这个改动会同步到 Local。");
        }
      }
      const start = tools.find((t) => t.name === "terminal_start");
      if (!stopped() && start && opts.prompt.includes("终端")) {
        const input = { name: "演示服务", command: `node -e "console.log('ready on http://localhost:5173');setInterval(()=>console.log('tick '+Date.now()),1000)"` };
        blocks.push({ type: "tool_use", name: start.title, input });
        opts.onEvent?.({ type: "tool", tool: start.title, input });
        const decision = opts.onPermission ? await opts.onPermission({ tool: start.title, input, canRemember: false }) : "deny";
        if (decision === "deny" || typeof decision === "object") await say("\n\n你没有批准，后台终端没有开。");
        else if (!stopped()) await say("\n\n" + (await start.run(input, { cwd: opts.cwd }).catch((e: unknown) => String(e))));
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
    // 演示：假装在终端里开过两个会话
    async listSessions() {
      const seed = (id: string, prompts: string[]) => {
        if (!sessions.has(id)) sessions.set(id, prompts.flatMap((p) => [{ id: randomUUID(), role: "user" as const, content: p }, { id: randomUUID(), role: "assistant" as const, content: [{ type: "text", text: `（演示）关于“${p}”的回答。` }] }]));
      };
      seed("demo-terminal-1", ["看一下 session 过期问题", "过期时间是在哪里设的？", "改成 7 天", "加个测试"]);
      seed("demo-terminal-2", ["升级依赖", "跑一遍测试"]);
      return [
        { id: "demo-terminal-1", title: "看一下 session 过期问题", lastModified: Date.now() - 6 * 86_400_000 },
        { id: "demo-terminal-2", title: "升级依赖", lastModified: Date.now() - 30 * 86_400_000 },
      ];
    },
    environment: async () => ({ version: "演示模式", loggedIn: true }),
    deleteSession: async (sessionId) => void sessions.delete(sessionId),
    useTools(list) {
      tools = list;
    },
    // 提问里带“起名”两个字时演示“名字晚一点换掉”的效果；别的提问不起名
    async name(prompt) {
      if (!prompt.includes("起名")) return null;
      await sleep(800);
      return "演示起的名字";
    },
    warm() {},
    cool() {},
    dispose() {},
  };
}
