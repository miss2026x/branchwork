import type { SVGProps } from "react";

/** 线性图标：24 网格、线宽 2。尺寸用 size 传（12 / 14 / 16 / 20） */
function Icon({ size = 16, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}
type P = { size?: number };
export const IconPlus = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const IconMinus = (p: P) => <Icon {...p}><path d="M5 12h14" /></Icon>;
export const IconChevron = (p: P & { open?: boolean }) => <Icon size={p.size} style={{ transform: p.open ? "rotate(90deg)" : undefined, transition: "transform var(--t-fast)" }}><path d="M9 6l6 6-6 6" /></Icon>;
export const IconFit = (p: P) => <Icon {...p}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></Icon>;
export const IconWarn = (p: P) => <Icon {...p}><path d="M12 3l9.5 17h-19L12 3zM12 10v5M12 18v.01" /></Icon>;
export const IconFolder = (p: P) => <Icon {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></Icon>;
export const IconFile = (p: P) => <Icon {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6" /></Icon>;
export const IconSend = (p: P) => <Icon {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>;
export const IconCopy = (p: P) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></Icon>;
export const IconFork = (p: P) => <Icon {...p}><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="9" r="2" /><path d="M6 7v10M18 11c0 4-6 3-12 6" /></Icon>;
export const IconCompress = (p: P) => <Icon {...p}><path d="M4 12h6M14 12h6M8 8l4 4-4 4M16 8l-4 4 4 4" /></Icon>;
export const IconClose = (p: P) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const IconMore = (p: P) => <Icon {...p}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Icon>;
export const IconSearch = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
export const IconChat = (p: P) => <Icon {...p}><path d="M4 5h16v11H9l-5 4V5z" /></Icon>;
export const IconAlert = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.01" /></Icon>;
export const IconTerminal = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M12.5 15H17" /></Icon>;
export const IconWait = (p: P) => <Icon {...p}><circle cx="12" cy="8" r="4.5" /><path d="M12 12.5V20M8.5 20h7M10 8h4" /></Icon>;
export const IconEdit = (p: P) => <Icon {...p}><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></Icon>;
export const IconArrow = (p: P) => <Icon {...p}><path d="M7 17L17 7M9 7h8v8" /></Icon>;
export const IconCut = (p: P) => <Icon {...p}><circle cx="6" cy="7" r="2.5" /><circle cx="6" cy="17" r="2.5" /><path d="M8 8.5L20 17M8 15.5L20 7" /></Icon>;
export const IconEye = (p: P) => <Icon {...p}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></Icon>;
export const IconPin = (p: P) => <Icon {...p}><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v6" /></Icon>;
export const IconFold = (p: P) => <Icon {...p}><path d="M4 12h16M8 6h8M8 18h8" /></Icon>;
export const IconArchive = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4" /></Icon>;
export const IconDownload = (p: P) => <Icon {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const IconTrash = (p: P) => <Icon {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Icon>;
export const IconGear = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></Icon>;
export const IconCheck = (p: P) => <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>;
export const IconSliders = (p: P) => <Icon {...p}><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></Icon>;
export const IconStop = (p: P) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>;

/** 应用图标里的那辆车 */
/**
 * Lanes 的图标（设计稿 0-5）：几条车道并排，就是地图上 1–4 路的颜色。
 * 32px 以下只画三条、去掉末尾的站，线更粗
 */
export function LanesMark({ size = 24 }: { size?: number }) {
  const small = size <= 32;
  // 上下左右都居中在 64×64 里：小号三条占 8–56 × 13–51，大号四条连同末尾的站占 10–54 × 13–51
  const x = small ? 8 : 10;
  const rows: [number, number, number, string][] = small
    ? [
        [48, 13, 9, "var(--route-1)"],
        [34, 27.5, 9, "var(--route-2)"],
        [40, 42, 9, "var(--route-3)"],
      ]
    : [
        [40, 14, 6, "var(--route-1)"],
        [30, 24, 6, "var(--route-2)"],
        [34, 34, 6, "var(--route-3)"],
        [22, 44, 6, "var(--route-4)"],
      ];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      {rows.map(([w, y, h, c]) => (
        <g key={y}>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={c} />
          {!small && (
            <>
              <circle cx={x + w} cy={y + 3} r="4.2" fill={c} />
              <circle cx={x + w} cy={y + 3} r="1.8" fill="var(--surface)" />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
/** 一条车道加一个站：通知里代表某一路，用这一路自己的颜色 */
export function LaneGlyph({ size = 20, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden>
      <rect x="2" y="8.5" width="14" height="5" rx="2.5" fill={color} />
      <circle cx="16" cy="11" r="4" fill={color} />
      <circle cx="16" cy="11" r="1.6" fill="var(--surface)" />
    </svg>
  );
}
export const IconShield = (p: P) => <Icon {...p}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></Icon>;
export const IconSpark = (p: P) => <Icon {...p}><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></Icon>;
export const IconGauge = (p: P) => <Icon {...p}><path d="M4 16a8 8 0 0116 0M12 16l4-5" /></Icon>;
export const IconDown = (p: P) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const IconEyeOff = (p: P) => <Icon {...p}><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.3 4.2M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6" /></Icon>;
export const IconClip = (p: P) => <Icon {...p}><path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7" /></Icon>;
export const IconImage = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></Icon>;
// 内置浏览器、MCP（设计稿 9-12、9-13）
export const IconGlobe = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></Icon>;
export const IconPick = (p: P) => <Icon {...p}><path d="M4 4l7 17 2.5-7 7-2.5z" /><path d="M14 14l6 6" /></Icon>;
export const IconCamera = (p: P) => <Icon {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></Icon>;
export const IconCameraOff = (p: P) => <Icon {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /><path d="M3 3l18 18" /></Icon>;
export const IconFileCode = (p: P) => <Icon {...p}><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M14 3v6h6M10 13l-2 2 2 2M14 13l2 2-2 2" /></Icon>;
export const IconWindowUp = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18M10 14l2-2 2 2M12 12v5" /></Icon>;
export const IconPlug = (p: P) => <Icon {...p}><path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 01-12 0zM12 18v3" /></Icon>;
export const IconNet = (p: P) => <Icon {...p}><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></Icon>;
export const IconErr = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></Icon>;
export const IconReload = (p: P) => <Icon {...p}><path d="M20 12a8 8 0 11-2.3-5.6M20 4v5h-5" /></Icon>;
export const IconCheckCircle = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></Icon>;
