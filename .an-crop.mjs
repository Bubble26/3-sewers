// crop+zoom a PNG using a headless canvas via playwright (no image libs installed)
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const [src, out, x, y, w, h, z] = [process.argv[2], process.argv[3], ...process.argv.slice(4).map(Number)];
const b64 = (await readFile(src)).toString('base64');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const data = await page.evaluate(async ({ b64, x, y, w, h, z }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w * z; c.height = h * z;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(img, x, y, w, h, 0, 0, w * z, h * z);
  return c.toDataURL('image/png');
}, { b64, x, y, w, h, z: z || 2 });
await writeFile(out, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
