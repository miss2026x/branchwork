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
    expect(seen.bw).toEqual(["addProject", "answerPermission", "ask", "createRoute", "fork", "history", "listProjects", "onEvent", "pickDirectory", "resolveConflict", "resync", "snapshot", "stop", "syncLog", "warm"]);
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
    expect(await page.getByRole("heading", { name: "1 路" }).isVisible()).toBe(true);
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
    await dialog.getByPlaceholder("2 路").fill("换个思路");
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
});
