import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cftExecutable, cftPlatform, downloadedChrome, installCft, latestCft, type CftRelease } from "../../src/browser/download";

/** 不压缩的 zip（够解开测试用）：文件名 → 内容 */
function makeZip(files: Record<string, string>): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const n = Buffer.from(name);
    const sum = crc(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // Unix，好带上可执行位
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE((0o100755 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-cft-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("没找到 Chrome 时下载 Chrome for Testing（设计稿 9-15）", () => {
  it("按系统选哪一份；Linux ARM 没有", () => {
    expect(cftPlatform("win32", "x64")).toBe("win64");
    expect(cftPlatform("darwin", "arm64")).toBe("mac-arm64");
    expect(cftPlatform("darwin", "x64")).toBe("mac-x64");
    expect(cftPlatform("linux", "x64")).toBe("linux64");
    expect(cftPlatform("linux", "arm64")).toBeNull();
    expect(cftExecutable("mac-arm64")).toContain(path.join("Google Chrome for Testing.app", "Contents", "MacOS"));
  });

  it("问 Google 现在的稳定版：取这台电脑那一份的地址", async () => {
    const json = { channels: { Stable: { version: "147.0.7727.56", downloads: { chrome: [{ platform: "linux64", url: "https://x/linux64.zip" }, { platform: "win64", url: "https://x/win64.zip" }] } } } };
    const r = await latestCft(async () => new Response(JSON.stringify(json)), "win64");
    expect(r).toEqual({ version: "147.0.7727.56", url: "https://x/win64.zip", platform: "win64" });
    await expect(latestCft(async () => new Response("", { status: 500 }), "win64")).rejects.toThrow("查不到");
    await expect(latestCft(async () => new Response("{}"), null)).rejects.toThrow("没有给这台电脑");
  });

  it("下载、解开、报进度；成功后删掉旧版本，找得到程序", async () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "140.0.1.1"));
    const exe = cftExecutable("linux64").split(path.sep).join("/");
    const zip = makeZip({ [exe]: "#!/bin/sh\necho chrome\n" });
    const release: CftRelease = { version: "147.0.7727.56", url: "https://x/linux64.zip", platform: "linux64" };
    const seen: number[] = [];
    const got = await installCft({
      root,
      release,
      fetch: async () => new Response(new Blob([new Uint8Array(zip)]).stream(), { headers: { "content-length": String(zip.length) } }),
      onProgress: (p) => seen.push(p.received),
    });
    expect(got.path).toBe(path.join(root, "147.0.7727.56", cftExecutable("linux64")));
    expect(fs.readFileSync(got.path, "utf8")).toContain("echo chrome");
    expect(seen.at(-1)).toBe(zip.length);
    expect(fs.readdirSync(root)).toEqual(["147.0.7727.56"]);
    expect(downloadedChrome(root, "linux64")).toEqual({ version: "147.0.7727.56", path: got.path });
    expect(downloadedChrome(root, "win64")).toBeNull();
  });

  it("下了一半断了、或解开后没有程序：不留下半个 Chrome", async () => {
    const root = tmp();
    const release: CftRelease = { version: "147.0.0.1", url: "https://x/a.zip", platform: "linux64" };
    const zip = makeZip({ "readme.txt": "nothing" });
    await expect(installCft({ root, release, fetch: async () => new Response(new Blob([new Uint8Array(zip)]).stream(), { headers: { "content-length": String(zip.length + 100) } }) })).rejects.toThrow("不完整");
    await expect(installCft({ root, release, fetch: async () => new Response(new Blob([new Uint8Array(zip)]).stream()) })).rejects.toThrow("没找到 Chrome 程序");
    await expect(installCft({ root, release, fetch: async () => new Response("", { status: 404 }) })).rejects.toThrow("下载失败");
    expect(fs.readdirSync(root)).toEqual([]);
    expect(downloadedChrome(root, "linux64")).toBeNull();
  });
});
