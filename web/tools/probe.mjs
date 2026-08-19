#!/usr/bin/env node
// probe.mjs <scenario> <js-file>  — boot the game, jump to scenario, eval a file body in page.
import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { readFileSync } from 'node:fs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [scenario, jsFile] = process.argv.slice(2);
const body = readFileSync(jsFile, 'utf8');
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 30000 });
if (scenario && scenario !== '-') await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, scenario);
const out = await page.evaluate(new Function('return (async () => {' + body + '})()'));
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
await browser.close(); srv.close();
