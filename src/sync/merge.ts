import { git } from "./git";
import type { ConflictFile, ConflictReason } from "./types";

export interface MergeOutcome {
  /** 合并出的文件树。有冲突时，冲突文件里带冲突标记 */
  tree: string;
  conflicts: ConflictFile[];
}

/**
 * 三方合并，只在 git 的对象库里算，不碰任何工作目录。
 * base 是共同起点；结果 = ours 加上 theirs 相对 base 的变化。
 */
export async function mergeTrees(dir: string, base: string, ours: string, theirs: string): Promise<MergeOutcome> {
  const r = await git(dir, ["merge-tree", "--write-tree", "-z", "--name-only", `--merge-base=${base}`, ours, theirs], {
    okCodes: [1],
  });
  const tok = r.stdout.split("\0");
  const tree = tok[0]!.trim();
  if (r.code === 0) return { tree, conflicts: [] };

  // 输出格式：树 \0 冲突文件名… \0 \0 然后是若干条说明（路径数、路径…、类型、文字）
  let i = 1;
  const names: string[] = [];
  while (i < tok.length && tok[i] !== "") names.push(tok[i++]!);
  i++;
  const notes = new Map<string, { type: string; text: string }>();
  while (i < tok.length) {
    const n = Number.parseInt(tok[i]!, 10);
    if (!Number.isFinite(n)) break;
    const paths = tok.slice(i + 1, i + 1 + n);
    const type = tok[i + 1 + n] ?? "";
    const text = (tok[i + 2 + n] ?? "").trim();
    i += 3 + n;
    if (!type.startsWith("CONFLICT")) continue;
    for (const p of paths) if (!notes.has(p)) notes.set(p, { type, text });
  }
  const conflicts = [...new Set(names)].map((p): ConflictFile => {
    const note = notes.get(p);
    return { path: p, reason: reasonOf(note?.type ?? ""), detail: note?.text ?? "" };
  });
  // 内容冲突：从带标记的合并结果里数出冲突在第几行
  await Promise.all(
    conflicts
      .filter((c) => c.reason === "both-modified" || c.reason === "both-added")
      .map(async (c) => {
        const blob = await git(dir, ["cat-file", "-p", `${tree}:${c.path}`], { okCodes: [128] });
        const lines = blob.code === 0 ? conflictLines(blob.stdout) : [];
        if (lines.length > 0) c.lines = lines;
      }),
  );
  return { tree, conflicts };
}

function reasonOf(type: string): ConflictReason {
  if (type.includes("contents")) return "both-modified";
  if (type.includes("add/add")) return "both-added";
  if (type.includes("modify/delete")) return "modify-delete";
  if (type.includes("binary")) return "binary";
  if (type.includes("rename")) return "rename";
  return "other";
}

/** 带冲突标记的文件里，每处冲突在“我方”那一份里是第几行到第几行 */
export function conflictLines(text: string): [number, number][] {
  const out: [number, number][] = [];
  let line = 0; // 我方这一份数到第几行了
  let state: "none" | "ours" | "theirs" = "none";
  let from = 0;
  for (const l of text.split("\n")) {
    if (state === "none" && l.startsWith("<<<<<<< ")) {
      state = "ours";
      from = line + 1;
    } else if (state === "ours" && (l.startsWith("||||||| ") || l === "=======")) {
      state = "theirs";
      out.push([from, Math.max(from, line)]);
    } else if (state === "theirs" && l.startsWith(">>>>>>> ")) {
      state = "none";
    } else if (state !== "theirs") {
      line++;
    }
  }
  return out;
}
