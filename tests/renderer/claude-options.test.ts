import { describe, expect, it } from "vitest";
import type { ClaudeOptions, ModelChoice } from "../../src/shared";
import { currentModel, modeItems, modelHint, modelItems } from "../../src/renderer/ui/claude-options";

const m = (value: string, extra: Partial<ModelChoice> = {}): ModelChoice => ({ value, label: value, description: "", efforts: [], autoMode: true, ...extra });

describe("模型、批准方式的列表", () => {
  it("常用的别名在前，具体型号、自定义的、网关给的收进“更多”；这一路之前选的不在列表里也列出来", () => {
    const opts: ClaudeOptions = { models: [m("default"), m("sonnet"), m("claude-opus-5"), m("deepseek-flash"), m("GPT 5.6 Luna")], modes: ["ask"] };
    const { common, more } = modelItems(opts, "gone-model");
    expect(common.map((x) => x.value)).toEqual(["default", "sonnet", "gone-model"]);
    expect(more.map((x) => x.value)).toEqual(["claude-opus-5", "deepseek-flash", "GPT 5.6 Luna"]);
    expect(currentModel(opts, null).value).toBe("default");
  });

  it("中文提示只给真是 Claude 模型的别名：sonnet 被网关换成别的模型时不给", () => {
    expect(modelHint(m("sonnet", { resolved: "claude-sonnet-5-5" }))).toContain("日常");
    expect(modelHint(m("sonnet"))).toContain("日常");
    expect(modelHint(m("sonnet", { resolved: "deepseek-v4-pro" }))).toBe("");
    expect(modelHint(m("deepseek-flash"))).toBe("");
  });

  it("批准方式只列 Claude Code 肯切过去的；自动判断要这一路的模型支持；读不到时给原来的三种", () => {
    const opts: ClaudeOptions = { models: [], modes: ["ask", "auto", "plan"] };
    expect(modeItems(opts).map((x) => x.mode)).toEqual(["ask", "auto", "plan"]);
    expect(modeItems(opts, m("haiku-4-5", { autoMode: false, label: "Haiku 4.5" })).find((x) => x.mode === "auto")?.disabled).toContain("Haiku 4.5");
    expect(modeItems("failed").map((x) => x.mode)).toEqual(["ask", "edits", "all"]);
  });
});
