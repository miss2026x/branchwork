# Branchwork

Claude CLI 的多对话图形客户端。技术方案见设计文档；这里是代码。

当前进度：

| 模块 | 做什么 | 状态 |
| --- | --- | --- |
| `src/shared` | 两边共用的类型、事件、`window.bw` 的接口 | 完成 |
| `src/sync` | 工作区和 Local 之间的站级同步 | 完成 |
| `src/db` | 存项目、路、站、同步记录 | 完成 |
| `src/claude` | 和 Claude 对接（Agent SDK），含提前启动 | 完成 |
| `src/core` | 把上面几块拼成“问一站”的完整流程 | 完成到第 3 步的范围 |
| `src/main`、`src/preload` | Electron 窗口，把 `core` 接到界面上 | 完成 |
| `src/renderer` | 界面：左栏、线路图、对话面板 | 问一站、批准（三档）、停车、从一站分叉、压缩成快线、冲突处理、归档、删除（带未同步保护）。候车、搜索、终端未做 |

## 运行

需要 Node 22+ 和 git 2.40+。

```
npm install
npm test            # 跑全部测试（要启动很多次 git；启动进程慢的机器上要十几分钟）
npm run test:fast   # 只跑不碰 git 的测试，几秒钟
npm run typecheck   # 类型检查
npm run bench:sync -- 100000   # 大仓库耗时测试（参数是文件数）
```

## 打开应用

```
pnpm dev                      # 打开窗口，用真的 Claude（需要本机已登录 Claude Code）
pnpm build && pnpm start      # 构建后运行
```

不想等真的 Claude、只想看界面和同步，可以用演示模式：Claude 换成一个按固定剧本回答的假实现，其余都是真的（真的建工作区、真的把改动同步进项目目录，会往项目里写一个 `demo-notes.md`）。

```
$env:BRANCHWORK_DEMO=1; pnpm dev        # Windows PowerShell
BRANCHWORK_DEMO=1 pnpm dev              # macOS / Linux
```

只调界面样式时，可以完全不启动 Electron，在浏览器里用内存里的假数据：

```
pnpm dev:web                  # 打开 http://localhost:5199 ；加 ?empty 看空白状态，?live 自动问一站
```

**批准方式**：输入框左下角的“批准：每次都问”可以改成“改文件不问”或“全部不问”（相当于 `--dangerously-skip-permissions`），对整个项目里所有的路生效，随时能改回去。

应用和命令行工具在开发时共用一份数据（`~/.branchwork-dev`），所以命令行里问过的项目和路在窗口里都能看到。

整个应用的自动测试（真的启动 Electron，Claude 用演示实现）：

```
pnpm build && pnpm test:e2e
```

## 不带界面试用（需要本机已登录 Claude Code）

```
pnpm bw ask <项目目录> "把 README 的标题改成中文"     # 在 1 路上问一站
pnpm bw ask <项目目录> "再加一段安装说明"            # 接着同一个会话问第二站
pnpm bw ask <项目目录> "另一件事" --route 2          # 在 2 路上问
pnpm bw chat <项目目录>                            # 连着问：每输入一行就是一站
pnpm bw status <项目目录>                          # 各路、各站、同步状态
pnpm bw resync <项目目录> --route 2                 # 手工处理冲突后重新同步
```

回答途中按 Ctrl+C 是停车。`chat` 不退出，所以每一站结束后会在后台提前把 Claude 启动好，下一站不用再等启动（启动在有些机器上要几十秒）。让别的程序（比如另一个 AI）代跑时没有人能回答批准提示，会一律按拒绝处理；加 `--allow` 自动批准，加 `--stop-after 5` 在问出去 5 秒后自动停车，加 `--stop-after-output 3` 在 Claude 开始输出 3 秒后自动停车，加 `--trace` 列出每条 git 命令的耗时。数据（数据库和各路的工作区）放在 `~/.branchwork-dev`，删掉这个目录即可重来。

## 模块规则

每个模块只通过自己的 `index.ts` 对外；模块之间只传普通数据；每个外部依赖只进一个模块。

```
shared  ←  sync（git）    ┐
        ←  db（SQLite）   ├─  core  ←  main（Electron） ⇠ window.bw ⇢  renderer（界面）
        ←  claude（SDK）  ┘
```

`sync`、`db`、`claude` 互相不认识，只有 `core` 把它们连起来。界面碰不到 Node，只能通过 `window.bw` 调用主进程；界面内部只有 `stores/store.ts` 碰 `window.bw`，线路图、对话面板这些组件只收数据、发事件。这些规则由 `tests/architecture.test.ts` 检查，违反了测试会失败。

数据库用的是 Node 自带的 `node:sqlite`（Node 22.13 起可用，运行时会打印一行“实验性功能”的提示），不需要编译原生模块。以后如果要换成 better-sqlite3，只改 `src/db/database.ts` 一个文件。

## 同步引擎怎么用

```ts
import { createSyncEngine } from "./src/sync";

const sync = await createSyncEngine({ localDir: "/path/to/project", worktreesDir: "/path/to/app-data/worktrees/p1" });

await sync.recover();                    // 应用启动时：检查上次有没有写到一半
await sync.createWorktree("route-1");    // 新开一路
await sync.pullBeforeStop("route-1");    // 每一站发出前
// …Claude 在 sync.worktreePath("route-1") 里回答…
await sync.pushAfterStop("route-1");     // 只在这一站正常结束后
```

`pullBeforeStop` 和 `pushAfterStop` 返回三种结果之一：

- `{ status: "noop" }`：没有要同步的。
- `{ status: "ok", changed }`：已同步，`changed` 是写进目标目录的文件。
- `{ status: "conflict", files }`：有冲突，**目标目录一个字节都没写**。

其他操作：`mergeForResolve`（“让当前 Claude 解决”）、`status`、`removeWorktree`（有未同步改动时默认不删）。

## 它保证什么

- 有冲突时 Local 不被写；一站的改动要么全进 Local，要么全不进。
- 不改用户的分支、暂存区、提交记录。基线存在 `refs/branchwork/` 下，引擎自己的状态存在 `.git/branchwork/` 下。
- 被 `.gitignore` 忽略的文件两边都不同步，也不会被删。
- 所有操作排队执行，同一时刻只有一个在读写 Local。
- 写 Local 时，要改的文件如果在最后一刻被用户改了，整次写入被拒绝并重算，不会覆盖。
- 写 Local 之前先记日志；写到一半进程被杀，下次启动 `recover()` 会补写完，且不覆盖这期间用户改过的文件。

## 一个仓库同时做多个需求

不要在 Local 里来回切分支。每个需求用 `git worktree add` 切一个自己的目录，每个目录在 Branchwork 里是一个独立的项目（各建一个引擎，`localDir` 指向各自的目录）。它们的同步状态互不干扰。同一个仓库下所有项目的路 id 不能重复。

## 已知的行为和限制

- Claude 在工作区里自己做的 git 提交不会带回 Local，只带文件内容（在 Local 里显示为未提交的改动）。
- 仓库必须至少有一次提交；`localDir` 必须是仓库根目录。
- 子模块和嵌套的 git 仓库没有处理。
- 冲突标记里两边的名字目前是提交号，不是“Local / 这一路”。
- 在 Linux 和 Windows 上跑过测试，macOS 上还没跑。
- 有些 Windows 机器上启动任何进程都很慢（实测每条 git 命令约 0.3 秒）。引擎为此做了三件事：尽量少启动 git（站前没变化 1 次，站后通常 7 次，测试里有上限检查）；互不相干的命令同时跑；在 Windows 上绕过 `Git\cmd\git.exe` 这个转发器，直接运行真正的 `git.exe`。最后一项可以用环境变量 `BRANCHWORK_GIT=git` 关掉。
- `npm run diagnose` 会打印这台机器上每条 git 命令的耗时。
