/** 一个后台终端认出的全部端口（老数据只有 port） */
export const portsOf = (t: { port: number | null; ports?: number[] }): number[] => (t.ports?.length ? t.ports : t.port !== null ? [t.port] : []);
