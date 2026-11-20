import { useMemo } from "react";
import type { Route, Terminal } from "../../shared";
import { useStore } from "./store";

/** 同一个项目里 Local 专车的后台终端；这一路自己就是 Local 时为空（设计稿 9-15） */
export function useLocalTerminals(route: Route): Terminal[] {
  const routes = useStore((s) => s.routes);
  const terminals = useStore((s) => s.terminals);
  return useMemo(() => {
    if (route.local) return [];
    const id = Object.values(routes).find((r) => r.projectId === route.projectId && r.local)?.id;
    return id ? Object.values(terminals).filter((t) => t.routeId === id) : [];
  }, [routes, terminals, route.local, route.projectId]);
}
