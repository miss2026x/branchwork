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

/** 对话栏的输入框（设计稿 4-7：能放图片，是一个 contenteditable 的文本框） */
const composer = () => page.getByRole("textbox", { name: "下一个问题" });
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
    expect(seen.bw).toEqual(["addProject", "answerPermission", "archiveRoute", "ask", "cancelDistill", "changes", "claudeOptions", "createExpress", "createRoute", "deleteRoute", "discardChanges", "distill", "droppedPath", "environment", "exportRoute", "fork", "history", "images", "importCancel", "importSessions", "inspectDirectory", "keptWorktrees", "listProjects", "localPresets", "localRoute", "localStatus", "onEvent", "openKept", "openLocal", "openSystemTerminal", "pickDirectory", "projectLog", "queueAdd", "queueAssign", "queueBoard", "queueRemove", "queueStartNew", "removeKept", "removeProject", "renameRoute", "renameStop", "resetLocal", "resolveConflict", "resync", "setLocalPresets", "setRouteColor", "setRouteFlags", "setRouteModel", "setRoutePermissionMode", "snapshot", "stop", "syncLog", "terminalOutput", "terminalSessions", "terminalStop", "terminals", "truncate", "unarchiveRoute", "warm"]);
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
    await composer().fill("记一笔：接入 GitHub 登录");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("alertdialog", { name: "等你批准" }).isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.getByText("第 1 站暂停，等你批准").isVisible()).toBe(true);
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
    await composer().fill("第二个问题");
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
    await composer().fill("慢慢来");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("button", { name: "停车" }).click();
    // 点下去马上变成“正在停车”，按钮不能再点（设计稿 4-8）
    const stopping = page.getByRole("status").filter({ hasText: "正在停车 · 等 Claude 停下" });
    await expect.poll(() => stopping.isVisible(), { timeout: 2000 }).toBe(true);
    expect(await stopping.getByRole("button", { name: /停车中/ }).isDisabled()).toBe(true);
    await shot("5-stopping");
    await expect.poll(() => page.getByText("第 3 站没答完").isVisible(), { timeout: 30000 }).toBe(true);
    expect(await stopping.count()).toBe(0);
    expect(await page.getByText(/上一站没答完，改动还在工作区/).isVisible()).toBe(true);
    await shot("5-interrupted");
  });

  it("从第 1 站开新对话：新的一路带着第 1 站的历史，有自己的工作区，改动照样进 Local", async () => {
    await page.locator('button[data-prompt="记一笔：接入 GitHub 登录"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: /从这站开新对话/ }).click();
    const dialog = page.getByRole("dialog", { name: "从第 1 站开新对话" });
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await dialog.getByLabel("名称").fill("换个思路");
    await dialog.getByLabel("第一个问题").fill("岔出去问");
    await shot("6-fork-dialog");
    await dialog.getByRole("button", { name: /^发车/ }).click(); // 写了第一个问题，按钮是“发车”

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

    await composer().fill("不用问我");
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
    await dialog.getByLabel("第一个问题").fill("接着做");
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
    await composer().fill("慢慢来，先占着");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await composer().fill("排队的问题");
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
    await composer().fill("慢慢来，再占一会儿");
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
    expect(await composer().isVisible()).toBe(true);
    await shot("17-mid");

    await page.setViewportSize({ width: 900, height: 620 });
    await expect.poll(() => composer().count()).toBe(0);
    await shot("18-narrow");
    await page.getByRole("button", { name: "对话", exact: true }).click();
    await expect.poll(() => composer().isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("19-narrow-drawer");
    await page.getByRole("button", { name: "收起对话" }).click();
    await expect.poll(() => composer().count()).toBe(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => composer().isVisible()).toBe(true);
  });
  it("提问带图片：粘贴进来变成“图 1”小标签，退格两次才删、Ctrl+Z 找回；发出去后气泡里还是小标签，点开看大图", async () => {
    await composer().click();
    await page.keyboard.type("按钮被挡住了，看");
    // 粘贴一张截图（2000 宽，发出去前会缩到长边 1568）
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 2000;
      c.height = 1000;
      const x = c.getContext("2d")!;
      x.fillStyle = "#2563c9";
      x.fillRect(0, 0, 2000, 1000);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "截图.png", { type: "image/png" }));
      document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const tag = composer().getByRole("img", { name: /^图 1：截图\.png$/ });
    await expect.poll(() => tag.count(), { timeout: 10000 }).toBe(1);
    // 退格一次：只选中，再按一次才删；Ctrl+Z 找回来
    await page.keyboard.press("Backspace");
    expect(await page.getByRole("status").filter({ hasText: "再按一次删掉" }).isVisible()).toBe(true);
    expect(await tag.count()).toBe(1);
    await page.keyboard.press("Backspace");
    expect(await tag.count()).toBe(0);
    await page.keyboard.press("Control+z");
    expect(await tag.count()).toBe(1);
    await page.keyboard.type("这里");
    await shot("31-image-composer");
    await page.getByRole("button", { name: "发车" }).click();
    const log = page.getByRole("log");
    // 这一路的批准方式前面改成了“全部不问”，不会停下来等批准
    await expect.poll(() => log.getByText("看到了 1 张图。").count(), { timeout: 30000 }).toBe(1);
    const sent = log.getByRole("button", { name: /^图 1：截图\.png，点开看大图$/ });
    expect(await sent.count()).toBe(1);
    await expect.poll(() => fs.readFileSync(path.join(local, "demo-notes.md"), "utf8"), { timeout: 30000 }).toContain("按钮被挡住了，看[图 1]这里");
    await sent.click();
    const viewer = page.getByRole("dialog", { name: "看大图" });
    expect(await viewer.isVisible()).toBe(true);
    expect(await viewer.getByText(/1568 × 784/).isVisible()).toBe(true);
    await shot("32-image-viewer");
    await page.keyboard.press("Escape");
    expect(await viewer.count()).toBe(0);
  });

  it("回答里的代码块：在后台线程里上色（不卡界面），上好的颜色用 --shiki-* 变量", async () => {
    await composer().click();
    await page.keyboard.type("给我一段代码");
    await page.keyboard.press("Enter");
    const colored = page.getByRole("log").locator('pre code span[style*="--shiki-token-keyword"]');
    await expect.poll(() => colored.count(), { timeout: 30000 }).toBeGreaterThan(0);
    expect(await page.getByRole("log").locator("pre code").last().innerText()).toContain("export function greet(name: string): string {");
    // 打包出来的后台线程在 file:// 页面里起得来、能上色（起不来时会悄悄退回主线程，这里守住）
    const wfile = fs.readdirSync(path.join(root, "out/renderer/assets")).find((f) => f.startsWith("highlight.worker"))!;
    const reply = await page.evaluate(
      (f) =>
        new Promise<string>((resolve) => {
          const w = new Worker(new URL(`./assets/${f}`, location.href), { type: "module" });
          w.onmessage = (e: MessageEvent<{ lines: { color?: string }[][] | null }>) => resolve(e.data.lines?.[0]?.[0]?.color ?? "null");
          w.onerror = (e) => resolve(`error ${e.message}`);
          w.postMessage({ id: 1, code: "const a = 1", lang: "ts" });
        }),
      wfile,
    );
    expect(reply).toBe("var(--shiki-token-keyword)");
  });

  it("在做什么（设计稿 4-8）：在想（数秒、能展开看想的内容）→ 正在写文件（字数跟着涨）；地图上那一站也写着", async () => {
    await composer().click();
    await page.keyboard.type("想一想再写");
    await page.keyboard.press("Enter");
    const log = page.getByRole("log");
    await expect.poll(() => log.getByText("在想", { exact: true }).isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.locator("section[data-pane='map']").getByText("在想", { exact: true }).isVisible()).toBe(true);
    await log.getByRole("button", { name: "看它在想什么" }).click();
    await expect.poll(() => log.getByText(/先看一下要改哪里/).isVisible()).toBe(true);
    await shot("35-thinking");
    await expect.poll(() => log.getByText(/已生成 \d/).isVisible(), { timeout: 30000 }).toBe(true);
    expect(await page.getByText("· 正在写 demo-notes.md").isVisible()).toBe(true);
    expect(await page.locator("section[data-pane='map']").getByText("正在写 demo-notes.md").isVisible()).toBe(true);
    await shot("36-writing");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    expect(await log.getByText("在想", { exact: true }).count()).toBe(0);
  });

  it("模型、起名、后台终端：选模型；站名稍后换成小模型起的；Claude 开的终端在一站结束后还在，能看输出、能停", async () => {
    // 列表是从 Claude Code 读的（演示模式下是假的三个）
    await page.getByRole("button", { name: /^模型：Default/ }).click();
    await page.getByRole("menuitemradio", { name: /Sonnet/ }).click();
    await expect.poll(() => page.getByRole("button", { name: /^模型：Sonnet/ }).isVisible()).toBe(true);
    // 思考强度是单独一个选择；能调哪几档是 Claude Code 说的
    await page.getByRole("button", { name: /^强度：默认/ }).click();
    await page.getByRole("menuitemradio", { name: /^高/ }).click();
    await expect.poll(() => page.getByRole("button", { name: "强度：高" }).isVisible()).toBe(true);

    await composer().fill("起名试试，再开一个终端");
    await page.keyboard.press("Enter");
    // 项目此时是“全部不问”：写文件、开后台终端都不用点批准
    const strip = page.getByRole("region", { name: "后台终端" });
    await expect.poll(() => strip.getByText("演示服务").isVisible(), { timeout: 60000 }).toBe(true);
    // 这一站结束了，终端还在跑
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    await expect.poll(() => strip.getByText("运行中").isVisible()).toBe(true);
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
    await composer().fill("写完拖一会儿");
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
    await composer().fill("慢慢答这一站");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("radio", { name: "手动登车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await page.getByRole("radio", { name: "手动登车" }).click();
    await composer().fill("这一条要我点了才发");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: /本路候车 1 条/ }).isVisible()).toBe(true);
    expect(await page.getByText(/下一站 \d+ 等你登车/).isVisible()).toBe(true);
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
    await fresh.getByRole("button", { name: /^模型：/ }).click();
    await fresh.getByRole("menuitemradio", { name: /^Haiku 5\.5/ }).click();
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
    await expect.poll(() => composer().isVisible()).toBe(true);
  });
  it("地图上的站：点一下看这一站的记录，悬停出卡片；截线删掉这一站和后面的站，问题可以放回输入框", async () => {
    // 前面的测试可能把候车区的浮窗留着，先收起来，免得挡住地图
    const fab = page.getByRole("button", { name: /^候车 \d/ });
    if ((await fab.getAttribute("aria-expanded")) === "true") await fab.click();
    await composer().fill("截线前的一站");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("log").getByText("截线前的一站").first().isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    await composer().fill("要被截掉的一站");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "停车" }).isVisible(), { timeout: 30000 }).toBe(true);
    await expect.poll(() => page.getByRole("button", { name: "停车" }).count(), { timeout: 60000 }).toBe(0);
    const nodes = page.locator('[class*="node"]');
    const count = await nodes.count();

    // 拖动地图：从空白处按下，斜着拖过站名，不会把站名、路牌当文字选中；再拖回原处
    const box = (await page.locator('button[data-prompt="截线前的一站"]').boundingBox())!;
    const from = { x: box.x - 60, y: box.y - 30 };
    const to = { x: box.x + 200, y: box.y + 60 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await page.mouse.down();
    await page.mouse.move(from.x, from.y, { steps: 8 });
    await page.mouse.up();
    expect((await page.locator('button[data-prompt="截线前的一站"]').boundingBox())!.x).toBeCloseTo(box.x, 0);

    // 悬停：出卡片
    await page.locator('button[data-prompt="截线前的一站"]').hover();
    await expect.poll(() => page.getByRole("button", { name: "打开这站" }).isVisible(), { timeout: 10000 }).toBe(true);
    await shot("27-hover-card");
    // 点一下：进入“正在看”
    await page.locator('button[data-prompt="截线前的一站"]').click();
    const bar = page.getByRole("toolbar", { name: "选中的站" });
    await expect.poll(() => bar.isVisible()).toBe(true);
    expect(await page.getByText(/^正在看第 \d+ 站$/).isVisible()).toBe(true);
    expect(await composer().isVisible()).toBe(false);
    // 对话栏只显示到这一站；后面的站在地图上淡下去，但还在
    const chatLog = page.getByRole("log");
    await expect.poll(() => chatLog.getByText("截线前的一站").count()).toBeGreaterThan(0);
    expect(await chatLog.getByText("要被截掉的一站").count()).toBe(0);
    expect(await page.locator('[data-after="true"]:has(button[data-prompt="要被截掉的一站"])').count()).toBe(1);
    expect(await page.locator('button[data-prompt="截线前的一站"]').getAttribute("aria-current")).toBe("step");
    await shot("28-viewing");
    await page.getByRole("button", { name: "回到最新" }).first().click();
    await expect.poll(() => composer().isVisible()).toBe(true);

    // 右键最后一站：改站（截线并把问题放回输入框）
    await page.locator('button[data-prompt="要被截掉的一站"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: /改站/ }).click();
    const cut = page.getByRole("alertdialog", { name: /截线/ });
    expect(await cut.getByRole("checkbox").isChecked()).toBe(true);
    await shot("29-truncate");
    await cut.getByRole("button", { name: "截线", exact: true }).click();
    await expect.poll(() => nodes.count()).toBe(count - 1);
    expect(await composer().innerText()).toBe("要被截掉的一站");
    expect(await page.getByRole("log").getByText("要被截掉的一站").count()).toBe(0);
    await composer().fill("");
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
    // 三档范围：所有项目 ⊃ 这个项目 ⊃ 选中的这一路；派过去以后，“只看 N路”里也有它
    const scopes = area.getByRole("radiogroup", { name: "看哪些" });
    expect(await scopes.getByRole("radio").allInnerTexts()).toEqual([expect.stringMatching(/^所有项目 \d+$/), "my-project", expect.stringMatching(/^只看 \d+路$/)]);
    await scopes.getByRole("radio", { name: /^只看/ }).click();
    await expect.poll(() => area.getByText("拖过去的问题").isVisible()).toBe(true);
    await scopes.getByRole("radio", { name: "my-project" }).click();
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
    // 导入时有进度（设计稿 4-8）：每个会话一行，做到哪一步；导好了窗口自己关掉
    const seen: string[] = [];
    await page.exposeFunction("__importSeen", (t: string) => seen.push(t));
    await page.evaluate(() => {
      const mo = new MutationObserver(() => {
        const d = document.querySelector('[role="dialog"][aria-label="正在导入"]');
        if (d) (window as unknown as { __importSeen(t: string): void }).__importSeen(d.textContent ?? "");
      });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await dialog.getByRole("button", { name: "导入 1 个" }).click();
    await expect.poll(() => page.getByRole("heading", { name: "看一下 session 过期问题" }).isVisible(), { timeout: 30000 }).toBe(true);
    expect(seen.some((t) => t.includes("看一下 session 过期问题") && /复制会话|读出每一站|建工作区/.test(t))).toBe(true);
    await expect.poll(() => page.getByRole("dialog", { name: "正在导入" }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "正在导入，点开看进度" }).count()).toBe(0);
    await expect.poll(() => page.getByText("已到第 4 站").isVisible(), { timeout: 30000 }).toBe(true);
    // 已经导入过的不再列出来
    await page.getByRole("button", { name: "my-project 的菜单" }).click();
    await page.getByRole("menuitem", { name: /导入终端里的会话/ }).click();
    await expect.poll(() => dialog.getByText("升级依赖").isVisible(), { timeout: 30000 }).toBe(true);
    await page.keyboard.press("Escape");
    // 接着问：第 5 站
    await composer().fill("接着导入的会话问");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByText("已到第 5 站").isVisible(), { timeout: 60000 }).toBe(true);
    await shot("34-imported");
  });

  it("面板布局：“布局”小窗里拖方块换位置、点眼睛收起；分隔处悬停一点就收起，收起的移到边上才出现打开按钮", async () => {
    // 宽度动画还在跑（有 data-anim）时不算排好
    const order = () => page.locator("section[data-pane]").evaluateAll((els) => (els.some((e) => e.hasAttribute("data-anim")) ? null : els.filter((e) => !e.hasAttribute("aria-hidden")).map((e) => e.getAttribute("data-pane"))));
    const settled = (want: string[]) => expect.poll(order, { timeout: 3000 }).toEqual(want);
    await settled(["rail", "map", "chat"]);

    // “布局”小窗：点眼睛收起、再打开
    await page.getByRole("button", { name: "布局", exact: true }).click();
    const box = page.getByRole("dialog", { name: "布局" });
    await box.getByRole("button", { name: "收起项目列表" }).click();
    await settled(["map", "chat"]);
    await box.getByRole("button", { name: "打开项目列表" }).click();
    await settled(["rail", "map", "chat"]);
    // 拖“对话”方块到最左
    // 刚打开的面板宽度还在动画，方块跟着变宽；等它停下再按
    const chatBlock = box.getByRole("option", { name: "对话" });
    let last = "";
    await expect
      .poll(
        async () => {
          const b = JSON.stringify(await chatBlock.boundingBox());
          const same = b === last;
          last = b;
          return same;
        },
        { interval: 150 },
      )
      .toBe(true);
    const blk = (await chatBlock.boundingBox())!;
    await page.mouse.move(blk.x + 20, blk.y + 30);
    await page.mouse.down();
    await page.mouse.move(blk.x - 400, blk.y + 30, { steps: 12 });
    await page.mouse.up();
    await settled(["chat", "rail", "map"]);
    await shot("40-layout-popover");
    await box.getByRole("button", { name: "恢复默认" }).click();
    await settled(["rail", "map", "chat"]);
    await page.keyboard.press("Escape");
    expect(await box.count()).toBe(0);

    // 分隔处悬停：收起中间的地图，再从项目和对话之间打开
    const hover = async (name: string) => {
      const r = (await page.getByRole("separator", { name }).boundingBox())!;
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    };
    await hover("地图和对话之间");
    await page.getByRole("button", { name: "收起地图" }).click();
    await settled(["rail", "chat"]);
    await hover("项目列表和对话之间");
    await page.getByRole("button", { name: "打开地图" }).click();
    await settled(["rail", "map", "chat"]);

    // 收起项目列表：不留位置；鼠标贴到窗口最左才出现“› 项目”
    await hover("项目列表和地图之间");
    await page.getByRole("button", { name: "收起项目列表" }).click();
    await settled(["map", "chat"]);
    expect(await page.getByRole("button", { name: "打开项目列表" }).count()).toBe(0);
    const body = (await page.locator("section[data-pane='map']").boundingBox())!;
    await page.mouse.move(4, body.y + body.height / 2);
    await page.getByRole("button", { name: "打开项目列表" }).click();
    await settled(["rail", "map", "chat"]);

    // Ctrl+Alt+L 打开小窗；重开应用布局还在
    await page.keyboard.press("Control+Alt+KeyL");
    expect(await box.isVisible()).toBe(true);
    await box.getByRole("button", { name: "只看对话" }).click();
    await settled(["chat"]);
    await page.reload();
    await settled(["chat"]);
    await page.evaluate(() => localStorage.removeItem("bw.layout"));
    await page.reload();
    await settled(["rail", "map", "chat"]);
  });

  it("Local 专车（设计稿 9-10）：路线标签最左；点常用提示填进输入框，再点撤回；在 Local 里直接回答，不建工作区", async () => {
    const tab = page.getByRole("button", { name: /Local 专车/ });
    await tab.click();
    await expect.poll(() => page.getByText("这辆车直接在 Local 里干活").isVisible(), { timeout: 10000 }).toBe(true);
    const now = page.getByRole("region", { name: "Local 现在" }).first();
    await expect.poll(() => now.getByText("main", { exact: true }).isVisible(), { timeout: 10000 }).toBe(true);
    // 左栏、地图上都没有专车
    expect(await page.locator("aside").getByText("Local 专车").count()).toBeLessThanOrEqual(1);

    const chip = page.getByRole("button", { name: /看看现状/ });
    await chip.click();
    await expect.poll(() => composer().innerText()).toContain("说说 Local 现在的情况");
    expect(await chip.getAttribute("aria-pressed")).toBe("true");
    await chip.click();
    await expect.poll(() => composer().innerText()).toBe("");
    await shot("36-local-car");

    await chip.click();
    await page.keyboard.press("Enter");
    // 批准方式和普通路一样：开专车时沿用项目的（前面开过“全部不问”的话就不会问）
    await expect.poll(async () => (await page.getByRole("alertdialog", { name: "等你批准" }).isVisible()) || (await page.getByText("已到第 1 站").isVisible()), { timeout: 30000 }).toBe(true);
    if (await page.getByRole("alertdialog", { name: "等你批准" }).isVisible()) await page.getByRole("button", { name: /允许这一次/ }).click();
    await expect.poll(() => page.getByText("已到第 1 站").isVisible(), { timeout: 30000 }).toBe(true);
    // 直接写在 Local 里（不经过工作区和同步）；交给 Claude 的提问后面附着 Local 现状，记下来的还是原话
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toContain("站：说说 Local 现在的情况");
    expect(await page.getByText("Lanes 附上了 Local 现在的样子").isVisible()).toBe(true);
    expect(await page.getByText("改动已进 Local").count()).toBe(0);

    // 专车的站不在地图上：在对话里从某一站开新对话（设计稿 9-11）
    await page.locator("[data-stop]").first().hover();
    await page.getByRole("button", { name: "从这一站开新对话" }).click();
    await expect.poll(() => page.getByRole("dialog", { name: /开新对话/ }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByRole("dialog", { name: /开新对话/ }).count()).toBe(0);

    // 重新开始：清掉专车的对话，Local 里的文件不动
    const notes = fs.readFileSync(path.join(local, "demo-notes.md"), "utf8");
    await page.getByRole("button", { name: "专车的更多操作" }).click();
    await page.getByRole("menuitem", { name: /重新开始/ }).click();
    await page.getByRole("button", { name: "清掉，重新开始" }).click();
    await expect.poll(() => page.getByText("这辆车直接在 Local 里干活").isVisible(), { timeout: 10000 }).toBe(true);
    expect(fs.readFileSync(path.join(local, "demo-notes.md"), "utf8")).toBe(notes);
  });

  it("从 Lanes 移除项目：先列出没进 Local 的改动，确认后回到欢迎页，Local 文件夹不动", async () => {
    const before = fs.readdirSync(local).sort();
    await page.getByRole("button", { name: "my-project 的菜单" }).click();
    await page.getByRole("menuitem", { name: /从 Lanes 移除/ }).click();
    const dialog = page.getByRole("alertdialog", { name: "移除 my-project" });
    expect(await dialog.getByText("Local 文件夹不会动").isVisible()).toBe(true);
    await shot("35-remove-project");
    await dialog.getByRole("button", { name: "移除项目" }).click();
    // 前面的测试留下过没答完的站：改动还在工作区里，要再确认一次
    const again = dialog.getByRole("button", { name: "不要这些了，移除" });
    await expect.poll(async () => (await again.isVisible()) || (await page.getByText("先加一个项目").isVisible()), { timeout: 30000 }).toBe(true);
    if (await again.isVisible()) await again.click();
    await expect.poll(() => page.getByText("先加一个项目").isVisible(), { timeout: 30000 }).toBe(true);
    expect(fs.readdirSync(local).sort()).toEqual(before);
  });
});
