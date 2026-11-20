import type { Stop } from "../shared";

/** 用户停下时记的原因（界面也认这几个字） */
export const STOPPED_BY_USER = "已停车";

/**
 * 上一站没答完时，下一站问题后面附上的一段（设计稿 9-16）。
 * 对话记录里 Claude 能看到自己停下前说的、做的，和一条“被用户打断”；但看不到：
 * 是不是用户让它停的（还是出错断了）、停下后用户有没有把那一站的改动丢掉。
 * discarded：那一站的改动用户已经丢掉了；local：Local 专车（改的就是 Local，丢不掉）
 */
export function interruptedNote(last: Stop, discarded: boolean, local: boolean): string {
  const why = !last.error || last.error === STOPPED_BY_USER ? "用户中途停下了它" : `它中断了（${last.error}）`;
  const files = discarded
    ? "那一站对文件做的改动，用户已经丢掉了：文件回到了那一站开始之前的样子，上面对话里那些改动现在都不在了，需要的话要重新做。"
    : local
      ? "那一站已经做的改动还在项目文件夹里。"
      : "那一站已经做的改动还在工作区里。";
  return [
    "<lanes-note>",
    "（这一段是 Lanes 自动附上的，不是用户写的。）",
    `上一站（“${last.name}”）没答完：${why}。${files}`,
    "先按这一次的问题来；用户没让你接着做，就不要自作主张把上一站没做完的事做完。",
    "</lanes-note>",
  ].join("\n");
}
