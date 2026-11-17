import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { IMAGE_MAX_COUNT, imageTokens } from "../../shared";
import { OBJ, imageUrl, type DraftImage } from "./draft";
import { ImageProblem, looksLikeImage, readImage } from "./image-files";
import css from "./Images.module.css";

/**
 * 能放图片的输入框（设计稿 4-7 方案 B）：图片在光标处变成一个“图 N”小标签，和文字排在一起。
 *
 * 用 contenteditable 做：文字是文本节点，换行是“\n”（white-space: pre-wrap），每张图是一个不可编辑的小标签，
 * 后面跟一个零宽空格（不然光标停不到标签后面）。读的时候标签换成 OBJ，零宽空格去掉。
 * 插入和删除都走 document.execCommand，Ctrl+Z 能撤销（包括找回删掉的图）。
 */

const ZW = "​";
const WARN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9.5 17h-19L12 3zM12 10v5M12 18v.01"/></svg>`;

export interface PromptInputHandle {
  /** 放进几张图：at 是拖到的位置（插在那里），不给就插在光标处（输入框没有过光标就放最后） */
  insertFiles(files: File[], at?: { x: number; y: number }): void;
  /** 打开选文件的窗口（回形针） */
  pickFiles(): void;
  focus(): void;
}

interface Props {
  /** 文字里每张图占一个 OBJ，第 k 个对应 images[k] */
  text: string;
  images: DraftImage[];
  onChange(text: string, images: DraftImage[]): void;
  /** 一张图处理好了（或处理失败） */
  onImage(id: string, patch: Partial<DraftImage>): void;
  /** 按了 Enter（没按 Shift） */
  onEnter(): void;
  newId(): string;
  label: string;
  placeholder: string;
  disabled?: boolean;
}

const isTag = (n: Node | null | undefined): n is HTMLElement => n instanceof HTMLElement && !!n.dataset.img;
const blank = (n: Node | null) => !!n && n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? "").replaceAll(ZW, "") === "";
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** 一个小标签的 HTML（插入用；之后由 decorate 更新编号、状态和小图） */
function tagHtml(img: DraftImage): string {
  return `<span class="${css.tag}" contenteditable="false" data-img="${escapeHtml(img.id)}" role="img"></span>${ZW}`;
}

/** 输入框的内容 → 文字（图片换成 OBJ）和图片的顺序 */
function read(el: HTMLElement): { text: string; ids: string[] } {
  let text = "";
  const ids: string[] = [];
  const walk = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) text += (c.nodeValue ?? "").replaceAll(ZW, "").replaceAll(" ", " ");
      else if (isTag(c)) (text += OBJ), ids.push(c.dataset.img!);
      else if (c.nodeName === "BR") text += "\n";
      else if (c.nodeName === "DIV" || c.nodeName === "P") {
        if (text && !text.endsWith("\n")) text += "\n";
        walk(c);
      } else walk(c);
    }
  };
  walk(el);
  // 末尾换行之后，浏览器会再垫一个换行好让光标停在空的那一行上
  if (text.endsWith("\n")) text = text.slice(0, -1);
  return { text, ids };
}

const keyOf = (text: string, ids: string[]) => `${text}\u0000${ids.join(",")}`;

export const PromptInput = forwardRef<PromptInputHandle, Props>(function PromptInput({ text, images, onChange, onImage, onEnter, newId, label, placeholder, disabled }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** 见过的所有图片（包括删掉的：Ctrl+Z 会把标签找回来） */
  const registry = useRef(new Map<string, DraftImage>());
  /** 上一次读到或画上去的内容；和外面传进来的一样就不重画（重画会丢光标） */
  const last = useRef<string | null>(null);
  const composing = useRef(false);
  /** 最后一次光标在输入框里的位置（拖到对话栏别处、点回形针时插在这里） */
  const lastRange = useRef<Range | null>(null);
  /** 从输入框复制出去的文字，和里面的图（粘贴回来时还原成标签） */
  const clip = useRef<{ text: string; ids: string[] } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: string; n: number; left: number; bottom: number; pinned: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [dropAt, setDropAt] = useState<{ left: number; top: number; height: number } | null>(null);
  const [empty, setEmpty] = useState(text === "");

  for (const i of images) registry.current.set(i.id, i);

  /** 按顺序给标签写上“图 N”，换上小图 / 转圈 / 三角 */
  const decorate = () => {
    const root = el.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-img]").forEach((t, i) => {
      const img = registry.current.get(t.dataset.img!);
      const state = img?.state ?? "bad";
      const n = String(i + 1);
      const look = `${state}:${img?.image ? img.image.data.length : 0}:${n}`;
      if (t.dataset.look === look) return;
      t.dataset.look = look;
      t.dataset.state = state;
      t.setAttribute("aria-label", `图 ${n}${img ? `：${img.name}` : ""}${state === "loading" ? "（处理中）" : state === "bad" ? "（读不了）" : ""}`);
      const pic = state === "ready" && img?.image ? `<img src="${imageUrl(img.image)}" alt="" draggable="false">` : state === "loading" ? "<i></i>" : WARN;
      t.innerHTML = `${pic}<b>图 ${n}</b>`;
    });
  };

  /** 外面给的内容画进输入框 */
  const paint = (value: string, list: DraftImage[]) => {
    const root = el.current!;
    root.textContent = "";
    let k = 0;
    let run = "";
    const flush = () => run && (root.append(run), (run = ""));
    for (const ch of value) {
      if (ch !== OBJ) {
        run += ch;
        continue;
      }
      flush();
      const img = list[k++];
      if (!img) continue;
      const span = document.createElement("span");
      span.className = css.tag!;
      span.contentEditable = "false";
      span.dataset.img = img.id;
      span.setAttribute("role", "img");
      root.append(span, ZW);
    }
    if (value.endsWith("\n")) run += "\n";
    flush();
  };

  /** 输入框里现在的样子 → 告诉外面 */
  const sync = () => {
    const root = el.current;
    if (!root || composing.current) return;
    const { text: value, ids } = read(root);
    const list = ids.map((id) => registry.current.get(id)).filter((x): x is DraftImage => !!x);
    decorate();
    last.current = keyOf(value, ids);
    setEmpty(value === "");
    onChange(value, list);
  };

  useLayoutEffect(() => {
    const root = el.current;
    if (!root) return;
    const key = keyOf(text, images.map((i) => i.id));
    if (key !== last.current) {
      paint(text, images);
      last.current = key;
      setEmpty(text === "");
      // 内容是从外面换的（改站放回来、发车后清空）：光标放到最后
      if (document.activeElement === root) caretAtEnd();
    }
    decorate();
  });

  // 记住光标最后在哪
  useEffect(() => {
    const onSel = () => {
      const s = getSelection();
      if (s && s.rangeCount > 0 && el.current?.contains(s.anchorNode)) lastRange.current = s.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const caretAtEnd = () => {
    const root = el.current!;
    const r = document.createRange();
    r.selectNodeContents(root);
    r.collapse(false);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };

  /** 在给定位置（或上次的光标处）插入一段 HTML；走 execCommand，Ctrl+Z 能撤销 */
  const insertHtml = (html: string, range?: Range | null) => {
    const root = el.current;
    if (!root || disabled) return;
    root.focus();
    const s = getSelection()!;
    const at = range ?? (s.rangeCount > 0 && root.contains(s.anchorNode) ? null : lastRange.current);
    if (at && root.contains(at.startContainer)) {
      s.removeAllRanges();
      s.addRange(at);
    } else if (!(s.rangeCount > 0 && root.contains(s.anchorNode))) {
      caretAtEnd();
    }
    document.execCommand("insertHTML", false, html);
    sync();
  };

  const patch = (id: string, p: Partial<DraftImage>) => {
    const cur = registry.current.get(id);
    if (cur) registry.current.set(id, { ...cur, ...p });
    onImage(id, p);
    decorate();
  };

  const insertFiles = (files: File[], at?: { x: number; y: number }) => {
    const pics = files.filter(looksLikeImage);
    if (pics.length === 0 || disabled) return;
    const have = el.current?.querySelectorAll("[data-img]").length ?? 0;
    const entries = pics.map((f, i): DraftImage => {
      const tooMany = have + i >= IMAGE_MAX_COUNT;
      return { id: newId(), state: tooMany ? "bad" : "loading", name: f.name || "粘贴的图片", reason: tooMany ? `一个问题最多带 ${IMAGE_MAX_COUNT} 张图` : undefined };
    });
    for (const e of entries) registry.current.set(e.id, e);
    const range = at ? document.caretRangeFromPoint?.(at.x, at.y) : null;
    insertHtml(entries.map(tagHtml).join(""), range && el.current?.contains(range.startContainer) ? range : null);
    entries.forEach((e, i) => {
      if (e.state !== "loading") return;
      readImage(pics[i]!).then(
        (image) => patch(e.id, { state: "ready", image, name: image.name }),
        (err: unknown) => patch(e.id, { state: "bad", reason: err instanceof ImageProblem ? err.message : "这张图读不出来，换一张试试" }),
      );
    });
  };

  useImperativeHandle(ref, () => ({
    insertFiles,
    pickFiles: () => fileInput.current?.click(),
    focus: () => el.current?.focus(),
  }));

  // ── 退格两次才删 ──
  const clearPicked = () => {
    el.current?.querySelectorAll<HTMLElement>("[data-picked]").forEach((t) => delete t.dataset.picked);
    setPicked(null);
  };
  /** 光标紧挨着的标签（跳过零宽空格）：before 找左边的，否则找右边的 */
  const tagNextTo = (before: boolean): HTMLElement | null => {
    const s = getSelection();
    if (!s || !s.isCollapsed || !s.anchorNode || !el.current?.contains(s.anchorNode)) return null;
    const node = s.anchorNode;
    const off = s.anchorOffset;
    let n: Node | null;
    if (node.nodeType === Node.TEXT_NODE) {
      const v = node.nodeValue ?? "";
      if ((before ? v.slice(0, off) : v.slice(off)).replaceAll(ZW, "") !== "") return null;
      n = before ? node.previousSibling : node.nextSibling;
    } else {
      n = before ? (node.childNodes[off - 1] ?? null) : (node.childNodes[off] ?? null);
    }
    while (blank(n)) n = before ? n!.previousSibling : n!.nextSibling;
    return isTag(n) ? n : null;
  };
  const removeTag = (t: HTMLElement) => {
    const s = getSelection()!;
    const r = document.createRange();
    r.selectNode(t);
    // 把它后面的零宽空格一起删掉
    if (t.nextSibling?.nodeType === Node.TEXT_NODE && t.nextSibling.nodeValue?.startsWith(ZW)) r.setEnd(t.nextSibling, 1);
    s.removeAllRanges();
    s.addRange(r);
    document.execCommand("delete");
    setPreview(null);
    sync();
  };
  const numberOf = (t: HTMLElement) => [...(el.current?.querySelectorAll("[data-img]") ?? [])].indexOf(t) + 1;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || composing.current) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) document.execCommand("insertLineBreak");
      else onEnter();
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = tagNextTo(e.key === "Backspace");
      if (t) {
        e.preventDefault();
        if (t.dataset.picked) {
          clearPicked();
          removeTag(t);
        } else {
          clearPicked();
          t.dataset.picked = "true";
          setPicked(numberOf(t));
        }
        return;
      }
    }
    if (picked !== null && !["Shift", "Control", "Meta", "Alt"].includes(e.key)) clearPicked();
  };

  // ── 复制、剪切、粘贴 ──
  const onCopy = (e: ClipboardEvent<HTMLDivElement>, cut = false) => {
    const s = getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) return;
    const all = [...(el.current?.querySelectorAll<HTMLElement>("[data-img]") ?? [])].map((t) => t.dataset.img!);
    const frag = s.getRangeAt(0).cloneContents();
    let out = "";
    const ids: string[] = [];
    const walk = (n: Node) => {
      for (const c of n.childNodes) {
        if (c.nodeType === Node.TEXT_NODE) out += (c.nodeValue ?? "").replaceAll(ZW, "");
        else if (isTag(c)) (out += `[图 ${all.indexOf(c.dataset.img!) + 1}]`), ids.push(c.dataset.img!);
        else if (c.nodeName === "BR") out += "\n";
        else walk(c);
      }
    };
    walk(frag);
    e.preventDefault();
    e.clipboardData.setData("text/plain", out);
    clip.current = ids.length > 0 ? { text: out, ids } : null;
    if (cut) {
      document.execCommand("delete");
      sync();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = [...e.clipboardData.files].filter(looksLikeImage);
    if (files.length > 0) return insertFiles(files);
    const plain = e.clipboardData.getData("text/plain");
    if (!plain) return;
    // 从这个输入框复制出去的那段：图片还在，就还原成标签（每张给一个新编号，复制了两份也是两张）
    if (clip.current && plain === clip.current.text) {
      const ids = clip.current.ids;
      let k = 0;
      const html = plain
        .split(/(\[图 \d+\])/)
        .map((part) => {
          if (!/^\[图 \d+\]$/.test(part)) return escapeHtml(part);
          const old = registry.current.get(ids[k++] ?? "");
          if (!old) return escapeHtml(part);
          const copy: DraftImage = { ...old, id: newId() };
          registry.current.set(copy.id, copy);
          return tagHtml(copy);
        })
        .join("");
      return insertHtml(html);
    }
    document.execCommand("insertText", false, plain);
  };

  // ── 拖到文字上：跟着鼠标的插入线 ──
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e) || disabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const box = wrap.current!.getBoundingClientRect();
    const rect = r && el.current?.contains(r.startContainer) ? r.getClientRects()[0] ?? (r.startContainer as Element).getBoundingClientRect?.() : null;
    setDropAt(rect ? { left: rect.left - box.left, top: rect.top - box.top, height: rect.height || 20 } : null);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e) || disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDropAt(null);
    insertFiles([...e.dataTransfer.files], { x: e.clientX, y: e.clientY });
  };

  // ── 悬停 / 点标签：预览 ──
  const showPreview = (t: HTMLElement, pinned: boolean) => {
    const box = wrap.current!.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    setPreview({ id: t.dataset.img!, n: numberOf(t), left: Math.max(0, Math.min(r.left - box.left - 20, box.width - 260)), bottom: box.bottom - r.top + 8, pinned });
  };
  const onMouseOver = (e: React.MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-img]");
    window.clearTimeout(hoverTimer.current);
    if (t) hoverTimer.current = window.setTimeout(() => showPreview(t, false), 300);
    else if (preview && !preview.pinned) hoverTimer.current = window.setTimeout(() => setPreview((p) => (p?.pinned ? p : null)), 200);
  };
  const shown = preview ? registry.current.get(preview.id) : undefined;

  useEffect(() => {
    if (!preview?.pinned) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setPreview(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [preview?.pinned]);

  return (
    <div ref={wrap} className={css.wrap} onDragLeave={() => setDropAt(null)} onMouseLeave={() => (window.clearTimeout(hoverTimer.current), setPreview((p) => (p?.pinned ? p : null)))}>
      {picked !== null && (
        <div className={css.hint} role="status">
          选中了 <b>图 {picked}</b>，再按一次删掉；Ctrl+Z 能找回来
        </div>
      )}
      <div
        ref={el}
        className={css.editor}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-disabled={disabled || undefined}
        data-placeholder={placeholder}
        data-empty={empty || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={(e) => {
          clearPicked();
          sync();
          // 撤销找回来的东西是选中的，接着打字会把它换掉：光标放到它后面
          if ((e.nativeEvent as InputEvent).inputType === "historyUndo") getSelection()?.collapseToEnd();
        }}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => ((composing.current = false), sync())}
        onKeyDown={onKeyDown}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onMouseOver={onMouseOver}
        onMouseDown={(e) => {
          const t = (e.target as HTMLElement).closest<HTMLElement>("[data-img]");
          clearPicked();
          if (t) {
            e.preventDefault();
            showPreview(t, true);
          }
        }}
      />
      {dropAt && <i className={css.dropLine} style={{ left: dropAt.left, top: dropAt.top, height: dropAt.height }} />}
      {preview && shown && (
        <div className={css.preview} style={{ left: preview.left, bottom: preview.bottom }} onMouseEnter={() => window.clearTimeout(hoverTimer.current)} role="dialog" aria-label={`图 ${preview.n}`}>
          {shown.state === "ready" && shown.image ? <img src={imageUrl(shown.image)} alt={`图 ${preview.n}`} /> : <div className={css.previewState} data-bad={shown.state === "bad" || undefined}>{shown.state === "loading" ? "正在处理这张图…" : (shown.reason ?? "这张图读不了")}</div>}
          <div className={css.previewMeta}>
            <span>
              <b>{shown.name}</b>
              {shown.image && `${shown.image.width} × ${shown.image.height} · 约 ${(imageTokens(shown.image) / 1000).toFixed(1)}k token`}
            </span>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const t = el.current?.querySelector<HTMLElement>(`[data-img="${CSS.escape(preview.id)}"]`);
                if (t) removeTag(t);
              }}
            >
              删除
            </button>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          insertFiles(files);
        }}
      />
    </div>
  );
});
