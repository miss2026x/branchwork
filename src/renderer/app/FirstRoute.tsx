import { useRef } from "react";
import type { Project, PromptImage } from "../../shared";
import { PromptInput, type PromptInputHandle } from "../chat/PromptInput";
import { useDraft } from "../chat/use-draft";
import { draftId } from "../stores/store";
import { modeInfo } from "../ui/claude-options";
import { IconClip, IconFolder } from "../ui/icons";
import css from "./App.module.css";

/** 项目还没有车：地图上直接写第一站（能带图，设计稿 9-11），发车就开出 1路 */
export function FirstRoute({ project, onStart, onMore }: { project: Project | undefined; onStart(question: string, images: PromptImage[]): void; onMore(): void }) {
  const question = useDraft();
  const input = useRef<PromptInputHandle>(null);
  const start = () => {
    if (question.status === "loading" || question.status === "bad") return;
    const q = question.prompt();
    onStart(q.text, q.images);
    question.clear();
  };
  return (
    <form
      className={css.first}
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <div className={css.firstLine} aria-hidden>
        <span>
          <b>1路</b>
          <i>等你发车</i>
        </span>
        <em />
      </div>
      <h1>{project?.name} 还没有车</h1>
      <p>问第一个问题，就开出 1路。之后从任何一站都能分出新的一路。</p>
      <div className={css.firstCard}>
        <span className={css.firstLabel}>第一站</span>
        <div className={css.firstInput}>
          <PromptInput ref={input} text={question.text} images={question.images} onChange={question.set} onImage={question.patch} onEnter={start} newId={draftId} label="第一站" placeholder="比如：先帮我梳理一下现在的认证结构" />
        </div>
        <div className={css.firstActions}>
          <button type="button" className={css.firstAttach} aria-label="添加图片" title="添加图片（也可以直接粘贴或拖进来）" onClick={() => input.current?.pickFiles()}>
            <IconClip size={16} />
          </button>
          <span>
            动手前：
            {modeInfo(project?.permissionMode ?? "ask").label}
          </span>
          <button type="button" className={css.firstMore} onClick={onMore}>
            更多选项…
          </button>
          <button type="submit" className={css.firstGo}>
            {question.status !== "empty" ? "发车" : "开出 1路"}
          </button>
        </div>
      </div>
      <p className={css.firstNote}>
        <IconFolder size={16} />
        <span>
          1路 在自己的工作区里改代码，每站答完，改动自动同步进 <code>{project?.localDir}</code>。
        </span>
      </p>
    </form>
  );
}
