import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Claude 用什么登录（欢迎页、设置面板里的“登录状态”）。
 *
 * Claude Code 认凭据的地方很多，只看 ~/.claude/.credentials.json 会把用 settings.json 配 Key、配中转、
 * 用 Bedrock 的人都误报成“还没登录”。这里按 Claude Code 自己的顺序都看一遍（不读出 Key 本身，只看有没有）：
 * 1. 环境变量；2. settings 文件里的 env 和 apiKeyHelper（公司统一下发的、用户的、各项目的）；
 * 3. 登录凭据（.credentials.json，Mac 上在钥匙串里）；4. ~/.claude.json 里记的账号。
 */
export interface AuthInfo {
  /** ok 找到了；missing 哪儿都没有；unknown 确认不了 */
  state: "ok" | "missing" | "unknown";
  /** 用的哪种方式（给人看的一句话），比如“Claude 账号”“API Key”“中转 api.example.com”“Amazon Bedrock” */
  how?: string;
  /** 登录的账号（邮箱） */
  account?: string;
  /** 在哪儿配的，比如“环境变量”“~/.claude/settings.json” */
  where?: string;
}

/** 读文件、跑命令都可以换成假的（测试用） */
export interface AuthProbe {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  home: string;
  readFile(file: string): Promise<string | null>;
  /** Mac 钥匙串里有没有 Claude Code 存的登录凭据（只看有没有，不读内容，不会弹窗） */
  keychainHas(service: string): Promise<boolean | null>;
}

export const realProbe = (): AuthProbe => ({
  env: process.env,
  platform: process.platform,
  home: os.homedir(),
  readFile: (f) => fs.readFile(f, "utf8").catch(() => null),
  keychainHas: (service) =>
    new Promise((resolve) => {
      if (process.platform !== "darwin") return resolve(null);
      execFile("security", ["find-generic-password", "-s", service], { timeout: 5000 }, (err) => resolve(!err));
    }),
});

const PROVIDERS: [string, string][] = [
  ["CLAUDE_CODE_USE_BEDROCK", "Amazon Bedrock"],
  ["CLAUDE_CODE_USE_VERTEX", "Google Vertex AI"],
  ["CLAUDE_CODE_USE_FOUNDRY", "Microsoft Foundry"],
];
const truthy = (v: unknown) => typeof v === "string" && v !== "" && v !== "0" && v.toLowerCase() !== "false";
const hostOf = (url: unknown) => {
  if (typeof url !== "string" || !url) return null;
  try {
    const h = new URL(url).host;
    return h === "api.anthropic.com" ? null : h;
  } catch {
    return null;
  }
};

/** 一组环境变量（真的环境变量，或 settings 里的 env）说明了用什么登录 */
function fromEnv(env: Record<string, unknown>, where: string): AuthInfo | null {
  for (const [key, name] of PROVIDERS) if (truthy(env[key])) return { state: "ok", how: name, where };
  const relay = hostOf(env.ANTHROPIC_BASE_URL);
  if (truthy(env.ANTHROPIC_AUTH_TOKEN)) return { state: "ok", how: relay ? `中转 ${relay}` : "令牌（ANTHROPIC_AUTH_TOKEN）", where };
  if (truthy(env.ANTHROPIC_API_KEY)) return { state: "ok", how: relay ? `中转 ${relay}` : "API Key", where };
  if (truthy(env.CLAUDE_CODE_OAUTH_TOKEN)) return { state: "ok", how: "Claude 账号（长期令牌）", where };
  return null;
}

/** 公司统一下发的设置（managed-settings.json）在哪 */
function managedFile(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "win32") return "C:\\ProgramData\\ClaudeCode\\managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

/** projectDirs：各项目的 Local 文件夹（项目里的 .claude/settings.json 也能配 Key） */
export async function detectAuth(projectDirs: string[] = [], probe: AuthProbe = realProbe()): Promise<AuthInfo> {
  const config = probe.env.CLAUDE_CONFIG_DIR || path.join(probe.home, ".claude");
  const tilde = (f: string) => (f.startsWith(probe.home) ? `~${f.slice(probe.home.length)}` : f);
  const json = async (f: string) => {
    const t = await probe.readFile(f);
    if (!t) return null;
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // 1. 环境变量
  const fromProcess = fromEnv(probe.env, "环境变量");
  if (fromProcess) return fromProcess;

  // 2. settings 文件：公司统一下发的 → 用户的 → 各项目的
  const settings = [managedFile(probe.platform), path.join(config, "settings.json"), ...projectDirs.flatMap((d) => [path.join(d, ".claude", "settings.local.json"), path.join(d, ".claude", "settings.json")])];
  for (const file of settings) {
    const s = await json(file);
    if (!s) continue;
    const found = s.env && typeof s.env === "object" ? fromEnv(s.env as Record<string, unknown>, tilde(file)) : null;
    if (found) return found;
    if (typeof s.apiKeyHelper === "string" && s.apiKeyHelper.trim()) {
      const relay = s.env && typeof s.env === "object" ? hostOf((s.env as Record<string, unknown>).ANTHROPIC_BASE_URL) : null;
      return { state: "ok", how: relay ? `中转 ${relay}（Key 由 apiKeyHelper 取）` : "API Key（由 apiKeyHelper 取）", where: tilde(file) };
    }
  }

  // 3、4. 登录凭据和记下的账号
  const account = await json(path.join(probe.env.CLAUDE_CONFIG_DIR ? config : probe.home, ".claude.json"));
  const email = (account?.oauthAccount as { emailAddress?: unknown } | undefined)?.emailAddress;
  const who = typeof email === "string" && email ? { account: email } : {};
  const creds = await json(path.join(config, ".credentials.json"));
  if (creds?.claudeAiOauth) return { state: "ok", how: "Claude 账号", ...who };
  if (probe.platform === "darwin") {
    const has = await probe.keychainHas("Claude Code-credentials");
    if (has) return { state: "ok", how: "Claude 账号", ...who };
    if (has === null && who.account) return { state: "unknown", how: "Claude 账号", ...who };
  }
  if (typeof account?.primaryApiKey === "string" && account.primaryApiKey) return { state: "ok", how: "API Key（claude 登录时存的）", ...who };
  if (creds) return { state: "ok", how: "Claude 账号", ...who };
  return { state: "missing" };
}

/**
 * Claude 报的错是不是“没登录 / 凭据不对 / 额度不够”：是的话换成能照着做的说明。
 * 常见的原话：Invalid API key · Please run /login、Not logged in、OAuth token has expired、authentication_error、Credit balance is too low
 */
export function explainAuthError(error: string): string | null {
  if (/credit balance is too low|insufficient.?(credit|balance|quota)/i.test(error)) return `Claude 的额度用完了（${error}）。去 Anthropic 控制台充值，或者换一个 Key。`;
  if (/invalid api key|please run \/login|not logged in|authentication_error|oauth token (has )?expired|\b401\b|unauthorized|invalid (x-api-key|bearer token)/i.test(error))
    return `Claude 没登录或凭据失效（${error}）。在终端里运行一次 claude 按提示登录；用 Key 或中转的，检查 settings.json 或环境变量里的 Key 和地址。`;
  return null;
}
