/* Local image recognition. No network requests or external services. */
(() => {
  function textMask({ data, width, height }) {
    const bins = new Map();
    for (let i = 0; i < width * height; i++) {
      const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4);
      if (a < 128 || Math.max(r, g, b) > 180) continue;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const item = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      item.count++; item.r += r; item.g += g; item.b += b;
      bins.set(key, item);
    }
    const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (!dominant || dominant.count < 12) throw new Error('Could not find CAPTCHA text. Enter it manually.');
    const color = [dominant.r, dominant.g, dominant.b].map(n => n / dominant.count);
    const mask = new Uint8Array(width * height);
    for (let i = 0; i < mask.length; i++) {
      const offset = i * 4;
      const distance = Math.hypot(...color.map((n, c) => data[offset + c] - n));
      mask[i] = data[offset + 3] >= 128 && distance < 80 ? 1 : 0;
    }
    // Remove isolated dots and thin interference without assuming a text color.
    const cleaned = mask.slice();
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) neighbors += mask[i + dy * width + dx];
      if (neighbors < 3) cleaned[i] = 0;
    }
    return cleaned;
  }
  function regions(mask, width, height) {
    const columns = Array.from({ length: width }, (_, x) => {
      let count = 0;
      for (let y = 0; y < height; y++) count += mask[y * width + x];
      return count;
    });
    const groups = []; let start = -1;
    for (let x = 0; x <= width; x++) {
      if (columns[x] >= 2 && start < 0) start = x;
      if (!(columns[x] >= 2) && start >= 0) {
        if (x - start >= 2) groups.push([start, x]);
        start = -1;
      }
    }
    // Adjacent glyphs may touch (for example A followed by T). Split wide
    // runs at the lowest-ink column near their center instead of rejecting them.
    while (groups.length > 0 && groups.length < 4) {
      const widths = groups.map(([left, right]) => right - left);
      const index = widths.indexOf(Math.max(...widths));
      const [left, right] = groups[index];
      const expected = widths.reduce((a, b) => a + b, 0) / 4;
      if (right - left < expected * 1.35 || right - left < 8) break;
      const center = (left + right) / 2;
      let cut = Math.round(center), score = Infinity;
      for (let x = Math.ceil(left + (right - left) * .3); x <= Math.floor(left + (right - left) * .7); x++) {
        const candidate = columns[x] + Math.abs(x - center) * .15;
        if (candidate < score) { score = candidate; cut = x; }
      }
      groups.splice(index, 1, [left, cut], [cut, right]);
    }
    if (groups.length !== 4) throw new Error('CAPTCHA characters are unclear. Enter them manually or refresh the image.');
    return groups;
  }
  function normalize(source, w, h, left = 0, right = w) {
    let top = h, bottom = 0, minX = right, maxX = left;
    for (let y = 0; y < h; y++) for (let x = left; x < right; x++) if (source[y * w + x]) {
      top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x + 1);
    }
    const vector = new Float32Array(20 * 32);
    if (top >= bottom) return { vector, ratio: 0 };
    for (let y = 0; y < 32; y++) for (let x = 0; x < 20; x++) {
      let sum = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const px = Math.min(maxX - 1, Math.floor(minX + (x + (sx + .5) / 2) * (maxX - minX) / 20));
        const py = Math.min(bottom - 1, Math.floor(top + (y + (sy + .5) / 2) * (bottom - top) / 32));
        sum += source[py * w + px];
      }
      vector[y * 20 + x] = sum / 4;
    }
    return { vector, ratio: (maxX - minX) / (bottom - top) };
  }
  let templates;
  function getTemplates() {
    if (templates) return templates;
    templates = [];
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (const family of ['Arial', 'Arial Narrow', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Courier New', 'monospace'])
      for (const weight of ['normal', 'bold']) for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
        ctx.clearRect(0, 0, 96, 96); ctx.font = `${weight} 48px "${family}"`;
        ctx.fillStyle = '#000'; ctx.fillText(char, 8, 70);
        const pixels = ctx.getImageData(0, 0, 96, 96).data;
        const binary = Uint8Array.from({ length: 96 * 96 }, (_, i) => pixels[i * 4 + 3] > 100 ? 1 : 0);
        templates.push({ char, ...normalize(binary, 96, 96) });
      }
    return templates;
  }
  async function read(image) {
    if (!image.complete) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('CAPTCHA image did not load. Refresh the page.')), 10000);
      const loaded = () => finish();
      const failed = () => finish(new Error('CAPTCHA image could not load.'));
      function finish(error) {
        clearTimeout(timeout); image.removeEventListener('load', loaded); image.removeEventListener('error', failed);
        if (error) reject(error); else resolve();
      }
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('CAPTCHA image is unavailable. Refresh it and try again.');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    let pixels;
    try { pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); }
    catch { throw new Error('Chrome blocked reading this CAPTCHA image. Please enter it manually.'); }
    const mask = textMask(pixels);
    const groups = regions(mask, canvas.width, canvas.height);
    let result = '';
    for (const [left, right] of groups) {
      const glyph = normalize(mask, canvas.width, canvas.height, left, right);
      let best = { distance: Infinity };
      for (const template of getTemplates()) {
        let distance = 0;
        for (let i = 0; i < glyph.vector.length; i++) distance += Math.abs(glyph.vector[i] - template.vector[i]);
        distance = distance / glyph.vector.length + .08 * Math.min(2, Math.abs(Math.log(glyph.ratio / template.ratio)));
        if (distance < best.distance) best = { char: template.char, distance };
      }
      if (best.distance > .32) throw new Error('CAPTCHA recognition is uncertain. Please enter it manually.');
      result += best.char;
    }
    return result;
  }
  globalThis.readMoodleCaptcha = read;
  if (typeof module !== 'undefined') module.exports = { textMask, regions, normalize };
})();
