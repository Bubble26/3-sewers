import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const src = process.argv[2], out = process.argv[3], W = Number(process.argv[4] || 1600);
const b64 = (await readFile(src)).toString('base64');
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: W, height: Math.round(W * 9 / 16) } });
await page.setContent(`<body style="margin:0"><canvas id=c></canvas></body>`);
const png = await page.evaluate(async ({ b64, W }) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  // downsample first, exactly as the blackout test asks: judge at 96 px of kid height
  const c = document.getElementById('c');
  c.width = W; c.height = Math.round(W * img.height / img.width);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    // background of the studio is the pale wall / stoop / floor; kids are everything darker
    const L = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    const bg = Math.abs(p[i] - p[i + 1]) < 26 && Math.abs(p[i + 1] - p[i + 2]) < 40 && L > 118;
    const v = bg ? 255 : 0;
    p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}, { b64, W });
await writeFile(out, Buffer.from(png, 'base64'));
await browser.close();
console.log('wrote', out);
