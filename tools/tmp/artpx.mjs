// Measure L* stats from a PNG using the browser's canvas (no image libs installed).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
const files = process.argv.slice(2);
for (const f of files) {
  const b64 = (await readFile(f)).toString('base64');
  const out = await page.evaluate(async (d) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + d; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const L = (r, gg, b) => { const y = 0.2126 * s2l(r / 255) + 0.7152 * s2l(gg / 255) + 0.0722 * s2l(b / 255); const f = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116; return 116 * f - 16; };
    let sum = 0, n = 0, sat = 0;
    const hist = new Array(11).fill(0);
    for (let i = 0; i < px.length; i += 4) {
      const l = L(px[i], px[i + 1], px[i + 2]);
      sum += l; n++;
      hist[Math.min(10, Math.max(0, Math.floor(l / 10)))]++;
      const mx = Math.max(px[i], px[i + 1], px[i + 2]) / 255, mn = Math.min(px[i], px[i + 1], px[i + 2]) / 255;
      const li = (mx + mn) / 2;
      sat += (mx - mn) < 1e-6 ? 0 : (mx - mn) / (1 - Math.abs(2 * li - 1) || 1e-6);
    }
    // region check: 64x64 block medians
    const W = c.width, H = c.height;
    let minBlock = 999, maxBlock = -1;
    for (let by = 0; by + 64 <= H; by += 64) for (let bx = 0; bx + 64 <= W; bx += 64) {
      const vals = [];
      for (let y = by; y < by + 64; y += 4) for (let x = bx; x < bx + 64; x += 4) {
        const i = (y * W + x) * 4; vals.push(L(px[i], px[i + 1], px[i + 2]));
      }
      vals.sort((a, b2) => a - b2);
      const med = vals[vals.length >> 1];
      if (med < minBlock) minBlock = med;
      if (med > maxBlock) maxBlock = med;
    }
    return { meanL: sum / n, meanS: sat / n, hist: hist.map((v) => +(100 * v / n).toFixed(1)), minBlock: +minBlock.toFixed(1), maxBlock: +maxBlock.toFixed(1) };
  }, b64);
  console.log(f, 'meanL', out.meanL.toFixed(1), 'meanS', out.meanS.toFixed(3), 'darkest64', out.minBlock, 'brightest64', out.maxBlock, 'hist%', out.hist.join(','));
}
await browser.close();
