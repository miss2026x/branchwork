/**
 * 整个应用的测试：真的启动 Electron，真的建工作区和同步，Claude 用演示用的假实现。
 * 运行：pnpm build && pnpm test:e2e   （Linux 无图形界面时：xvfb-run -a pnpm test:e2e）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const shots = process.env.BW_E2E_SHOTS;
let tmp: string;
let local: string;
let app: ElectronApplication;
let page: Page;

const git = (...args: string[]) => execFileSync("git", args, { cwd: local, stdio: "ignore" });
const shot = async (name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) });
};

beforeAll(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bw-e2e-")));
  local = path.join(tmp, "my-project");
  fs.mkdirSync(local);
  fs.writeFileSync(path.join(local, "README.md"), "# my project\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.email=dev@example.com", "-c", "user.name=Dev", "commit", "-qm", "init");

  app = await electron.launch({
    args: [root, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
    env: { ...(process.env as Record<string, string>), BRANCHWORK_HOME: path.join(tmp, "home"), BRANCHWORK_DEMO: "1" },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
});

afterAll(async () => {
  await app?.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("应用", () => {
  it("界面碰不到 Node，只有 window.bw", async () => {
    const seen = await page.evaluate(() => ({
      bw: Object.keys(window.bw).sort(),
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
    }));
    expect(seen.require).toBe("undefined");
    expect(seen.process).toBe("undefined");
    expect(seen.bw).toEqual(["addProject", "answerPermission", "archiveRoute", "ask", "cancelDistill", "createExpress", "createRoute", "deleteRoute", "distill", "fork", "history", "listProjects", "onEvent", "pickDirectory", "resolveConflict", "resync", "setPermissionMode", "snapshot", "stop", "syncLog", "unarchiveRoute", "warm"]);
  });

  it("空白状态 → 加项目 → 开出第一路", async () => {
    await expect.poll(() => page.getByText("先加一个项目").isVisible()).toBe(true);
    await shot("1-empty");
    // 系统的选目录窗口没法在测试里点，换成直接返回测试仓库
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, local);
    await page.getByRole("button", { name: "选择项目目录" }).click();
    await expect.poll(() => page.getByText("开出第一路").isVisible()).toBe(true);
    await page.getByRole("main").getByRole("button", { name: "新对话" }).click();
    await expect.poll(() => page.getByText("这一路还没有站").isVisible()).toBe(true);
    expect(await page.getByRole("heading", { name: "新对话" }).isVisible()).toBe(true);
    await shot("2-first-route");
  });

  it("问一站：站出现、回答流出、等批准、到站、改动进了 Local", async () => {
    await page.locator("textarea").fill("记一笔：接入 GitHub 登录");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("alertdialog", { name: "等你批准" }).isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.getByText("第 1 站 · 等你批准").isVisible()).toBe(true);
    expect(fs.existsSync(path.join(local, "demo-notes.md"))).toBe(false);
    await shot("3-permission");
    await page.getByRole("button", { name: "允许", exact: true }).click();
    await expect.poll(() => page.getByText("已到第 1 站").isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => fs.existsSync(path.join(local, "demo-notes.md")), { timeout: 30000 }).toBe(true);
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toBe("- 第 1 站：记一笔：接入 GitHub 登录\n");
    expect(await page.getByText("写好了。到站后这个改动会同步到 Local。").isVisible()).toBe(true);
    await shot("4-arrived");
  });

  it("第二站接着问；拒绝批准时文件不变", async () => {
    await page.locator("textarea").fill("第二个问题");
    await page.getByRole("button", { name: "发车" }).click();
    await expect.poll(() => page.getByRole("alertdialog", { name: "等你批准" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "拒绝" }).click();
    await expect.poll(() => page.getByText("已到第 2 站").isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.getByText("这是这一路的第 2 个问题").isVisible()).toBe(true);
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toBe("- 第 1 站：记一笔：接入 GitHub 登录\n");
  });

  it("停车：这一站标成没答完，可以接着问", async () => {
    await page.locator("textarea").fill("慢慢来");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "停车" }).click();
    await expect.poll(() => page.getByText("第 3 站没答完").isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.getByText("上一站没答完，可以接着问").isVisible()).toBe(true);
    await shot("5-interrupted");
  });

  it("从第 1 站开新对话：新的一路带着第 1 站的历史，有自己的工作区，改动照样进 Local", async () => {
    await page.locator('button[title="记一笔：接入 GitHub 登录"]').click();
    await page.getByRole("menuitem", { name: /从这站开新对话/ }).click();
    const dialog = page.getByRole("dialog", { name: "从第 1 站开新对话" });
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await dialog.getByPlaceholder("新对话").fill("换个思路");
    await dialog.getByPlaceholder("开好后马上问这个问题").fill("岔出去问");
    await shot("6-fork-dialog");
    await dialog.getByRole("button", { name: "开出 2路" }).click();

    await expect.poll(() => page.getByRole("heading", { name: "换个思路" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("alertdialog", { name: "等你批准" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "允许", exact: true }).click();
    await expect.poll(() => page.getByText("已到第 2 站").isVisible(), { timeout: 30000 }).toBe(true);
    // 分叉出来的路只记得第 1 站，所以这是它的第 2 个问题
    expect(await page.getByText("这是这一路的第 2 个问题").isVisible()).toBe(true);
    expect(await page.getByText("第 1 站随 1路 带来").isVisible()).toBe(true);
    await expect.poll(() => fs.readFileSync(path.join(local, "demo-notes.md"), "utf8"), { timeout: 30000 }).toBe("- 第 1 站：记一笔：接入 GitHub 登录\n- 第 2 站：岔出去问\n");
    await shot("7-forked");
  });

  it("关掉再打开：项目、路、站和回答都还在", async () => {
    await app.close();
    app = await electron.launch({
      args: [root, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])],
      env: { ...(process.env as Record<string, string>), BRANCHWORK_HOME: path.join(tmp, "home"), BRANCHWORK_DEMO: "1" },
    });
    page = await app.firstWindow();
    await expect.poll(() => page.getByText("第 3 站没答完").isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.getByText("记一笔：接入 GitHub 登录").first().isVisible()).toBe(true);
    expect(await page.getByRole("complementary").getByText("my-project").isVisible()).toBe(true);
  });

  it("全部不问：要先确认才开启；开启后不再出现批准卡片，改动直接进 Local", async () => {
    await page.getByRole("button", { name: /批准：每次都问/ }).click();
    await page.getByRole("menuitemradio", { name: /全部不问/ }).click();
    const confirm = page.getByRole("alertdialog", { name: "开启全部不问" });
    await expect.poll(() => confirm.isVisible()).toBe(true);
    await shot("9-skip-permissions");
    await confirm.getByRole("button", { name: "开启全部不问" }).click();
    await expect.poll(() => page.getByRole("button", { name: /批准：全部不问/ }).isVisible()).toBe(true);

    await page.locator("textarea").fill("不用问我");
    await page.keyboard.press("Enter");
    await expect.poll(() => fs.readFileSync(path.join(local, "demo-notes.md"), "utf8"), { timeout: 30000 }).toContain("不用问我");
    expect(await page.getByRole("alertdialog", { name: "等你批准" }).count()).toBe(0);
    await expect.poll(() => page.getByRole("button", { name: "发车" }).isDisabled(), { timeout: 30000 }).toBe(true); // 到站了，输入框空着
  });

  it("压缩成快线：提炼出摘要，改一改，开出快1；它是全新的对话，第一站是摘要", async () => {
    await page.getByLabel(/· 记一笔：接入/).click(); // 1 路的第 1 站
    await page.getByRole("menuitem", { name: /压缩成快线/ }).click();
    const dialog = page.getByRole("dialog", { name: "压缩成快线" });
    await dialog.getByRole("button", { name: "开始提炼" }).click();
    await expect.poll(() => dialog.getByText("摘要好了，看一眼再发车").isVisible(), { timeout: 60000 }).toBe(true);
    const before = fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    await dialog.locator("textarea").first().fill("## 做完了\n- 记了一笔 GitHub 登录");

    // 点弹窗外面、按 Esc 都不会把它关掉
    await page.mouse.click(5, 300);
    await page.keyboard.press("Escape");
    expect(await dialog.isVisible()).toBe(true);
    // 点右上角关掉只是收起来：再打开，改过的摘要还在，不用重新等
    await dialog.getByRole("button", { name: "关闭" }).click();
    expect(await dialog.isVisible()).toBe(false);
    await page.getByLabel(/· 记一笔：接入/).click();
    await page.getByRole("menuitem", { name: /压缩成快线/ }).click();
    expect(await dialog.locator("textarea").first().inputValue()).toBe("## 做完了\n- 记了一笔 GitHub 登录");
    // “不要这条快线”要再确认一次
    await dialog.getByRole("button", { name: "不要这条快线" }).click();
    await dialog.getByRole("button", { name: "留着" }).click();

    await dialog.getByPlaceholder(/· 续/).fill("登录收尾");
    await dialog.getByPlaceholder("Claude 会连同摘要一起看到它").fill("接着做");
    await shot("10-summary");
    await dialog.getByRole("button", { name: "开出快1" }).click();

    await expect.poll(() => page.getByRole("heading", { name: "登录收尾" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByText("已到第 2 站").isVisible(), { timeout: 60000 }).toBe(true);
    expect(await page.getByRole("heading", { name: "交接摘要" }).isVisible()).toBe(true);
    expect(await page.getByText("记了一笔 GitHub 登录").first().isVisible()).toBe(true);
    expect(await page.getByText("这是这一路的第 1 个问题").isVisible()).toBe(true); // 新会话，不记得原来的对话
    // 提炼用的临时对话是只读的，没有往 Local 写任何东西；之后快线自己的第一问才写
    const after = fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length)).toMatch(/^- 第 1 站：下面是之前一段对话的交接摘要/);
    await shot("11-express");
  });

  it("归档再恢复；删除一路后它的工作区也一起没了", async () => {
    const rail = page.getByRole("complementary").first();
    const worktrees = () => fs.readdirSync(path.join(tmp, "home", "worktrees")).flatMap((p) => fs.readdirSync(path.join(tmp, "home", "worktrees", p)));
    expect(worktrees()).toHaveLength(3);

    await page.getByLabel("换个思路 的更多操作").click({ force: true });
    await page.getByRole("menuitem", { name: /归档/ }).click();
    await expect.poll(() => rail.getByText("已归档 1").isVisible()).toBe(true);
    await rail.getByText("已归档 1").click();
    await rail.getByRole("button", { name: "恢复" }).click();
    await expect.poll(() => page.getByRole("heading", { name: "换个思路" }).isVisible()).toBe(true);
    expect(worktrees()).toHaveLength(3);

    await page.getByLabel("换个思路 的更多操作").click({ force: true });
    await page.getByRole("menuitem", { name: /删除/ }).click();
    await shot("8-delete");
    await page.getByRole("alertdialog").getByRole("button", { name: "删除", exact: true }).click();
    await expect.poll(() => rail.getByText("换个思路").count(), { timeout: 30000 }).toBe(0);
    await expect.poll(() => worktrees().length, { timeout: 30000 }).toBe(2);
    // 它同步进 Local 的改动还在
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toContain("岔出去问");
  });
});
