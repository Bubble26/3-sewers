#!/usr/bin/env node
/**
 * Deterministic screenshot harness.
 *
 *   node tools/shoot.mjs                       # every registered scenario -> shots/
 *   node tools/shoot.mjs pitch contact         # only these
 *   node tools/shoot.mjs --out shots/round3    # custom output dir
 *   node tools/shoot.mjs --w 1600 --h 900      # viewport
 *
 * Prints a JSON report (paths + console errors). Exit code 1 if the page threw.
 */
import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', 'shots');
const W = Number(flag('w', 1600)), H = Number(flag('h', 900));
const only = argv.filter((a) => !a.startsWith('--') && !argv.includes('--' + a) && !/^\d+$/.test(a) && argv[argv.indexOf(a) - 1]?.replace('--', '') !== 'out');
const wanted = only.filter((a) => !['shots'].includes(a) && !a.includes('/'));

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 240000 });

const scenarios = wanted.length ? wanted : await page.evaluate(() => globalThis.__SB.listScenarios());
await mkdir(OUT, { recursive: true });
const report = { out: OUT, viewport: { W, H }, shots: [], errors: [] };

for (const name of scenarios) {
  try {
    await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, name);
    // let any async texture/material work land, then draw one more deterministic frame
    await page.waitForTimeout(120);
    await page.evaluate(() => globalThis.__SB.renderOnce());
    const file = join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    report.shots.push(file);
  } catch (e) {
    report.errors.push(`${name}: ${e.message}`);
  }
}
report.errors.push(...(await page.evaluate(() => globalThis.__SB.errors)));
report.console = logs;
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close(); srv.close();
process.exit(report.errors.length ? 1 : 0);
