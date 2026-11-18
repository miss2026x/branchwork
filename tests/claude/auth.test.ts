import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectAuth, explainAuthError, type AuthProbe } from "../../src/claude/auth";

const HOME = "/home/me";
const probe = (files: Record<string, unknown>, opts: Partial<AuthProbe> = {}): AuthProbe => ({
  env: {},
  platform: "linux",
  home: HOME,
  readFile: async (f) => (f in files ? JSON.stringify(files[f]) : null),
  keychainHas: async () => null,
  ...opts,
});
const user = path.join(HOME, ".claude", "settings.json");

describe("Claude 用什么登录：环境变量、settings、凭据、钥匙串都看", () => {
  it("哪儿都没有：没登录", async () => {
    expect(await detectAuth([], probe({}))).toEqual({ state: "missing" });
  });
  it("环境变量：API Key、令牌加中转地址、长期令牌、Bedrock", async () => {
    expect(await detectAuth([], probe({}, { env: { ANTHROPIC_API_KEY: "sk" } }))).toEqual({ state: "ok", how: "API Key", where: "环境变量" });
    expect(await detectAuth([], probe({}, { env: { ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "https://relay.example.com/v1" } }))).toEqual({ state: "ok", how: "中转 relay.example.com", where: "环境变量" });
    expect(await detectAuth([], probe({}, { env: { CLAUDE_CODE_OAUTH_TOKEN: "t" } }))).toMatchObject({ how: "Claude 账号（长期令牌）" });
    expect(await detectAuth([], probe({}, { env: { CLAUDE_CODE_USE_BEDROCK: "1" } }))).toMatchObject({ how: "Amazon Bedrock" });
  });
  it("settings.json 的 env 里配的（以前漏了）：用户的、项目里的、公司统一下发的", async () => {
    expect(await detectAuth([], probe({ [user]: { env: { ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "https://api.relay.cn" } } }))).toEqual({ state: "ok", how: "中转 api.relay.cn", where: "~/.claude/settings.json" });
    expect(await detectAuth(["/code/app"], probe({ "/code/app/.claude/settings.local.json": { env: { ANTHROPIC_API_KEY: "sk" } } }))).toEqual({ state: "ok", how: "API Key", where: "/code/app/.claude/settings.local.json" });
    expect(await detectAuth([], probe({ "/etc/claude-code/managed-settings.json": { env: { CLAUDE_CODE_USE_VERTEX: "1" } } }))).toMatchObject({ how: "Google Vertex AI" });
  });
  it("settings 里的 apiKeyHelper：用一个命令取 Key", async () => {
    expect(await detectAuth([], probe({ [user]: { apiKeyHelper: "~/bin/get-key.sh" } }))).toEqual({ state: "ok", how: "API Key（由 apiKeyHelper 取）", where: "~/.claude/settings.json" });
  });
  it("登录凭据：.credentials.json；~/.claude.json 里记着账号邮箱", async () => {
    const files = { [path.join(HOME, ".claude", ".credentials.json")]: { claudeAiOauth: { expiresAt: 1 } }, [path.join(HOME, ".claude.json")]: { oauthAccount: { emailAddress: "me@example.com" } } };
    expect(await detectAuth([], probe(files))).toEqual({ state: "ok", how: "Claude 账号", account: "me@example.com" });
  });
  it("Mac：凭据在钥匙串里；钥匙串查不了但记着账号时算“确认不了”", async () => {
    const acc = { [path.join(HOME, ".claude.json")]: { oauthAccount: { emailAddress: "me@example.com" } } };
    expect(await detectAuth([], probe(acc, { platform: "darwin", keychainHas: async () => true }))).toEqual({ state: "ok", how: "Claude 账号", account: "me@example.com" });
    expect(await detectAuth([], probe(acc, { platform: "darwin", keychainHas: async () => null }))).toMatchObject({ state: "unknown", account: "me@example.com" });
    expect(await detectAuth([], probe({}, { platform: "darwin", keychainHas: async () => false }))).toEqual({ state: "missing" });
  });
  it("CLAUDE_CONFIG_DIR：settings 和凭据都到那个目录里找", async () => {
    const dir = "/cfg";
    expect(await detectAuth([], probe({ "/cfg/settings.json": { env: { ANTHROPIC_API_KEY: "sk" } } }, { env: { CLAUDE_CONFIG_DIR: dir } }))).toMatchObject({ how: "API Key", where: "/cfg/settings.json" });
  });
});

describe("报错换成能照着做的说明", () => {
  it("没登录、Key 不对、令牌过期、额度用完；别的错原样", () => {
    expect(explainAuthError("Invalid API key · Please run /login")).toMatch(/^Claude 没登录或凭据失效/);
    expect(explainAuthError("OAuth token has expired")).toMatch(/凭据失效/);
    expect(explainAuthError("Credit balance is too low")).toMatch(/额度用完了/);
    expect(explainAuthError("error_during_execution")).toBeNull();
  });
});
