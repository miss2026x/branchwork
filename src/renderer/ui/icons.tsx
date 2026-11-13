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
export const IconStop = (p: P) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>;

/** 应用图标里的那辆车 */
export function BusMark({ size = 28, color = "var(--route-2)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 36 26" aria-hidden>
      <rect x="1" y="1" width="34" height="19" rx="5" fill={color} />
      <rect x="5" y="5" width="7" height="6" rx="1.5" fill="#fff" />
      <rect x="14.5" y="5" width="7" height="6" rx="1.5" fill="#fff" />
      <rect x="24" y="5" width="7" height="6" rx="1.5" fill="#fff" />
      <circle cx="10" cy="21" r="4" fill="var(--text-1)" />
      <circle cx="26" cy="21" r="4" fill="var(--text-1)" />
      <circle cx="10" cy="21" r="1.5" fill="#fff" />
      <circle cx="26" cy="21" r="1.5" fill="#fff" />
    </svg>
  );
}
