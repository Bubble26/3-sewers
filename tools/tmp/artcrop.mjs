import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [file, x, y, w, h, out, scale = 2] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
const b64 = (await readFile(file)).toString('base64');
const data = await page.evaluate(async ([d, X, Y, W, H, S]) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + d; });
  const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(img, X, Y, W, H, 0, 0, W * S, H * S);
  return c.toDataURL('image/png');
}, [b64, +x, +y, +w, +h, +scale]);
await writeFile(out, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
console.log('wrote', out);
