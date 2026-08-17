// Screenshot the look-dev scene with the pre-installed Chromium.
import { chromium } from 'playwright';

const out = process.argv[2] || '/tmp/lookdev.png';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader',
         '--allow-file-access-from-files'],
});
const page = await browser.newPage({
  viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:8931/tools/lookdev_threejs/scene.html');
await page.waitForFunction('window.__done === true', null, { timeout: 30000 });
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
