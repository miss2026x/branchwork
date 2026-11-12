import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSyncEngine, SyncError } from "../../src/sync";
import { gitStats } from "../../src/sync/git";
import { dump, has, LINES, makeLab, read, replaceLine, sh, write, type Lab } from "./helpers";

let lab: Lab;
beforeEach(async () => {
  lab = await makeLab();
});
afterEach(() => lab.cleanup());

describe("新开一路", () => {
  it("工作区带上 Local 未提交和未跟踪的改动，被忽略的文件不带", async () => {
    write(lab.local, "b.txt", "bee, edited but not committed\n");
    write(lab.local, "new.txt", "untracked\n");
    write(lab.local, ".env", "SECRET=1\n");
    const { path: wt } = await lab.engine.createWorktree("r1");
    expect(read(wt, "b.txt")).toBe("bee, edited but not committed\n");
    expect(read(wt, "new.txt")).toBe("untracked\n");
    expect(has(wt, ".env")).toBe(false);
    // 工作区里看到的 git 状态和 Local 一样：改动没有被提交
    expect(sh(wt, "status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([" M b.txt", "?? new.txt"]);
    expect(sh(wt, "rev-parse", "HEAD")).toBe(sh(lab.local, "rev-parse", "HEAD"));
  });

  it("不改用户的分支、暂存区和提交记录", async () => {
    write(lab.local, "b.txt", "staged\n");
    sh(lab.local, "add", "b.txt");
    write(lab.local, "a.txt", LINES + "unstaged\n");
    const before = { status: sh(lab.local, "status", "--porcelain"), refs: sh(lab.local, "for-each-ref", "refs/heads", "refs/tags") };
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "c.txt", "c\n");
    await lab.engine.pushAfterStop("r1");
    await lab.engine.pullBeforeStop("r1");
    expect(sh(lab.local, "for-each-ref", "refs/heads", "refs/tags")).toBe(before.refs);
    expect(sh(lab.local, "status", "--porcelain")).toBe(before.status + "?? c.txt\n");
    expect(sh(lab.local, "branch", "--list").trim()).toBe("* main");
  });

  it("没有提交的仓库、非仓库目录、不合法的 id 都给出明确错误", async () => {
    const empty = path.join(lab.worktrees, "..", "empty");
    fs.mkdirSync(empty);
    await expect(createSyncEngine({ localDir: empty, worktreesDir: lab.worktrees })).rejects.toMatchObject({ code: "NOT_A_REPO" });
    sh(empty, "init", "-q");
    await expect(createSyncEngine({ localDir: empty, worktreesDir: lab.worktrees })).rejects.toMatchObject({ code: "NO_COMMITS" });
    await expect(createSyncEngine({ localDir: path.join(lab.local, "src"), worktreesDir: lab.worktrees })).rejects.toMatchObject({
      code: "NOT_REPO_ROOT",
    });
    expect(() => lab.engine.worktreePath("../x")).toThrow(SyncError);
    await lab.engine.createWorktree("r1");
    await expect(lab.engine.createWorktree("r1")).rejects.toMatchObject({ code: "WORKTREE_EXISTS" });
    await expect(lab.engine.pushAfterStop("nope")).rejects.toMatchObject({ code: "WORKTREE_MISSING" });
  });
});

describe("站后：工作区 → Local", () => {
  it("两路改不同文件，先后结束，都进 Local", async () => {
    await lab.engine.createWorktree("r1");
    await lab.engine.createWorktree("r2");
    write(lab.wt("r1"), "b.txt", "bee from r1\n");
    write(lab.wt("r2"), "src/app.ts", "export const n = 2;\n");
    expect(await lab.engine.pushAfterStop("r1")).toEqual({ status: "ok", changed: [{ path: "b.txt", kind: "modified" }] });
    expect(await lab.engine.pushAfterStop("r2")).toEqual({ status: "ok", changed: [{ path: "src/app.ts", kind: "modified" }] });
    expect(read(lab.local, "b.txt")).toBe("bee from r1\n");
    expect(read(lab.local, "src/app.ts")).toBe("export const n = 2;\n");
    // r2 的工作区也拿到了 r1 的改动（结束时对齐到合并结果）
    expect(read(lab.wt("r2"), "b.txt")).toBe("bee from r1\n");
  });

  it("两路改同一文件的不同位置，自动合并", async () => {
    await lab.engine.createWorktree("r1");
    await lab.engine.createWorktree("r2");
    write(lab.wt("r1"), "a.txt", replaceLine(LINES, 2, "line 2 by r1"));
    write(lab.wt("r2"), "a.txt", replaceLine(LINES, 18, "line 18 by r2"));
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect((await lab.engine.pushAfterStop("r2")).status).toBe("ok");
    expect(read(lab.local, "a.txt")).toBe(replaceLine(replaceLine(LINES, 2, "line 2 by r1"), 18, "line 18 by r2"));
  });

  it("两路改同一行，后结束的标冲突，Local 和冲突前逐字节相同", async () => {
    await lab.engine.createWorktree("r1");
    await lab.engine.createWorktree("r2");
    write(lab.wt("r1"), "a.txt", replaceLine(LINES, 5, "five by r1"));
    write(lab.wt("r2"), "a.txt", replaceLine(LINES, 5, "five by r2"));
    write(lab.wt("r2"), "other.txt", "also from r2\n");
    await lab.engine.pushAfterStop("r1");
    const before = dump(lab.local);
    const wtBefore = dump(lab.wt("r2"));
    const r = await lab.engine.pushAfterStop("r2");
    expect(r).toMatchObject({ status: "conflict", files: [{ path: "a.txt", reason: "both-modified" }] });
    expect(dump(lab.local)).toEqual(before); // 连没冲突的 other.txt 也没写：一站是一个事务
    expect(dump(lab.wt("r2"))).toEqual(wtBefore); // 工作区保持原样
    // 只有冲突的这一路受影响
    write(lab.wt("r1"), "b.txt", "r1 goes on\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
  });

  it("回答期间用户手改了 Local：不重叠就合并，用户的改动保留", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "a.txt", replaceLine(LINES, 3, "three by claude"));
    write(lab.local, "a.txt", replaceLine(LINES, 15, "fifteen by user"));
    write(lab.local, "notes.md", "user notes\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(read(lab.local, "a.txt")).toBe(replaceLine(replaceLine(LINES, 3, "three by claude"), 15, "fifteen by user"));
    expect(read(lab.local, "notes.md")).toBe("user notes\n");
    expect(read(lab.wt("r1"), "notes.md")).toBe("user notes\n");
    expect((await lab.engine.status("r1")).unsynced).toEqual([]);
  });

  it("回答期间用户手改了 Local 的同一行：冲突，Local 不动", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "bee by claude\n");
    write(lab.local, "b.txt", "bee by user\n");
    const before = dump(lab.local);
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("conflict");
    expect(dump(lab.local)).toEqual(before);
  });

  it("新增、删除、改名、二进制、带空格和中文的文件名", async () => {
    await lab.engine.createWorktree("r1");
    const wt = lab.wt("r1");
    const bin = Buffer.from([0, 255, 1, 254, 0, 0, 13, 10, 200]);
    write(wt, "docs/新 文件.md", "你好\n");
    write(wt, "img/logo.bin", bin);
    fs.rmSync(path.join(wt, "b.txt"));
    fs.renameSync(path.join(wt, "src/app.ts"), path.join(wt, "src/main.ts"));
    const r = await lab.engine.pushAfterStop("r1");
    expect(r.status).toBe("ok");
    expect(read(lab.local, "docs/新 文件.md")).toBe("你好\n");
    expect(fs.readFileSync(path.join(lab.local, "img/logo.bin")).equals(bin)).toBe(true);
    expect(has(lab.local, "b.txt")).toBe(false);
    expect(has(lab.local, "src/app.ts")).toBe(false);
    expect(read(lab.local, "src/main.ts")).toBe("export const n = 1;\n");
  });

  it("删光一个目录后空目录也清掉；文件和目录互换也能处理", async () => {
    await lab.engine.createWorktree("r1");
    const wt = lab.wt("r1");
    fs.rmSync(path.join(wt, "src"), { recursive: true });
    fs.rmSync(path.join(wt, "b.txt"));
    write(wt, "b.txt/inner.txt", "b is a folder now\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(has(lab.local, "src")).toBe(false);
    expect(read(lab.local, "b.txt/inner.txt")).toBe("b is a folder now\n");
    // 再换回来
    fs.rmSync(path.join(wt, "b.txt"), { recursive: true });
    write(wt, "b.txt", "file again\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(read(lab.local, "b.txt")).toBe("file again\n");
  });

  it("被忽略的文件两边都不同步，也不会被删", async () => {
    write(lab.local, ".env", "LOCAL=1\n");
    write(lab.local, "node_modules/x/index.js", "local dep\n");
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), ".env", "WT=1\n");
    write(lab.wt("r1"), "node_modules/y/index.js", "wt dep\n");
    write(lab.wt("r1"), "b.txt", "changed\n");
    expect(await lab.engine.pushAfterStop("r1")).toEqual({ status: "ok", changed: [{ path: "b.txt", kind: "modified" }] });
    expect(read(lab.local, ".env")).toBe("LOCAL=1\n");
    expect(has(lab.local, "node_modules/y")).toBe(false);
    expect(read(lab.local, "node_modules/x/index.js")).toBe("local dep\n");
    expect(read(lab.wt("r1"), ".env")).toBe("WT=1\n");
  });

  it.skipIf(process.platform === "win32")("可执行权限跟着同步", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "run.sh", "#!/bin/sh\necho hi\n");
    fs.chmodSync(path.join(lab.wt("r1"), "run.sh"), 0o755);
    await lab.engine.pushAfterStop("r1");
    expect(fs.statSync(path.join(lab.local, "run.sh")).mode & 0o111).not.toBe(0);
  });

  it("没有改动时是 noop；连续两次第二次是 noop", async () => {
    await lab.engine.createWorktree("r1");
    expect(await lab.engine.pushAfterStop("r1")).toEqual({ status: "noop" });
    write(lab.wt("r1"), "b.txt", "x\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(await lab.engine.pushAfterStop("r1")).toEqual({ status: "noop" });
  });

  it("Claude 在工作区里自己提交了：文件内容照样进 Local，Local 不多出提交", async () => {
    await lab.engine.createWorktree("r1");
    const wt = lab.wt("r1");
    write(wt, "b.txt", "committed in worktree\n");
    sh(wt, "-c", "user.email=c@x", "-c", "user.name=c", "commit", "-qam", "by claude");
    const head = sh(lab.local, "rev-parse", "HEAD");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(read(lab.local, "b.txt")).toBe("committed in worktree\n");
    expect(sh(lab.local, "rev-parse", "HEAD")).toBe(head);
    expect(sh(lab.local, "status", "--porcelain")).toBe(" M b.txt\n");
  });

  it("写 Local 前的一瞬间用户改了同一个文件：不覆盖，重算后两边的改动都在", async () => {
    let n = 0;
    await lab.restart({
      afterMergeComputed: () => {
        if (n++ === 0) write(lab.local, "a.txt", replaceLine(LINES, 15, "user typed this during the merge"));
      },
    });
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "a.txt", replaceLine(LINES, 3, "claude"));
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(n).toBe(2);
    const want = replaceLine(replaceLine(LINES, 3, "claude"), 15, "user typed this during the merge");
    expect(read(lab.local, "a.txt")).toBe(want);
    expect(read(lab.wt("r1"), "a.txt")).toBe(want);
  });

  it("写 Local 前的一瞬间用户改了别的文件：不受影响，下一站前带进工作区", async () => {
    let n = 0;
    await lab.restart({
      afterMergeComputed: () => {
        n++;
        write(lab.local, "late.txt", "user typed this during the merge\n");
        write(lab.local, "src/app.ts", "export const n = 99;\n");
      },
    });
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "claude\n");
    expect(await lab.engine.pushAfterStop("r1")).toEqual({ status: "ok", changed: [{ path: "b.txt", kind: "modified" }] });
    expect(n).toBe(1);
    expect(read(lab.local, "late.txt")).toBe("user typed this during the merge\n");
    expect(read(lab.local, "src/app.ts")).toBe("export const n = 99;\n");
    expect((await lab.engine.pullBeforeStop("r1")).status).toBe("ok");
    expect(read(lab.wt("r1"), "late.txt")).toBe("user typed this during the merge\n");
    expect(read(lab.wt("r1"), "src/app.ts")).toBe("export const n = 99;\n");
  });

  it("要写的文件一直在被改：放弃这次同步并报 LOCAL_BUSY，Claude 的改动不进 Local", async () => {
    let n = 0;
    await lab.restart({ afterMergeComputed: () => write(lab.local, "a.txt", replaceLine(LINES, 15, `v${n++}`)) });
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "a.txt", replaceLine(LINES, 3, "claude"));
    await expect(lab.engine.pushAfterStop("r1")).rejects.toMatchObject({ code: "LOCAL_BUSY" });
    expect(read(lab.local, "a.txt")).toBe(replaceLine(LINES, 15, "v2"));
    expect(await lab.engine.recover()).toEqual({ status: "clean" });
  });

  it("新建文件的位置上 Local 已经有一个被忽略的同名文件：不覆盖", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.local, "node_modules/x.js", "local, ignored\n");
    write(lab.wt("r1"), ".gitignore", ".env\n"); // 工作区里不再忽略 node_modules
    write(lab.wt("r1"), "node_modules/x.js", "from claude\n");
    const before = dump(lab.local);
    expect(await lab.engine.pushAfterStop("r1")).toMatchObject({
      status: "conflict",
      files: [{ path: "node_modules/x.js", reason: "local-file-in-the-way" }],
    });
    expect(dump(lab.local)).toEqual(before);
  });
});

describe("站前：Local → 工作区", () => {
  it("Local 的新变化（包括别的路同步进来的）合并进工作区，工作区自己的改动保留", async () => {
    await lab.engine.createWorktree("r1");
    await lab.engine.createWorktree("r2");
    write(lab.wt("r1"), "b.txt", "from r1\n");
    await lab.engine.pushAfterStop("r1");
    write(lab.local, "user.txt", "typed by user\n");
    write(lab.wt("r2"), "a.txt", replaceLine(LINES, 1, "r2 unfinished work"));
    const r = await lab.engine.pullBeforeStop("r2");
    expect(r.status).toBe("ok");
    expect(read(lab.wt("r2"), "b.txt")).toBe("from r1\n");
    expect(read(lab.wt("r2"), "user.txt")).toBe("typed by user\n");
    expect(read(lab.wt("r2"), "a.txt")).toBe(replaceLine(LINES, 1, "r2 unfinished work"));
    expect(await lab.engine.pullBeforeStop("r2")).toEqual({ status: "noop" });
    // 之后 r2 结束，只把 r2 自己的改动带回 Local
    expect(await lab.engine.pushAfterStop("r2")).toEqual({ status: "ok", changed: [{ path: "a.txt", kind: "modified" }] });
  });

  it("有冲突：工作区和 Local 都不动", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "wt\n");
    write(lab.local, "b.txt", "local\n");
    const [l, w] = [dump(lab.local), dump(lab.wt("r1"))];
    expect(await lab.engine.pullBeforeStop("r1")).toMatchObject({ status: "conflict", files: [{ path: "b.txt" }] });
    expect(dump(lab.local)).toEqual(l);
    expect(dump(lab.wt("r1"))).toEqual(w);
  });

  it("一边修改一边删除，报 modify-delete", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "modified in wt\n");
    fs.rmSync(path.join(lab.local, "b.txt"));
    expect(await lab.engine.pullBeforeStop("r1")).toMatchObject({ status: "conflict", files: [{ path: "b.txt", reason: "modify-delete" }] });
  });

  it("用户在 Local 提交后，工作区的 git 状态跟上，不把已提交的内容显示成改动", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.local, "b.txt", "committed by user\n");
    sh(lab.local, "commit", "-qam", "user commit");
    write(lab.wt("r1"), "wip.txt", "wip\n");
    await lab.engine.pullBeforeStop("r1");
    expect(sh(lab.wt("r1"), "rev-parse", "HEAD")).toBe(sh(lab.local, "rev-parse", "HEAD"));
    expect(sh(lab.wt("r1"), "status", "--porcelain")).toBe("?? wip.txt\n");
  });
});

describe("让当前 Claude 解决", () => {
  it("带冲突标记合进工作区；标记没清掉不能同步；清掉后进 Local", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "bee by claude\n");
    write(lab.local, "b.txt", "bee by user\n");
    write(lab.local, "extra.txt", "non-conflicting local change\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("conflict");

    const r = await lab.engine.mergeForResolve("r1");
    expect(r).toMatchObject({ status: "resolving", files: [{ path: "b.txt" }] });
    const marked = read(lab.wt("r1"), "b.txt");
    expect(marked).toContain("<<<<<<< ");
    expect(marked).toContain("bee by claude");
    expect(marked).toContain("bee by user");
    expect(read(lab.wt("r1"), "extra.txt")).toBe("non-conflicting local change\n");
    expect(read(lab.local, "b.txt")).toBe("bee by user\n"); // Local 仍然没动
    expect((await lab.engine.status("r1")).resolving).toBe(true);

    expect(await lab.engine.pushAfterStop("r1")).toMatchObject({ status: "conflict", files: [{ path: "b.txt", reason: "markers-left" }] });
    expect(read(lab.local, "b.txt")).toBe("bee by user\n");

    write(lab.wt("r1"), "b.txt", "bee by user and claude\n");
    expect(await lab.engine.pushAfterStop("r1")).toEqual({ status: "ok", changed: [{ path: "b.txt", kind: "modified" }] });
    expect(read(lab.local, "b.txt")).toBe("bee by user and claude\n");
    expect((await lab.engine.status("r1")).resolving).toBe(false);
  });
});

describe("删除一路", () => {
  it("有未同步改动时不删，并列出文件；force 才删", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "unsynced\n");
    expect(await lab.engine.removeWorktree("r1")).toEqual({ status: "has-unsynced", files: [{ path: "b.txt", kind: "modified" }] });
    expect(has(lab.worktrees, "r1")).toBe(true);
    expect(await lab.engine.removeWorktree("r1", { force: true })).toEqual({ status: "removed" });
    expect(has(lab.worktrees, "r1")).toBe(false);
    expect(read(lab.local, "b.txt")).toBe("bee\n");
    expect(sh(lab.local, "worktree", "list").trim().split("\n")).toHaveLength(1);
    expect(sh(lab.local, "for-each-ref", "refs/branchwork")).toBe("");
  });

  it("上次删到一半失败、工作区已经残缺：再删一次能删干净，不报错", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "unsynced\n");
    fs.rmSync(path.join(lab.wt("r1"), ".git")); // 残缺：git 已经不认它了
    fs.rmSync(path.join(lab.wt("r1"), "a.txt"));
    expect(await lab.engine.removeWorktree("r1")).toEqual({ status: "removed" });
    await expect.poll(() => has(lab.worktrees, "r1")).toBe(false);
    expect(sh(lab.local, "worktree", "list").trim().split("\n")).toHaveLength(1);
    expect(sh(lab.local, "for-each-ref", "refs/branchwork")).toBe("");
    await lab.engine.createWorktree("r1"); // 同一个 id 还能再开
    expect(read(lab.wt("r1"), "b.txt")).toBe("bee\n");
  });

  it("已同步的路直接删；删完可以用同一个 id 再开", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "synced\n");
    await lab.engine.pushAfterStop("r1");
    expect(await lab.engine.removeWorktree("r1")).toEqual({ status: "removed" });
    await lab.engine.createWorktree("r1");
    expect(read(lab.wt("r1"), "b.txt")).toBe("synced\n");
  });
});

describe("写到一半进程被杀", () => {
  // 在“日志已落盘、Local 还没写”的时点模拟被杀，再手工把一部分文件写进 Local，还原“只写了一半”的现场
  const crash = { afterJournalWritten: () => { throw new Error("simulated crash"); } };
  const copy = (from: string, to: string, f: string) => write(to, f, fs.readFileSync(path.join(from, f)));

  it("重启后补写完成，Local 和工作区一致", async () => {
    await lab.restart(crash);
    await lab.engine.createWorktree("r1");
    const wt = lab.wt("r1");
    write(wt, "a.txt", replaceLine(LINES, 1, "one"));
    write(wt, "b.txt", "two\n");
    write(wt, "c.txt", "three\n");
    fs.rmSync(path.join(wt, "src/app.ts"));
    await expect(lab.engine.pushAfterStop("r1")).rejects.toThrow("simulated crash");
    copy(wt, lab.local, "a.txt"); // 四个改动里只写进了一个
    // 被杀时 git 留下的锁文件
    fs.writeFileSync(path.join(lab.local, ".git", "branchwork", "index-local.lock"), "");

    await lab.restart();
    const r = await lab.engine.recover();
    expect(r).toMatchObject({ status: "recovered", routeId: "r1" });
    expect(dump(lab.local)).toEqual(dump(wt));
    expect(has(lab.local, "src/app.ts")).toBe(false);
    expect((await lab.engine.status("r1")).unsynced).toEqual([]);
    expect(await lab.engine.recover()).toEqual({ status: "clean" });
    // 恢复之后还能正常同步
    write(wt, "b.txt", "after recovery\n");
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("ok");
    expect(read(lab.local, "b.txt")).toBe("after recovery\n");
  });

  it("一个文件都没写就被杀：重启后写完", async () => {
    await lab.restart(crash);
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "claude\n");
    await expect(lab.engine.pushAfterStop("r1")).rejects.toThrow("simulated crash");
    expect(read(lab.local, "b.txt")).toBe("bee\n");
    await lab.restart();
    expect((await lab.engine.recover()).status).toBe("recovered");
    expect(read(lab.local, "b.txt")).toBe("claude\n");
  });

  it("Local 写完、工作区还没对齐时被杀：重启后对齐", async () => {
    await lab.restart({
      afterLocalWritten: () => {
        throw new Error("simulated crash");
      },
    });
    await lab.engine.createWorktree("r1");
    write(lab.local, "user.txt", "user\n");
    write(lab.wt("r1"), "b.txt", "claude\n");
    await expect(lab.engine.pushAfterStop("r1")).rejects.toThrow("simulated crash");
    expect(read(lab.local, "b.txt")).toBe("claude\n");
    expect(has(lab.wt("r1"), "user.txt")).toBe(false);
    await lab.restart();
    expect((await lab.engine.recover()).status).toBe("recovered");
    expect(read(lab.wt("r1"), "user.txt")).toBe("user\n");
    expect(await lab.engine.status("r1")).toMatchObject({ unsynced: [], localAhead: [] });
  });

  it("重启前用户又改了还没写到的文件：不覆盖用户的改动，并报告出来", async () => {
    await lab.restart(crash);
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "a.txt", replaceLine(LINES, 1, "one"));
    write(lab.wt("r1"), "b.txt", "claude\n");
    await expect(lab.engine.pushAfterStop("r1")).rejects.toThrow("simulated crash");
    copy(lab.wt("r1"), lab.local, "a.txt");
    write(lab.local, "b.txt", "user edited after the crash\n");
    await lab.restart();
    const r = await lab.engine.recover();
    expect(r).toMatchObject({ status: "needs-attention", skipped: ["b.txt"] });
    expect(read(lab.local, "b.txt")).toBe("user edited after the crash\n");
    expect(read(lab.local, "a.txt")).toBe(replaceLine(LINES, 1, "one"));
    // 之后再同步：这个文件两边都改了，按冲突处理，而不是悄悄覆盖
    expect((await lab.engine.pushAfterStop("r1")).status).toBe("conflict");
    expect(read(lab.local, "b.txt")).toBe("user edited after the crash\n");
  });

  it("没出过事时 recover 是 clean", async () => {
    expect(await lab.engine.recover()).toEqual({ status: "clean" });
  });
});

describe("串行", () => {
  it("同时发起的多个同步排队执行，结果和依次执行一样", async () => {
    const ids = ["r1", "r2", "r3", "r4"];
    for (const id of ids) await lab.engine.createWorktree(id);
    ids.forEach((id, i) => write(lab.wt(id), "a.txt", replaceLine(LINES, 2 + i * 5, `edited by ${id}`)));
    const results = await Promise.all(ids.map((id) => lab.engine.pushAfterStop(id)));
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
    let want = LINES;
    ids.forEach((id, i) => (want = replaceLine(want, 2 + i * 5, `edited by ${id}`)));
    expect(read(lab.local, "a.txt")).toBe(want);
  });

  it("一个操作出错不会卡住后面的", async () => {
    await lab.engine.createWorktree("r1");
    const bad = lab.engine.pushAfterStop("missing");
    write(lab.wt("r1"), "b.txt", "x\n");
    const good = lab.engine.pushAfterStop("r1");
    await expect(bad).rejects.toBeInstanceOf(SyncError);
    expect((await good).status).toBe("ok");
  });
});

describe("启动 git 的次数（Windows 上每次启动都很慢）", () => {
  const count = async (fn: () => Promise<unknown>) => {
    const before = gitStats.calls;
    await fn();
    return gitStats.calls - before;
  };

  it("站前没有变化：1 次", async () => {
    await lab.engine.createWorktree("r1");
    await lab.engine.pullBeforeStop("r1");
    expect(await count(() => lab.engine.pullBeforeStop("r1"))).toBe(1);
  });

  it("站后，Local 没被别人改过：不超过 7 次", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "1\n");
    await lab.engine.pushAfterStop("r1");
    write(lab.wt("r1"), "b.txt", "2\n");
    write(lab.wt("r1"), "new.txt", "2\n");
    expect(await count(() => lab.engine.pushAfterStop("r1"))).toBeLessThanOrEqual(7);
    expect(read(lab.local, "new.txt")).toBe("2\n");
  });

  it("站后，Local 也有改动需要合并：不超过 14 次", async () => {
    await lab.engine.createWorktree("r1");
    write(lab.wt("r1"), "b.txt", "1\n");
    await lab.engine.pushAfterStop("r1");
    write(lab.wt("r1"), "b.txt", "2\n");
    write(lab.local, "user.txt", "u\n");
    expect(await count(() => lab.engine.pushAfterStop("r1"))).toBeLessThanOrEqual(14);
  });

  it("站后没有变化：不超过 3 次", async () => {
    await lab.engine.createWorktree("r1");
    await lab.engine.pushAfterStop("r1");
    expect(await count(() => lab.engine.pushAfterStop("r1"))).toBeLessThanOrEqual(3);
  });
});

describe("一个仓库同时做多个需求：每个需求一个目录，各是一个项目", () => {
  it("主目录和它的 git worktree 各自当 Local，互不干扰", async () => {
    // 需求 B 的目录：从主目录切出的 git worktree，在自己的分支上
    const localB = path.join(lab.worktrees, "..", "local-feature-b");
    sh(lab.local, "worktree", "add", "-q", "-b", "feature-b", localB);
    write(localB, "b.txt", "feature b baseline\n");
    sh(localB, "commit", "-qam", "b baseline");
    const engineB = await createSyncEngine({ localDir: localB, worktreesDir: path.join(lab.worktrees, "..", "worktrees-b") });

    await lab.engine.createWorktree("a1");
    await engineB.createWorktree("b1");
    expect(read(engineB.worktreePath("b1"), "b.txt")).toBe("feature b baseline\n");
    expect(read(lab.wt("a1"), "b.txt")).toBe("bee\n");

    write(lab.wt("a1"), "a.txt", replaceLine(LINES, 2, "work for feature a"));
    write(engineB.worktreePath("b1"), "a.txt", replaceLine(LINES, 2, "work for feature b"));
    expect((await lab.engine.pushAfterStop("a1")).status).toBe("ok");
    expect((await engineB.pushAfterStop("b1")).status).toBe("ok"); // 同一行，但属于不同的项目：不冲突

    expect(read(lab.local, "a.txt")).toBe(replaceLine(LINES, 2, "work for feature a"));
    expect(read(localB, "a.txt")).toBe(replaceLine(LINES, 2, "work for feature b"));
    expect(read(lab.local, "b.txt")).toBe("bee\n");
    expect(sh(lab.local, "branch", "--show-current").trim()).toBe("main");
    expect(sh(localB, "branch", "--show-current").trim()).toBe("feature-b");

    // 各自提交后，各自的路跟上各自的 HEAD
    sh(localB, "commit", "-qam", "b work");
    write(localB, "more.txt", "more\n");
    expect((await engineB.pullBeforeStop("b1")).status).toBe("ok");
    expect(sh(engineB.worktreePath("b1"), "rev-parse", "HEAD")).toBe(sh(localB, "rev-parse", "HEAD"));
    expect(sh(lab.wt("a1"), "rev-parse", "HEAD")).toBe(sh(lab.local, "rev-parse", "HEAD"));

    // 各自的崩溃日志、状态互不可见
    expect(await engineB.recover()).toEqual({ status: "clean" });
    expect(await lab.engine.status("a1")).toMatchObject({ unsynced: [], localAhead: [] });
    expect(await engineB.removeWorktree("b1")).toEqual({ status: "removed" });
    expect((await lab.engine.status("a1")).worktreePath).toBe(lab.wt("a1"));
  });
});
