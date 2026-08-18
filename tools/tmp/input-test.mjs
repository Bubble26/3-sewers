import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, hasTouch: true });
const logs = [];
page.on('console', m => { if (m.type()==='error'||m.type()==='warning') logs.push(m.text()); });
page.on('pageerror', e => logs.push('pageerror ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready);
await page.evaluate(async () => { await globalThis.__SB.scenario('team_select'); });

const state = () => page.evaluate(() => {
  const m = globalThis.__SB.app.systems.find(s => s.name === 'teamselect');
  return null;
});
// read draft through the module by poking the canvas events and observing hover via a probe
await page.evaluate(() => { globalThis.__probe = () => { const c = document.getElementById('sb-screen'); return { w: c.width, h: c.height, pe: getComputedStyle(c).pointerEvents, display: getComputedStyle(c).display }; }; });
console.log('canvas', await page.evaluate(() => globalThis.__probe()));

// KEYBOARD
const before = await page.screenshot();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.evaluate(() => globalThis.__SB.renderOnce());
const afterKey = await page.screenshot();
console.log('keyboard changed frame:', Buffer.compare(before, afterKey) !== 0);

// MOUSE hover + click on a pool chip (row 3, col 1 -> SKINNY)
await page.mouse.move(670, 650);
await page.evaluate(() => globalThis.__SB.renderOnce());
const afterHover = await page.screenshot();
console.log('mouse hover changed frame:', Buffer.compare(afterKey, afterHover) !== 0);
await page.mouse.click(670, 650);
await page.evaluate(() => { globalThis.__SB.advance(0.2); globalThis.__SB.renderOnce(); });
const afterClick = await page.screenshot();
console.log('mouse click changed frame:', Buffer.compare(afterHover, afterClick) !== 0);

// TOUCH
await page.touchscreen.tap(950, 650);
await page.evaluate(() => { globalThis.__SB.advance(0.2); globalThis.__SB.renderOnce(); });
const afterTap = await page.screenshot();
console.log('touch tap changed frame:', Buffer.compare(afterClick, afterTap) !== 0);

// __SB.input harness path
await page.evaluate(() => { globalThis.__SB.input('right'); globalThis.__SB.input('pick'); globalThis.__SB.advance(0.3); globalThis.__SB.renderOnce(); });
const afterInput = await page.screenshot();
console.log('__SB.input changed frame:', Buffer.compare(afterTap, afterInput) !== 0);

// run the draft to completion, make sure it never softlocks
await page.evaluate(() => { for (let i = 0; i < 60 * 90; i++) globalThis.__SB.advance(1/60); globalThis.__SB.renderOnce(); });
await page.screenshot({ path: '/home/user/logicposter/stickball/shots/roster-personality-r1/team_select-done.png' });
console.log('errors', await page.evaluate(() => globalThis.__SB.errors), logs);
// and leaving the screen must not leave the overlay behind
await page.evaluate(async () => { await globalThis.__SB.scenario('pitch'); });
console.log('overlay hidden after leaving:', await page.evaluate(() => getComputedStyle(document.getElementById('sb-screen')).display));
await browser.close(); srv.close();
