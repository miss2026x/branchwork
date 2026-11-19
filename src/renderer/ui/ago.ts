/** 多久以前：今天 / 昨天 / N 天前 / 上周 / N 周前 / 上个月 / N 个月前 */
export function ago(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  if (days < 14) return "上周";
  if (days < 31) return `${Math.floor(days / 7)} 周前`;
  if (days < 62) return "上个月";
  return `${Math.floor(days / 30)} 个月前`;
}

/** 当天的细到分钟：刚刚 / N 分钟前 / N 小时前；更早的同 ago */
export function agoFine(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`;
  return ago(at, now);
}

/** 左栏每一路的“最近一次对话”（设计稿 9-14）：刚刚 / N 分钟前 / 14:20 / 昨天 / 11月12日 / 2025/11/12 */
export function lastTime(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const d = new Date(at);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (at >= startOfToday) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (at >= startOfToday - 86_400_000) return "昨天";
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
