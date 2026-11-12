import { useEffect, useState } from "react";

/**
 * 窗口有多宽，按三档布局：
 * wide（1280 以上）三栏全开；mid（1024–1279）左栏收成图标、对话栏变窄；narrow（1024 以下）对话栏收起，点“对话”滑出
 */
export type Tier = "wide" | "mid" | "narrow";

export const tierOf = (width: number): Tier => (width >= 1280 ? "wide" : width >= 1024 ? "mid" : "narrow");

export function useTier(): Tier {
  const [tier, setTier] = useState<Tier>(() => tierOf(window.innerWidth));
  useEffect(() => {
    const onResize = () => setTier(tierOf(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return tier;
}
