import { describe, expect, it } from "vitest";
import { parseStatus } from "../../src/sync/local-git";

describe("读 Local 的 git status", () => {
  it("分支、远端、领先落后；改、加、删、改名、没跟踪、冲突", () => {
    const out = ["## main...origin/main [ahead 1, behind 3]", " M src/a.ts", "A  src/new.ts", " D old.ts", "R  b2.ts", "b.ts", "?? notes.md", "UU src/routes.ts", "AA both.ts", ""].join("\0");
    expect(parseStatus(out)).toEqual({
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 3,
      files: [
        { path: "src/a.ts", state: "modified" },
        { path: "src/new.ts", state: "added" },
        { path: "old.ts", state: "deleted" },
        { path: "b2.ts", state: "renamed" },
        { path: "notes.md", state: "untracked" },
        { path: "src/routes.ts", state: "conflict" },
        { path: "both.ts", state: "conflict" },
      ],
    });
  });
  it("没有远端、还没有提交、没在分支上、远端分支没了", () => {
    expect(parseStatus("## main\0")).toMatchObject({ branch: "main", upstream: null, ahead: 0, behind: 0 });
    expect(parseStatus("## No commits yet on main\0")).toMatchObject({ branch: "main", upstream: null });
    expect(parseStatus("## HEAD (no branch)\0")).toMatchObject({ branch: null, upstream: null });
    expect(parseStatus("## dev...origin/dev [gone]\0")).toMatchObject({ branch: "dev", upstream: null });
  });
});
