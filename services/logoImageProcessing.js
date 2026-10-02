import sharp from "sharp";

export const LOGO_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
const MAX_SIDE = 2048;
export const logoError = (message, status = 400) => Object.assign(new Error(message), { status });

export async function prepareLogo(buffer, { removeBackground = true } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw logoError("Selecciona un logo.");
  if (buffer.length > LOGO_MAX_BYTES) throw logoError("El logo debe pesar como máximo 8 MB.", 413);
  let raw;
  try {
    const input = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
    const metadata = await input.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) {
      throw logoError("Usa una imagen JPG, PNG o WebP sin animación.");
    }
    raw = await input.rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error.status) throw error;
    throw logoError("No pudimos leer el logo. Usa un JPG, PNG o WebP de hasta 16 megapíxeles.");
  }

  const { width, height } = raw.info;
  const pixels = Buffer.from(raw.data);
  const count = width * height;
  let transparent = false;
  for (let p = 0; p < count; p++) if (pixels[p * 4 + 3] < 250) { transparent = true; break; }
  let status = removeBackground ? (transparent ? "transparent" : "needs_review") : "original";

  // Existing transparency is authoritative: do not erase white artwork in a transparent logo.
  if (removeBackground && !transparent && width > 2 && height > 2) {
    const border = [];
    for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
    for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);
    let colour = [0, 1, 2].map(channel => {
      const values = border.map(p => pixels[p * 4 + channel]).sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    });
    const distance = p => Math.max(...colour.map((value, c) => Math.abs(pixels[p * 4 + c] - value)));
    let uniform = border.filter(p => distance(p) <= 18).length / border.length >= 0.97;
    // A tightly cropped rounded logo can touch every edge while its exterior is
    // visible only in the corners. Require matching near-white patches in ALL
    // four corners; never guess from one corner or remove the coloured outline.
    if (!uniform) {
      const side = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) * 0.01)));
      const corners = [];
      for (const [left, top] of [[0, 0], [width - side, 0], [0, height - side], [width - side, height - side]]) {
        for (let y = top; y < top + side; y++) for (let x = left; x < left + side; x++) corners.push(y * width + x);
      }
      const white = p => [0, 1, 2].every(c => pixels[p * 4 + c] >= 240);
      if (corners.every(white)) {
        colour = [255, 255, 255];
        uniform = true;
      }
    }
    if (uniform) {
      const visited = new Uint8Array(count);
      const queue = new Uint32Array(count);
      let head = 0;
      let tail = 0;
      const enqueue = p => {
        if (!visited[p] && distance(p) <= 28) { visited[p] = 1; queue[tail++] = p; }
      };
      border.forEach(enqueue);
      while (head < tail) {
        const p = queue[head++];
        const x = p % width;
        if (x > 0) enqueue(p - 1);
        if (x < width - 1) enqueue(p + 1);
        if (p >= width) enqueue(p - width);
        if (p < count - width) enqueue(p + width);
      }
      // Uniform/empty images and near-invisible marks are ambiguous; keep their contents intact.
      if (tail > 0 && count - tail >= Math.max(32, count * 0.002)) {
        for (let i = 0; i < tail; i++) pixels[queue[i] * 4 + 3] = 0;
        status = "background_removed";
      }
    }
  }

  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] > 8) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw logoError("La imagen está vacía o es completamente transparente.");
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const padding = status === "background_removed" || transparent
    ? Math.max(2, Math.round(Math.max(crop.width, crop.height) * 0.02)) : 0;
  const cropped = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .extract(crop).extend({ top: padding, bottom: padding, left: padding, right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const result = await sharp(cropped)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { buffer: result.data, status, width: result.info.width, height: result.info.height };
}
