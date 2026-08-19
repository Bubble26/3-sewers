import { chromium } from 'playwright';
import { readFile, writeFile, readdir } from 'node:fs/promises';
const dir = process.argv[2], out = process.argv[3], cols = Number(process.argv[4]||2);
const files = (await readdir(dir)).filter(f=>f.endsWith('.png')&&!f.startsWith('strip')).sort();
const imgs = [];
for (const f of files) imgs.push((await readFile(dir+'/'+f)).toString('base64'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
const data = await page.evaluate(async ({ imgs, cols }) => {
  const loaded = [];
  for (const b of imgs) { const i = new Image(); i.src='data:image/png;base64,'+b; await i.decode(); loaded.push(i); }
  const tw = 760, th = Math.round(760*900/1600);
  const rows = Math.ceil(loaded.length/cols);
  const c = document.createElement('canvas');
  c.width = cols*tw; c.height = rows*th;
  const g = c.getContext('2d');
  g.fillStyle='#111'; g.fillRect(0,0,c.width,c.height);
  loaded.forEach((im,i)=>{ g.drawImage(im,(i%cols)*tw, Math.floor(i/cols)*th, tw, th);
    g.fillStyle='#fff'; g.font='bold 22px monospace'; g.fillText(String(i),(i%cols)*tw+8, Math.floor(i/cols)*th+26); });
  return c.toDataURL('image/png');
}, { imgs, cols });
await writeFile(out, Buffer.from(data.split(',')[1],'base64'));
await browser.close();
