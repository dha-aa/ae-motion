/**
 * Shrinking preview PNGs before they go to the model. An image costs tokens by its pixel count (about
 * width × height / 750), so a full HD frame is ~1,500 tokens while 768 px wide is ~300. Pure JS (pngjs), no native
 * dependency.
 */
import { PNG } from "pngjs";

interface Img {
  width: number;
  height: number;
  data: Buffer; // RGBA
}

const decode = (buf: Buffer): Img => PNG.sync.read(buf);

function encode(img: Img): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png);
}

/** Area-average resample to w × h (only ever used to shrink). */
function resize(src: Img, w: number, h: number): Img {
  if (w >= src.width && h >= src.height) return src;
  const out = Buffer.alloc(w * h * 4);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0), o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return { width: w, height: h, data: out };
}

/** Scale factor that fits w × h inside maxEdge on its longest side (never enlarges). */
const fit = (w: number, h: number, maxEdge: number): number => Math.min(1, maxEdge / Math.max(w, h));

/** One PNG, shrunk so its longest edge is at most maxEdge. Input that is not a decodable PNG is returned as is. */
export function shrinkPng(buf: Buffer, maxEdge: number): Buffer {
  let img: Img;
  try {
    img = decode(buf);
  } catch {
    return buf;
  }
  const s = fit(img.width, img.height, maxEdge);
  if (s === 1) return buf;
  return encode(resize(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s))));
}

/**
 * Several frames tiled into one PNG, left to right then top to bottom, with a 4 px gap. The whole sheet fits
 * maxEdge on its longest side.
 */
export function contactSheet(bufs: Buffer[], maxEdge: number): Buffer {
  const imgs = bufs.map(decode);
  const cols = Math.ceil(Math.sqrt(imgs.length)), rows = Math.ceil(imgs.length / cols), gap = 4;
  const fw = imgs[0].width, fh = imgs[0].height;
  const s = fit(cols * fw, rows * fh, maxEdge - gap * (cols - 1));
  const cw = Math.max(1, Math.round(fw * s)), ch = Math.max(1, Math.round(fh * s));
  const W = cols * cw + gap * (cols - 1), H = rows * ch + gap * (rows - 1);
  const data = Buffer.alloc(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255; // opaque black between cells
  imgs.forEach((img, k) => {
    const cell = resize(img, cw, ch), ox = (k % cols) * (cw + gap), oy = Math.floor(k / cols) * (ch + gap);
    for (let y = 0; y < Math.min(ch, cell.height); y++) {
      cell.data.copy(data, ((oy + y) * W + ox) * 4, y * cell.width * 4, (y * cell.width + Math.min(cw, cell.width)) * 4);
    }
  });
  return encode({ width: W, height: H, data });
}
