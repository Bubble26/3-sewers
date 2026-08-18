#!/usr/bin/env node
// Private preview harness: boots the real page and screenshots camera setups
// directly, so a half-written sibling module cannot block my own iteration.
import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.argv[2] || '/tmp/claude-0/-home-user-logicposter/17cacca2-f2c6-5c69-86e2-c4687d2b4fbf/scratchpad/peek';
const W = 1600, H = 900;

const VIEWS = [
  ['sdA', [-5.2, 2.6, -7.6], [0.3, 0.12, 1.2], 42],
  ['sdB', [-6.0, 6.4, -6.2], [0.3, 0.10, 0.9], 40],
  ['sdC', [-9.0, 5.6, 6.2], [0.4, 0.10, -0.9], 38],
  ['textcheck', [0, 7.0, -13.0], [0, 0.1, 0.5], 40],
  ['props_tour', [13.2, 6.0, -8.6], [25.5, 3.2, 42], 46],
  ['gameplay', [0, 12, -34], [0, 4, 30], 46],
  ['plate_top', [0, 9, -12], [0, 0, 6], 40],
  ['right_curb', [-6, 5.5, 34], [22, 4, 66], 45],
  ['wagon', [2, 7, 52], [16, 4, 82], 42],
  ['strikebox', [7, 5.2, -16], [24, 4.2, -2], 44],
];

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 30000 });
await mkdir(OUT, { recursive: true });
await page.evaluate(() => { globalThis.__SB.advance(0.7); });
for (const [name, pos, look, fov] of VIEWS) {
  await page.evaluate(([p, l, f]) => {
    const app = globalThis.__SB.app;
    app.camera.fov = f; app.camera.updateProjectionMatrix();
    app.camera.position.set(...p); app.camera.lookAt(...l);
    globalThis.__SB.renderOnce();
  }, [pos, look, fov]);
  await page.waitForTimeout(90);
  await page.evaluate(() => globalThis.__SB.renderOnce());
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}
const info = await page.evaluate(() => {
  const r = globalThis.__SB.stage.renderer.info;
  return { calls: r.render.calls, tris: r.render.triangles, geo: r.memory.geometries, tex: r.memory.textures,
    colliders: (globalThis.__SB.app.world && globalThis.__SB.app.world.colliders || []).length };
});
console.log(JSON.stringify({ info, logs }, null, 2));
await writeFile(join(OUT, 'log.json'), JSON.stringify({ info, logs }, null, 2));
await browser.close(); srv.close();
