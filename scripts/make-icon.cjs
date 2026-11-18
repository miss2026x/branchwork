// 生成应用图标 build/icon.png（1024）和 build/icon.svg（设计稿 0-5：Lanes）。四条车道是 1–4 路的颜色，改了 tokens.css 里的 route-1…4 就重新跑：
// node scripts/make-icon.cjs "#2563c9" "#e0661c" "#7b4ccb" "#0e7c86"
const { chromium } = require("playwright");
const fs = require("fs");
const [c1, c2, c3, c4] = process.argv.slice(2);
const rows = [[40, 14, c1], [30, 24, c2], [34, 34, c3], [22, 44, c4]];
// 按 macOS 图标的格子：824 的圆角方块放在 1024 的画布中间，四周留空给阴影
const lanes = rows.map(([w, y, c]) => `<rect x="10" y="${y}" width="${w}" height="6" rx="3" fill="${c}"/><circle cx="${10 + w}" cy="${y + 3}" r="4.2" fill="${c}"/><circle cx="${10 + w}" cy="${y + 3}" r="1.8" fill="#fff"/>`).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F3F5F8"/></linearGradient>
<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#161B22" flood-opacity=".18"/></filter></defs>
<rect x="100" y="100" width="824" height="824" rx="190" fill="url(#g)" stroke="#DCE1E7" stroke-width="4" filter="url(#s)"/>
<g transform="translate(160 160) scale(11)">${lanes}</g></svg>`;
fs.writeFileSync("build/icon.svg", svg);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await p.screenshot({ path: "build/icon.png", omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
  await b.close();
})();
