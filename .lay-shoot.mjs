// scratch: tools/shoot.mjs with a patient goto, for a machine with four cores and
// three other agents on it. Not a deliverable; tools/shoot.mjs is the gate.
import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', 'shots/lay');
const W = Number(flag('w', 1600)), H = Number(flag('h', 900));
const names = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out' && argv[i - 1] !== '--w' && argv[i - 1] !== '--h');

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 240000 });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 240000 });

const scenarios = names.length ? names : await page.evaluate(() => globalThis.__SB.listScenarios());
await mkdir(OUT, { recursive: true });
const errors = [];
for (const name of scenarios) {
  try {
    await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, name);
    await page.waitForTimeout(120);
    await page.evaluate(() => globalThis.__SB.renderOnce());
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  } catch (e) { errors.push(`${name}: ${e.message}`); }
}
const rep = await page.evaluate(() => {
  const c = globalThis.__SB.app.get('cameras');
  return { errors: globalThis.__SB.errors, batting: c?.report?.('batting') ?? null, field: c?.report?.('field') ?? null };
});
await writeFile(join(OUT, 'report.json'), JSON.stringify({ errors, console: logs, ...rep }, null, 2));
console.log(JSON.stringify({ errors, console: logs, batting: rep.batting, field: rep.field }, null, 2));
await browser.close(); srv.close();
