#!/usr/bin/env node
/** crop.mjs <png> <x> <y> <w> <h> [--zoom 2] [--out file]  — magnify a region of a shot. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const [file, x, y, w, h] = a;
const Z = Number(flag('zoom', 2));
const OUT = flag('out', 'shots/_crop.png');
const b64 = readFileSync(file).toString('base64');
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: Math.round(w * Z), height: Math.round(h * Z) } });
await page.setContent(`<style>body{margin:0;overflow:hidden}img{position:absolute;left:${-x * Z}px;top:${-y * Z}px;width:${1600 * Z}px;image-rendering:auto}</style><img src="data:image/png;base64,${b64}">`);
await page.screenshot({ path: OUT });
console.log(OUT);
await browser.close();
