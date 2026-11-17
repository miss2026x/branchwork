import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE, type ImageType, type PromptImage } from "../../shared";

/** Claude 直接收的格式；别的格式浏览器能打开的（BMP、AVIF…）转成 PNG */
const ACCEPTED: ImageType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** 读不了这张图：message 是给人看的原因和办法 */
export class ImageProblem extends Error {}

const extOf = (file: File) => (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? file.type.split("/")[1] ?? "").toLowerCase();

/** 拖进来、粘贴进来的东西里是不是有图片（只看类型，还没读） */
export const looksLikeImage = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|svg)$/i.test(file.name);

/**
 * 把一个文件变成能发给 Claude 的图片：
 * 长边超过 IMAGE_MAX_EDGE 的缩小（Claude 收到更大的也会自己缩，先缩省流量和上下文），太大的压一压；
 * PNG / JPG / GIF / WebP 不用动的原样发。读不了时抛 ImageProblem。
 */
export async function readImage(file: File): Promise<PromptImage> {
  const ext = extOf(file);
  const name = file.name || "粘贴的图片.png";
  if (/^(heic|heif)$/.test(ext) || /hei[cf]/.test(file.type)) throw new ImageProblem(`${ext.toUpperCase()} 是苹果手机的格式，Claude 读不了。换成 PNG / JPG 再放进来`);
  if (ext === "svg" || file.type === "image/svg+xml") throw new ImageProblem("SVG 是矢量图，Claude 读不了。截个图（PNG）再放进来");
  if (ext === "pdf" || file.type === "application/pdf") throw new ImageProblem("PDF 不是图片，先截图再放进来");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageProblem(`这张图打不开${ext ? `（.${ext}）` : ""}。换成 PNG / JPG 再放进来`);
  }
  const { width, height } = bitmap;
  const long = Math.max(width, height);
  const type = ACCEPTED.find((t) => t === file.type);
  // 格式对、尺寸和大小都在范围里：原样发（GIF 也保住动画）
  if (type && long <= IMAGE_MAX_EDGE && file.size <= IMAGE_MAX_BYTES) {
    bitmap.close();
    return { type, data: await base64(file), name, width, height };
  }
  // 否则画到画布上缩小、重新编码：照片用 JPEG，截图之类用 PNG；PNG 还太大就换 JPEG
  const scale = Math.min(1, IMAGE_MAX_EDGE / long);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageProblem("这张图处理不了，换一张试试");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let out = await toBlob(canvas, file.type === "image/jpeg" ? "image/jpeg" : "image/png");
  if (out.size > IMAGE_MAX_BYTES) out = await toBlob(canvas, "image/jpeg");
  if (out.size > IMAGE_MAX_BYTES) throw new ImageProblem("这张图太大了，裁小一点再放进来");
  return { type: out.type as ImageType, data: await base64(out), name, width: w, height: h };
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageProblem("这张图处理不了，换一张试试"))), type, 0.9));
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new ImageProblem("这张图读不出来，换一张试试"));
    r.readAsDataURL(blob);
  });
}
