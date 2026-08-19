import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [scen, outDir, framesS, stepS] = [process.argv[2], process.argv[3], Number(process.argv[4]||12), Number(process.argv[5]||0.25)];
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs=[]; page.on('console', m=>{if(m.type()==='error'||m.type()==='warning')logs.push(m.text());});
page.on('pageerror', e=>logs.push('ERR '+e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil:'domcontentloaded', timeout:180000 });
await page.waitForFunction(()=>globalThis.__SB&&globalThis.__SB.ready,null,{timeout:180000});
await mkdir(outDir,{recursive:true});
await page.evaluate(async n=>{await globalThis.__SB.scenario(n);}, scen);
for (let i=0;i<framesS;i++){
  await page.evaluate(s=>{globalThis.__SB.advance(s);globalThis.__SB.renderOnce();}, stepS);
  await page.screenshot({path: join(outDir, `${scen}-${String(i).padStart(2,'0')}.png`)});
}
console.log(JSON.stringify({logs, errs: await page.evaluate(()=>globalThis.__SB.errors)}));
await browser.close(); srv.close();
