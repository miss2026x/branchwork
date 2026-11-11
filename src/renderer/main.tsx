import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/tokens.css";

async function start() {
  // 在普通浏览器里打开（没有主进程）时，用一个假的后端，方便只调界面
  if (!window.bw) {
    const { installMockBw } = await import("./dev/mock-bw");
    installMockBw();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
