/**
 * 三个面板（项目列表、地图、对话）怎么摆（设计稿 9-7“面板布局”）：
 * - 每个都能单独收起，至少留一个
 * - 三个任意排序，收起再打开回到原来的位置
 * - 宽度：有地图时地图占剩下的宽度；没有地图时对话占；只剩项目列表时它占。其余的用拖出来的宽度
 * 都记在这台电脑上（localStorage），读不到就用默认的
 */
export type PaneId = "rail" | "map" | "chat";

export interface Layout {
  /** 三个面板从左到右的顺序（收起的也在里面，记着它原来的位置） */
  order: PaneId[];
  hidden: PaneId[];
  /** 拖出来的宽度；null 是默认 */
  width: Record<PaneId, number | null>;
}

export const PANES: Record<PaneId, { label: string; key: string; min: number; max: number; base: number }> = {
  rail: { label: "项目", key: "1", min: 200, max: 400, base: 264 },
  map: { label: "地图", key: "2", min: 320, max: 1600, base: 640 },
  chat: { label: "对话", key: "3", min: 340, max: 680, base: 420 },
};

export const DEFAULT_LAYOUT: Layout = { order: ["rail", "map", "chat"], hidden: [], width: { rail: null, map: null, chat: null } };

const STORE = "bw.layout";
const ALL: PaneId[] = ["rail", "map", "chat"];

/** 读记下来的布局；老版本只记了 bw.widths（rail、panel）也认 */
export function loadLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null") as Partial<Layout> | null;
    if (raw) return normalize(raw);
    const old = JSON.parse(localStorage.getItem("bw.widths") ?? "{}") as { rail?: number | null; panel?: number | null };
    return { ...DEFAULT_LAYOUT, width: { rail: old.rail ?? null, map: null, chat: old.panel ?? null } };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(STORE, JSON.stringify(layout));
  } catch {
    // 记不住也没关系，下次用默认的
  }
}

/** 记下来的东西可能是旧的、坏的：顺序补齐三个、去重；不能全收起 */
export function normalize(raw: Partial<Layout>): Layout {
  const order = [...new Set((raw.order ?? []).filter((p): p is PaneId => ALL.includes(p as PaneId)))];
  for (const p of ALL) if (!order.includes(p)) order.push(p);
  const hidden = [...new Set((raw.hidden ?? []).filter((p): p is PaneId => ALL.includes(p as PaneId)))];
  const width = { ...DEFAULT_LAYOUT.width, ...(raw.width ?? {}) };
  return { order, hidden: hidden.length >= ALL.length ? [] : hidden, width };
}

export const visible = (l: Layout): PaneId[] => l.order.filter((p) => !l.hidden.includes(p));

/** 占剩下宽度的那个：地图 > 对话 > 项目列表 */
export function flexPane(shown: PaneId[]): PaneId | null {
  return (["map", "chat", "rail"] as const).find((p) => shown.includes(p)) ?? null;
}

/** 显示 / 收起一个面板；只剩它一个时不让收起 */
export function toggle(l: Layout, id: PaneId): Layout {
  if (l.hidden.includes(id)) return { ...l, hidden: l.hidden.filter((p) => p !== id) };
  if (visible(l).length <= 1) return l;
  return { ...l, hidden: [...l.hidden, id] };
}

/** 能不能收起：只剩它一个时不能 */
export const canHide = (l: Layout, id: PaneId) => !l.hidden.includes(id) && visible(l).length > 1;

/**
 * 把一个面板挪到看得见的面板中间第 slot 个缝里（0 是最左，visible.length 是最右）。
 * 收起的面板留在原来的相对位置
 */
export function move(l: Layout, id: PaneId, slot: number): Layout {
  const shown = visible(l).filter((p) => p !== id);
  const at = Math.max(0, Math.min(slot, shown.length));
  const nextShown = [...shown.slice(0, at), id, ...shown.slice(at)];
  // 把收起的面板按原来的位置插回去：跟在它原来前面那个看得见的面板后面
  const order: PaneId[] = [...nextShown];
  for (const h of l.order.filter((p) => l.hidden.includes(p) && p !== id)) {
    const before = l.order.slice(0, l.order.indexOf(h)).reverse().find((p) => order.includes(p));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, h);
  }
  return { ...l, order };
}

/** 拖到第几个缝里：按指针 x 和每个看得见的面板的左右边界算，过了面板中线就算到它后面 */
export function slotAt(x: number, rects: { left: number; right: number }[]): number {
  let slot = 0;
  for (const r of rects) if (x > (r.left + r.right) / 2) slot++;
  return slot;
}

/** 挪到 slot 会不会和现在一样（一样就不画落点线） */
export function sameSlot(l: Layout, id: PaneId, slot: number): boolean {
  const i = visible(l).indexOf(id);
  return slot === i || slot === i + 1;
}

/**
 * 两个面板中间的分隔条拖动时改谁的宽度：不是占剩下宽度的那个。
 * 改左边那个时往右拖变宽（+1），改右边那个时往右拖变窄（-1）
 */
export function dividerTarget(left: PaneId, right: PaneId, flex: PaneId | null): { pane: PaneId; sign: 1 | -1 } {
  if (left === flex) return { pane: right, sign: -1 };
  if (right === flex) return { pane: left, sign: 1 };
  return { pane: left, sign: 1 };
}

export function setWidth(l: Layout, id: PaneId, value: number | null): Layout {
  const p = PANES[id];
  return { ...l, width: { ...l.width, [id]: value === null ? null : Math.round(Math.min(p.max, Math.max(p.min, value))) } };
}
