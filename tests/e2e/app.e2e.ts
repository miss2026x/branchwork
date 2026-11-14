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
    expect(seen.bw).toEqual(["addProject", "answerPermission", "archiveRoute", "ask", "cancelDistill", "changes", "createExpress", "createRoute", "deleteRoute", "discardChanges", "distill", "droppedPath", "environment", "exportRoute", "fork", "history", "importSessions", "inspectDirectory", "keptWorktrees", "listProjects", "onEvent", "openKept", "openLocal", "pickDirectory", "projectLog", "queueAdd", "queueAssign", "queueBoard", "queueRemove", "queueStartNew", "removeKept", "renameRoute", "renameStop", "resolveConflict", "resync", "setPermissionMode", "setRouteColor", "setRouteFlags", "setRouteModel", "snapshot", "stop", "syncLog", "terminalOutput", "terminalSessions", "terminalStop", "terminals", "truncate", "unarchiveRoute", "warm"]);
  });

  it("空白状态 → 加项目 → 开出第一路", async () => {
    await expect.poll(() => page.getByText("先加一个项目").isVisible()).toBe(true);
    await shot("1-empty");
    // 系统的选目录窗口没法在测试里点，换成直接返回测试仓库
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, local);
    await page.getByRole("button", { name: "选择项目目录" }).click();
    // 添加项目的弹窗：先看一眼这个文件夹能不能用，名字可以改
    const add = page.getByRole("dialog", { name: "添加项目" });
    await expect.poll(() => add.getByText(/git 仓库，当前在/).isVisible()).toBe(true);
    expect(await add.getByLabel("项目名称").inputValue()).toBe("my-project");
    await shot("1b-add-project");
    await add.getByRole("button", { name: "添加", exact: true }).click();
    // 空项目：地图上直接写第一站；“更多选项”打开开一路新车的弹窗，什么都不填也能开
    await expect.poll(() => page.getByRole("heading", { name: "my-project 还没有车" }).isVisible()).toBe(true);
    expect(await page.getByLabel("第一站").isVisible()).toBe(true);
    await shot("1c-empty-project");
    await page.getByRole("button", { name: "更多选项…" }).click();
    const fresh = page.getByRole("dialog", { name: "开一路新车" });
    await shot("1d-new-route");
    await fresh.getByRole("button", { name: /开出 1路/ }).click();
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
    await page.getByRole("button", { name: /允许这一次/ }).click();
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
    // 拒绝时可以带一句话告诉 Claude 换个做法
    await page.getByLabel("告诉 Claude 换个做法").fill("先别写文件");
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
    await page.locator('button[data-prompt="记一笔：接入 GitHub 登录"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: /从这站开新对话/ }).click();
    const dialog = page.getByRole("dialog", { name: "从第 1 站开新对话" });
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await dialog.getByPlaceholder("新对话").fill("换个思路");
    await dialog.getByPlaceholder("开好后马上问这个问题").fill("岔出去问");
    await shot("6-fork-dialog");
    await dialog.getByRole("button", { name: "开出 2路" }).click();

    await expect.poll(() => page.getByRole("heading", { name: "换个思路" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("alertdialog", { name: "等你批准" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: /允许这一次/ }).click();
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
    await page.getByLabel(/· 记一笔：接入/).click({ button: "right" }); // 1 路的第 1 站
    await page.getByRole("menuitem", { name: /压缩成快线/ }).click();
    const dialog = page.getByRole("dialog", { name: "压缩成快线" });
    await shot("10a-compress");
    await dialog.getByRole("button", { name: "开始提炼" }).click();
    // 一开始提炼弹窗就收起来：进度在线路图上那块虚线牌子里，好了右下角提醒
    await expect.poll(() => dialog.count()).toBe(0);
    await expect.poll(() => page.getByRole("button", { name: /快1\s*(提炼中|摘要好了)/ }).count()).toBe(1);
    await shot("10b-distilling");
    const summaryNotice = page.getByRole("region", { name: "通知" }).getByRole("button", { name: "查看摘要" });
    await expect.poll(() => summaryNotice.isVisible(), { timeout: 60000 }).toBe(true);
    await summaryNotice.click();
    await expect.poll(() => dialog.getByText("摘要好了，看一眼再发车").isVisible()).toBe(true);
    const before = fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    // 摘要是一条一条的：点文字直接改，也能加一条
    const firstItem = dialog.getByRole("textbox", { name: /第 1 条/ }).first();
    await firstItem.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("记了一笔 GitHub 登录");
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "+ 加一条" }).click();
    await dialog.getByLabel("新的一条").fill("别忘了回调地址");
    await page.keyboard.press("Enter");
    await expect.poll(() => dialog.getByText("别忘了回调地址").isVisible()).toBe(true);

    // 点弹窗外面、按 Esc 都不会把它关掉
    await page.mouse.click(5, 300);
    await page.keyboard.press("Escape");
    expect(await dialog.isVisible()).toBe(true);
    // 点右上角关掉只是收起来：再打开，改过的摘要还在，不用重新等
    await dialog.getByRole("button", { name: "关闭" }).click();
    expect(await dialog.isVisible()).toBe(false);
    await page.getByLabel(/· 记一笔：接入/).click({ button: "right" });
    await page.getByRole("menuitem", { name: /压缩成快线/ }).click();
    expect(await dialog.getByText("记了一笔 GitHub 登录").isVisible()).toBe(true);
    expect(await dialog.getByText("别忘了回调地址").isVisible()).toBe(true);
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
    await rail.getByRole("button", { name: /换个思路/ }).click();
    await rail.getByRole("button", { name: "恢复" }).click();
    await shot("7b-restored");
    await page.getByRole("status").getByRole("button", { name: "去看看" }).click();
    await expect.poll(() => page.getByRole("heading", { name: "换个思路" }).isVisible()).toBe(true);
    expect(worktrees()).toHaveLength(3);

    await page.getByLabel("换个思路 的更多操作").click({ force: true });
    await page.getByRole("menuitem", { name: /删除/ }).click();
    await shot("8-delete");
    // 三种处理：默认是改成归档；这里选全部删掉
    expect(await page.getByRole("alertdialog").getByRole("button", { name: "归档", exact: true }).isVisible()).toBe(true);
    await page.getByRole("alertdialog").getByRole("radio", { name: /全部删掉/ }).check();
    await page.getByRole("alertdialog").getByRole("button", { name: "全部删掉", exact: true }).click();
    await expect.poll(() => rail.getByText("换个思路").count(), { timeout: 30000 }).toBe(0);
    // 删掉之后几秒内可以撤销：路回来了，工作区也没动
    await shot("8b-deleted");
    await page.getByRole("status").getByRole("button", { name: "撤销" }).click();
    await expect.poll(() => rail.getByText("换个思路").count()).toBe(1);
    expect(worktrees().length).toBe(3);
    await page.getByLabel("换个思路 的更多操作").click({ force: true });
    await page.getByRole("menuitem", { name: /删除/ }).click();
    await page.getByRole("alertdialog").getByRole("radio", { name: /全部删掉/ }).check();
    await page.getByRole("alertdialog").getByRole("button", { name: "全部删掉", exact: true }).click();
    await expect.poll(() => rail.getByText("换个思路").count(), { timeout: 30000 }).toBe(0);
    await expect.poll(() => worktrees().length, { timeout: 30000 }).toBe(2);
    // 它同步进 Local 的改动还在
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toContain("岔出去问");
  });

  it("候车区：这一站还在路上时排队，到站后自动发出；先放着的问题可以开新车", async () => {
    const notes = () => fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    // 项目此时是“全部不问”，所以不会停在批准上
    await page.locator("textarea").fill("慢慢来，先占着");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.locator("textarea").fill("排队的问题");
    expect(await page.getByRole("button", { name: "排队" }).isVisible()).toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: /^候车 1/ }).isVisible()).toBe(true);
    expect(notes()).not.toContain("排队的问题");
    await shot("12-queued");
    // 前一站到站后，它自己发出去了
    await expect.poll(notes, { timeout: 60000 }).toContain("排队的问题");
    await expect.poll(() => page.getByRole("button", { name: /^候车 0/ }).isVisible(), { timeout: 30000 }).toBe(true);

    // 先放着，再开新车
    await page.getByRole("button", { name: /^候车 0/ }).click();
    await page.getByLabel("放一个问题进候车区").fill("另起一路问");
    await page.getByRole("button", { name: "放进来" }).click();
    const area = page.getByRole("region", { name: "候车区" });
    await expect.poll(() => area.getByText("未派车").isVisible()).toBe(true);
    await shot("13-waiting-area");
    await area.getByRole("button", { name: "开新车" }).click();
    await expect.poll(() => page.getByRole("heading", { name: "另起一路问" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(notes, { timeout: 60000 }).toContain("另起一路问");
    expect(await area.getByText("还没有候车的问题").isVisible()).toBe(true);
  });
  it("搜索（Ctrl+K）：搜到以前的提问，回车跳到那一站；也能直接开一路新车", async () => {
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "搜索" });
    await palette.getByLabel("搜索").fill("排队");
    await expect.poll(() => palette.getByRole("option").first().textContent()).toContain("排队的问题");
    expect(await palette.getByText("提问 · 1 条").isVisible()).toBe(true);
    await shot("14-palette");
    await page.keyboard.press("Enter");
    await expect.poll(() => palette.count()).toBe(0);
    // 跳到了那一站所在的路
    await expect.poll(() => page.getByRole("log").getByText("排队的问题").first().isVisible()).toBe(true);

    await page.keyboard.press("Control+k");
    await palette.getByLabel("搜索").fill("> 查资料");
    expect(await palette.getByRole("option").count()).toBe(2);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("heading", { name: "查资料" }).isVisible(), { timeout: 30000 }).toBe(true);
    // Esc 关闭
    await page.keyboard.press("Control+k");
    await page.keyboard.press("Escape");
    await expect.poll(() => palette.count()).toBe(0);
  });

  it("通知：到站时有手动登车的问题会提醒，点“登车”就发出", async () => {
    const notes = () => fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    await page.locator("textarea").fill("慢慢来，再占一会儿");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    // 给正在回答的这一路放一个“手动登车”的问题
    await page.evaluate(async () => {
      const [project] = await window.bw.listProjects();
      const snap = await window.bw.snapshot(project!.id);
      const busy = snap.routes.find((r) => r.status === "answering")!;
      await window.bw.queueAdd(project!.id, "手动登车的问题", busy.id, "manual");
    });
    const notices = page.getByRole("region", { name: "通知" });
    await expect.poll(() => notices.getByText("到站了，有一条等你登车").isVisible(), { timeout: 60000 }).toBe(true);
    expect(notes()).not.toContain("手动登车的问题");
    await shot("15-notice-board");
    await notices.getByRole("button", { name: "登车", exact: true }).click();
    await expect.poll(notes, { timeout: 60000 }).toContain("手动登车的问题");
    await expect.poll(() => notices.count()).toBe(0);
  });

  it("压缩可以先收起来：提炼在后台继续，好了右下角提醒，点开就是摘要", async () => {
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    await page.locator('[class*="node"]').last().click({ button: "right" });
    await page.getByRole("menuitem", { name: /压缩成快线/ }).click();
    const dialog = page.getByRole("dialog", { name: "压缩成快线" });
    await dialog.getByRole("button", { name: "开始提炼" }).click();
    await expect.poll(() => dialog.count()).toBe(0);
    const notices = page.getByRole("region", { name: "通知" });
    await expect.poll(() => notices.getByText("的摘要提炼好了").isVisible(), { timeout: 60000 }).toBe(true);
    await shot("16-notice-summary");
    await notices.getByRole("button", { name: "查看摘要" }).click();
    expect(await dialog.getByText("摘要好了，看一眼再发车").isVisible()).toBe(true);
    await dialog.getByRole("button", { name: "不要这条快线" }).click();
    await dialog.getByRole("button", { name: "丢掉" }).click();
    await expect.poll(() => dialog.count()).toBe(0);
  });

  it("窗口变窄：左栏收成图标，对话栏收起，点“对话”滑出来", async () => {
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect.poll(() => page.getByLabel("项目和线路").isVisible()).toBe(true);
    expect(await page.locator("textarea").isVisible()).toBe(true);
    await shot("17-mid");

    await page.setViewportSize({ width: 900, height: 620 });
    await expect.poll(() => page.locator("textarea").count()).toBe(0);
    await shot("18-narrow");
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect.poll(() => page.locator("textarea").isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("19-narrow-drawer");
    await page.getByRole("button", { name: "收起对话" }).click();
    await expect.poll(() => page.locator("textarea").count()).toBe(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => page.locator("textarea").isVisible()).toBe(true);
  });
  it("模型、起名、后台终端：选模型；站名稍后换成小模型起的；Claude 开的终端在一站结束后还在，能看输出、能停", async () => {
    await page.getByRole("button", { name: /^模型：默认/ }).click();
    await page.getByRole("menuitemradio", { name: /Sonnet/ }).click();
    await expect.poll(() => page.getByRole("button", { name: /^模型：Sonnet/ }).isVisible()).toBe(true);

    await page.locator("textarea").fill("起名试试，再开一个终端");
    await page.keyboard.press("Enter");
    // 项目此时是“全部不问”：写文件、开后台终端都不用点批准
    const strip = page.getByRole("region", { name: "后台终端" });
    await expect.poll(() => strip.getByText("演示服务").isVisible(), { timeout: 60000 }).toBe(true);
    // 这一站结束了，终端还在跑
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    await expect.poll(() => strip.getByText("1 个在跑").isVisible()).toBe(true);
    await expect.poll(() => strip.getByText(":5173", { exact: true }).isVisible()).toBe(true);
    // 站名换成了起好的名字
    await expect.poll(() => page.getByRole("log").getByText("演示起的名字").isVisible(), { timeout: 30000 }).toBe(true);
    await shot("20-terminal-strip");

    await strip.getByText("演示服务").click();
    const win = page.getByRole("dialog", { name: /后台终端/ });
    await expect.poll(() => win.getByLabel("输出").textContent(), { timeout: 30000 }).toContain("tick");
    expect(await win.getByText(/工作区里的代码，不是 Local/).isVisible()).toBe(true);
    await shot("21-terminal-window");
    await win.getByRole("button", { name: "停止" }).click();
    await expect.poll(() => win.getByRole("button", { name: "从列表里清掉" }).isVisible(), { timeout: 30000 }).toBe(true);
    await win.getByRole("button", { name: "从列表里清掉" }).click();
    await expect.poll(() => win.count()).toBe(0);
    await expect.poll(() => strip.count()).toBe(0);
  });

  it("看改了什么：没答完的一站，能列出留在工作区里的改动", async () => {
    await page.locator("textarea").fill("写完拖一会儿");
    await page.keyboard.press("Enter");
    // 等它把文件写了（工具那一行出现），在它说完之前停车
    await expect.poll(() => page.getByRole("log").locator("section").last().getByText("demo-notes.md").count(), { timeout: 60000 }).toBeGreaterThan(1);
    await page.getByRole("button", { name: "停车" }).click();
    await page.getByRole("button", { name: "看改了什么" }).click({ timeout: 60000 });
    const dialog = page.getByRole("dialog", { name: /改了什么/ });
    await expect.poll(() => dialog.getByText("demo-notes.md").isVisible(), { timeout: 30000 }).toBe(true);
    expect(await dialog.getByText("1 个文件").isVisible()).toBe(true);
    await shot("22-changes");
    await page.keyboard.press("Escape");
    await expect.poll(() => dialog.count()).toBe(0);
    // 丢掉这些改动：要再确认一次；丢掉之后工作区回到和 Local 对齐的样子
    await page.getByRole("button", { name: "丢掉这些改动" }).click();
    await page.getByRole("button", { name: "丢掉", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "看改了什么" }).count(), { timeout: 30000 }).toBe(0);
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).not.toContain("写完拖一会儿");
  });
  it("改名和换色：路的菜单里改线路名称、换颜色；站的菜单里改站名", async () => {
    const rail = page.getByRole("complementary").first();
    await page.getByRole("button", { name: /查资料 的更多操作/ }).click();
    const menu = page.getByRole("dialog", { name: /查资料 的设置/ });
    expect(await menu.getByText(/会话 .+，\d+ 站/).isVisible()).toBe(true);
    expect(await menu.getByText("claude --resume").isVisible()).toBe(true);
    await menu.getByRole("radio", { name: "颜色 3" }).click();
    await menu.getByLabel("线路名称").fill("查资料（改过名）");
    await shot("23-route-menu");
    await page.keyboard.press("Enter");
    await expect.poll(() => rail.getByText("查资料（改过名）").isVisible()).toBe(true);
    await expect.poll(() => page.getByRole("heading", { name: "查资料（改过名）" }).isVisible()).toBe(true);

    await page.locator('[class*="node"]').last().click({ button: "right" });
    await page.getByRole("menuitem", { name: /重命名站点/ }).click();
    await page.getByLabel("站名").fill("我起的站名");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("log").getByText("我起的站名").isVisible()).toBe(true);
  });

  it("对话栏头部和排队方式：回答中可以选手动登车，头部显示本路候车", async () => {
    await page.locator("textarea").fill("慢慢答这一站");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("radio", { name: "手动登车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("radio", { name: "手动登车" }).click();
    await page.locator("textarea").fill("这一条要我点了才发");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: /本路候车 1 条/ }).isVisible()).toBe(true);
    expect(await page.getByText(/下一站等你登车/).isVisible()).toBe(true);
    await shot("24-header");
    // 到站后不会自己发，等通知里点登车
    const notices = page.getByRole("region", { name: "通知" });
    await expect.poll(() => notices.getByRole("button", { name: "登车", exact: true }).isVisible(), { timeout: 60000 }).toBe(true);
    await notices.getByRole("button", { name: "登车", exact: true }).click();
    await expect.poll(() => page.getByRole("log").getByText("这一条要我点了才发").first().isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
  });
  it("开新车时带上名称、颜色、模型和第一个问题；同步记录里能看到每一站带进 Local 的文件；全部项目页", async () => {
    const notes = () => fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    await page.keyboard.press("Control+n");
    const fresh = page.getByRole("dialog", { name: "开一路新车" });
    await fresh.getByPlaceholder("不填就用第一个问题起名").fill("带着问题出发");
    await fresh.getByRole("radio", { name: "颜色 6" }).click();
    await fresh.getByRole("combobox").selectOption("haiku");
    await fresh.getByLabel("第一个问题").fill("新车的第一个问题");
    await fresh.getByRole("button", { name: /发车/ }).click();
    await expect.poll(() => page.getByRole("heading", { name: "带着问题出发" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(notes, { timeout: 60000 }).toContain("新车的第一个问题");
    expect(await page.getByRole("button", { name: /^模型：Haiku/ }).isVisible()).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);

    await page.getByRole("button", { name: "my-project 的菜单" }).click();
    await page.getByRole("menuitem", { name: "同步记录" }).click();
    const log = page.getByRole("dialog", { name: "Local 同步记录" });
    await expect.poll(() => log.getByText(/个文件进了 Local/).first().isVisible(), { timeout: 30000 }).toBe(true);
    expect(await log.getByText("demo-notes.md").first().isVisible()).toBe(true);
    await shot("25-sync-log");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "全部项目" }).click();
    await expect.poll(() => page.getByRole("heading", { name: "全部项目" }).isVisible()).toBe(true);
    expect(await page.getByText(/\d+ 路车/).first().isVisible()).toBe(true);
    await shot("26-overview");
    await page.getByRole("button", { name: "打开 my-project" }).click();
    await expect.poll(() => page.locator("textarea").isVisible()).toBe(true);
  });
  it("地图上的站：点一下看这一站的记录，悬停出卡片；截线删掉这一站和后面的站，问题可以放回输入框", async () => {
    // 前面的测试可能把候车区的浮窗留着，先收起来，免得挡住地图
    const fab = page.getByRole("button", { name: /^候车 \d/ });
    if ((await fab.getAttribute("aria-expanded")) === "true") await fab.click();
    await page.locator("textarea").fill("截线前的一站");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("log").getByText("截线前的一站").first().isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    await page.locator("textarea").fill("要被截掉的一站");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    const nodes = page.locator('[class*="node"]');
    const count = await nodes.count();

    // 悬停：出卡片
    await page.locator('button[data-prompt="截线前的一站"]').hover();
    await expect.poll(() => page.getByRole("button", { name: "打开这站" }).isVisible(), { timeout: 10000 }).toBe(true);
    await shot("27-hover-card");
    // 点一下：进入“正在看”
    await page.locator('button[data-prompt="截线前的一站"]').click();
    const bar = page.getByRole("toolbar", { name: "选中的站" });
    await expect.poll(() => bar.isVisible()).toBe(true);
    expect(await page.getByText(/^正在看第 \d+ 站$/).isVisible()).toBe(true);
    expect(await page.locator("textarea").isVisible()).toBe(false);
    await shot("28-viewing");
    await page.getByRole("button", { name: "回到最新" }).first().click();
    await expect.poll(() => page.locator("textarea").isVisible()).toBe(true);

    // 右键最后一站：改站（截线并把问题放回输入框）
    await page.locator('button[data-prompt="要被截掉的一站"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: /改站/ }).click();
    const cut = page.getByRole("alertdialog", { name: /截线/ });
    expect(await cut.getByRole("checkbox").isChecked()).toBe(true);
    await shot("29-truncate");
    await cut.getByRole("button", { name: "截线", exact: true }).click();
    await expect.poll(() => nodes.count()).toBe(count - 1);
    expect(await page.locator("textarea").inputValue()).toBe("要被截掉的一站");
    expect(await page.getByRole("log").getByText("要被截掉的一站").count()).toBe(0);
    await page.locator("textarea").fill("");
  });
  it("拖拽派车：把候车区里的问题拖到一路的末尾，松手选手动登车", async () => {
    await page.getByRole("button", { name: /^候车 \d/ }).click();
    await page.getByLabel("放一个问题进候车区").fill("拖过去的问题");
    await page.getByRole("button", { name: "放进来" }).click();
    const area = page.getByRole("region", { name: "候车区" });
    const item = area.getByRole("listitem").filter({ hasText: "拖过去的问题" });
    await expect.poll(() => item.isVisible()).toBe(true);
    // 开始拖：浮窗让开，每一路末尾出现落点
    await item.dispatchEvent("dragstart", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
    const target = page.getByText("松手：手动登车").first();
    await expect.poll(() => target.isVisible()).toBe(true);
    await shot("30-drag-dispatch");
    await target.dispatchEvent("drop", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
    await expect.poll(() => page.getByText("松手：手动登车").count()).toBe(0);
    await page.getByRole("button", { name: /^候车 \d/ }).click();
    await expect.poll(() => area.getByText("拖过去的问题").isVisible()).toBe(true);
    expect(await area.getByText("未派车").count()).toBe(0);
    // 收拾：把它撤掉
    await area.getByRole("button", { name: /「拖过去的问题」的更多操作/ }).click();
    await area.getByRole("button", { name: "删除这个问题" }).click();
    await expect.poll(() => area.getByText("拖过去的问题").count()).toBe(0);
  });
  it("回答中归档：选“答完再归档”，到站后自动归档；删掉对话留下工作区，在同步记录里能找到", async () => {
    const rail = page.getByRole("complementary").first();
    await page.keyboard.press("Control+n");
    const fresh = page.getByRole("dialog", { name: "开一路新车" });
    await fresh.getByPlaceholder("不填就用第一个问题起名").fill("用完就收");
    await fresh.getByLabel("第一个问题").fill("慢慢写一行");
    await fresh.getByRole("button", { name: /发车/ }).click();
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "用完就收 的更多操作" }).click();
    await page.getByRole("menuitem", { name: /^归档/ }).click();
    const ask = page.getByRole("alertdialog", { name: "这一路还在回答" });
    await shot("31-archive-busy");
    await ask.getByRole("button", { name: /答完再归档/ }).click();
    // 这一站正常答完，然后自己收进已归档
    await expect.poll(() => rail.getByRole("button", { name: /已归档 \d/ }).isVisible(), { timeout: 60000 }).toBe(true);
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toContain("慢慢写一行");

    // 另开一路，删掉对话但留下工作区
    await page.keyboard.press("Control+n");
    await fresh.getByPlaceholder("不填就用第一个问题起名").fill("留个文件夹");
    await fresh.getByRole("button", { name: /开出/ }).click();
    await expect.poll(() => page.getByRole("heading", { name: "留个文件夹" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "留个文件夹 的更多操作" }).click();
    await page.getByRole("menuitem", { name: /删除/ }).click();
    const del = page.getByRole("alertdialog");
    await del.getByRole("radio", { name: /留下工作区/ }).check();
    await shot("32-delete-choices");
    await del.getByRole("button", { name: "删掉对话", exact: true }).click();
    await expect.poll(() => rail.getByText("留个文件夹").count(), { timeout: 30000 }).toBe(0);
    await page.getByRole("button", { name: "my-project 的菜单" }).click();
    await page.getByRole("menuitem", { name: "同步记录" }).click();
    const kept = page.getByRole("region", { name: "留下的工作区" });
    await expect.poll(() => kept.getByText(/留个文件夹/).isVisible(), { timeout: 30000 }).toBe(true);
    await kept.getByRole("button", { name: "删掉" }).click();
    await expect.poll(() => kept.count()).toBe(0);
    await page.keyboard.press("Escape");
  });

  it("导入终端里开过的会话：每个会话画成一路，里面每个提问是一站，可以接着问", async () => {
    await page.getByRole("button", { name: "my-project 的菜单" }).click();
    await page.getByRole("menuitem", { name: /导入终端里的会话/ }).click();
    const dialog = page.getByRole("dialog", { name: "导入终端里的会话" });
    await expect.poll(() => dialog.getByText("看一下 session 过期问题").isVisible(), { timeout: 30000 }).toBe(true);
    expect(await dialog.getByText(/4 问/).isVisible()).toBe(true);
    await dialog.getByRole("checkbox").first().check();
    await shot("33-import");
    await dialog.getByRole("button", { name: "导入 1 个" }).click();
    await expect.poll(() => page.getByRole("heading", { name: "看一下 session 过期问题" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByText("已到第 4 站").isVisible(), { timeout: 30000 }).toBe(true);
    // 已经导入过的不再列出来
    await page.getByRole("button", { name: "my-project 的菜单" }).click();
    await page.getByRole("menuitem", { name: /导入终端里的会话/ }).click();
    await expect.poll(() => dialog.getByText("升级依赖").isVisible(), { timeout: 30000 }).toBe(true);
    await page.keyboard.press("Escape");
    // 接着问：第 5 站
    await page.locator("textarea").fill("接着导入的会话问");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByText("已到第 5 站").isVisible(), { timeout: 60000 }).toBe(true);
    await shot("34-imported");
  });
});
