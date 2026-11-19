import { useMemo } from "react";
import { unreadIds } from "./seen";
import { useStore } from "./store";

/** 答完了还没看的那几路（设计稿 9-14） */
export function useUnread(): Set<string> {
  const routes = useStore((s) => s.routes);
  const stops = useStore((s) => s.stops);
  const seen = useStore((s) => s.seen);
  return useMemo(() => unreadIds(routes, stops, seen), [routes, stops, seen]);
}
