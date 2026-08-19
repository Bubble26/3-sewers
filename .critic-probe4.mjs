import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { readFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const idx = await readFile('index.html','utf8');
const importmap = (idx.match(/<script type="importmap">[\s\S]*?<\/script>/)||[''])[0];
await page.setContent(`<!doctype html><html><head>${importmap}</head><body><script type="module">
window.T = {};
(async()=>{
  const out = {};
  let t = performance.now();
  await import('/src/audio/sfx.js'); out.sfx = +(performance.now()-t).toFixed(1);
  t = performance.now();
  await import('/src/audio/engine.js'); out.engine = +(performance.now()-t).toFixed(1);
  t = performance.now();
  await import('/src/audio/music.js'); out.music = +(performance.now()-t).toFixed(1);
  window.__R = out;
})().catch(e=>{window.__R={err:String(e)}});
</script></body></html>`, { baseURL: `http://127.0.0.1:${port}/` });
await page.goto(`http://127.0.0.1:${port}/.critic-blank.html`).catch(()=>{});
await browser.close(); srv.close();
