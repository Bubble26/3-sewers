#!/usr/bin/env node
/**
 * Renders docs/progress.html from docs/progress.json + the newest screenshots.
 * The HTML is self-contained (thumbnails inlined as data URIs) so it can be published
 * as an artifact and watched while the build runs.
 *
 *   node tools/progress.mjs
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(await readFile(join(ROOT, 'docs/progress.json'), 'utf8'));

async function thumbs(dir, max = 6) {
  const out = [];
  try {
    const files = (await readdir(join(ROOT, dir))).filter((f) => f.endsWith('.png'));
    const stamped = await Promise.all(files.map(async (f) => ({ f, m: (await stat(join(ROOT, dir, f))).mtimeMs })));
    stamped.sort((a, b) => b.m - a.m);
    for (const { f } of stamped.slice(0, max)) {
      const buf = await readFile(join(ROOT, dir, f));
      if (buf.length > 1_600_000) continue;
      out.push({ name: basename(f, '.png'), src: `data:image/png;base64,${buf.toString('base64')}` });
    }
  } catch { /* dir may not exist yet */ }
  return out;
}

const shots = await thumbs(data.thumbDir || 'shots/board', 8);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS = {
  done: { label: 'Signed off', cls: 'ok' },
  built: { label: 'Built — not yet judged', cls: 'live' },
  partial: { label: 'Cut short by API outage', cls: 'warn' },
  building: { label: 'On the field', cls: 'live' },
  critique: { label: 'Under critique', cls: 'live' },
  rework: { label: 'Sent back in', cls: 'warn' },
  queued: { label: 'On deck', cls: 'idle' },
};

const axes = ['joy', 'readability', 'character', 'period', 'craft', 'aliveness', 'feel', 'cohesion'];

const pieceCard = (p) => {
  const st = STATUS[p.status] || STATUS.queued;
  const scores = p.scores || {};
  const bars = axes.filter((a) => scores[a] != null).map((a) => `
        <div class="axis">
          <span class="axis-name">${a}</span>
          <span class="meter"><i style="width:${scores[a] * 10}%"></i></span>
          <span class="axis-val">${scores[a]}</span>
        </div>`).join('');
  return `
      <article class="piece ${st.cls}">
        <header>
          <span class="chip ${st.cls}">${st.label}</span>
          <span class="rounds">${p.rounds || 0} ${p.rounds === 1 ? 'round' : 'rounds'}</span>
        </header>
        <h3>${esc(p.name)}</h3>
        <p class="what">${esc(p.what)}</p>
        ${bars ? `<div class="axes">${bars}</div>` : ''}
        ${p.gap ? `<p class="gap"><span>Biggest gap</span>${esc(p.gap)}</p>` : ''}
      </article>`;
};

const waveBlock = (w) => `
    <section class="wave" id="wave-${esc(w.id)}">
      <div class="wave-head">
        <span class="inning">${esc(w.id)}</span>
        <h2>${esc(w.title)}</h2>
        <span class="wave-state">${esc(w.state)}</span>
      </div>
      <div class="pieces">${w.pieces.map(pieceCard).join('')}</div>
    </section>`;

const html = `<title>The Stickball Scoreboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ultra&family=Limelight&family=Archivo+Narrow:wght@400;500;600;700&display=swap">
<style>
  :root {
    --ink: #12181f;        /* enamel board */
    --panel: #1a232c;
    --panel-2: #212c37;
    --chalk: #f0e7d4;
    --chalk-dim: #a9b3bd;
    --rule: #2f3d4a;
    --gold: #d8a441;
    --brick: #b8492e;
    --verdigris: #4f9080;
    --amber: #e2a63a;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ink); color: var(--chalk);
    font-family: 'Archivo Narrow', 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px; line-height: 1.5;
    background-image:
      radial-gradient(120% 80% at 50% -10%, rgba(216,164,65,.10), transparent 60%),
      repeating-linear-gradient(0deg, rgba(255,255,255,.014) 0 2px, transparent 2px 4px);
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 24px 80px; }

  header.board { border: 3px solid var(--gold); border-radius: 4px; padding: 22px 26px; background: linear-gradient(180deg, var(--panel-2), var(--panel)); box-shadow: 0 18px 44px rgba(0,0,0,.45); }
  .eyebrow { font-family: 'Limelight', serif; letter-spacing: .28em; text-transform: uppercase; font-size: 12px; color: var(--gold); }
  h1 { font-family: 'Ultra', Georgia, serif; font-size: clamp(30px, 5.4vw, 56px); line-height: .96; margin: 10px 0 6px; text-wrap: balance; letter-spacing: -.01em; }
  .tagline { color: #c3b79e; max-width: 62ch; margin: 0; }

  .linescore { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--rule); }
  .stat { flex: 1 1 130px; }
  .stat b { display: block; font-family: 'Ultra', Georgia, serif; font-size: 30px; line-height: 1; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11px; letter-spacing: .16em; text-transform: uppercase; color: #93a2ae; }

  .wave { margin-top: 44px; }
  .wave-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 2px solid var(--rule); padding-bottom: 8px; }
  .inning { font-family: 'Ultra', Georgia, serif; font-size: 13px; color: var(--ink); background: var(--gold); border-radius: 3px; padding: 3px 9px; letter-spacing: .06em; }
  .wave h2 { font-family: 'Limelight', serif; font-size: 21px; letter-spacing: .06em; margin: 0; flex: 1; text-transform: uppercase; }
  .wave-state { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: #93a2ae; }

  .pieces { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-top: 16px; }
  .piece { background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; padding: 14px 15px 15px; position: relative; overflow: hidden; }
  .piece::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: #3c4b58; }
  .piece.ok::before { background: var(--verdigris); }
  .piece.live::before { background: var(--gold); }
  .piece.warn::before { background: var(--brick); }
  .piece header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .chip { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; border: 1px solid currentColor; }
  .chip.ok { color: var(--verdigris); }
  .chip.live { color: var(--gold); }
  .chip.warn { color: var(--brick); }
  .chip.idle { color: #7d8b97; }
  .rounds { font-size: 11px; color: #7d8b97; letter-spacing: .1em; text-transform: uppercase; font-variant-numeric: tabular-nums; }
  .piece h3 { font-family: 'Archivo Narrow', sans-serif; font-weight: 700; font-size: 17px; margin: 9px 0 4px; letter-spacing: .01em; }
  .what { margin: 0; font-size: 13.5px; color: #b3bcc5; }
  .axes { margin-top: 11px; display: grid; gap: 3px; }
  .axis { display: grid; grid-template-columns: 74px 1fr 22px; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #93a2ae; }
  .meter { height: 5px; background: #2a3742; border-radius: 999px; overflow: hidden; }
  .meter i { display: block; height: 100%; background: linear-gradient(90deg, var(--brick), var(--gold)); }
  .axis-val { font-variant-numeric: tabular-nums; color: var(--chalk); text-align: right; }
  .gap { margin: 11px 0 0; font-size: 13px; color: #d8cdb6; border-top: 1px dashed var(--rule); padding-top: 9px; }
  .gap span { display: block; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--brick); margin-bottom: 2px; }

  .gallery { margin-top: 48px; }
  .gallery h2 { font-family: 'Limelight', serif; font-size: 21px; letter-spacing: .06em; text-transform: uppercase; border-bottom: 2px solid var(--rule); padding-bottom: 8px; }
  .frames { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; margin-top: 16px; }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; overflow: hidden; }
  figure img { display: block; width: 100%; height: auto; }
  figcaption { padding: 7px 11px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #93a2ae; }

  .wire { margin-top: 48px; }
  .wire h2 { font-family: 'Limelight', serif; font-size: 21px; letter-spacing: .06em; text-transform: uppercase; border-bottom: 2px solid var(--rule); padding-bottom: 8px; }
  .wire ol { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 8px; }
  .wire li { display: grid; grid-template-columns: 84px 1fr; gap: 12px; padding: 9px 12px; background: var(--panel); border-left: 3px solid var(--rule); font-size: 14px; }
  .wire li b { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--gold); align-self: start; padding-top: 2px; }
  footer { margin-top: 54px; padding-top: 16px; border-top: 1px solid var(--rule); font-size: 12px; color: #7d8b97; letter-spacing: .08em; text-transform: uppercase; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
  @media (prefers-reduced-motion: no-preference) { .piece.live { animation: pulse 3.4s ease-in-out infinite; } }
  @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 rgba(216,164,65,0); } 50% { box-shadow: 0 0 20px rgba(216,164,65,.13); } }
</style>

<div class="wrap">
  <header class="board">
    <p class="eyebrow">Build in progress &middot; ${esc(data.updated)}</p>
    <h1>${esc(data.title)}</h1>
    <p class="tagline">${esc(data.tagline)}</p>
    <div class="linescore">
      <div class="stat"><b>${data.stats.pieces}</b><span>Pieces</span></div>
      <div class="stat"><b>${data.stats.signedOff}</b><span>Signed off</span></div>
      <div class="stat"><b>${data.stats.rounds}</b><span>Critique rounds</span></div>
      <div class="stat"><b>${data.stats.agents}</b><span>Agents run</span></div>
      <div class="stat"><b>${esc(data.stats.phase)}</b><span>Current wave</span></div>
    </div>
  </header>

  ${data.waves.map(waveBlock).join('')}

  ${shots.length ? `<section class="gallery">
    <h2>Latest frames from the running game</h2>
    <div class="frames">${shots.map((s) => `<figure><img src="${s.src}" alt="${esc(s.name)}"><figcaption>${esc(s.name)}</figcaption></figure>`).join('')}</div>
  </section>` : ''}

  ${data.wire?.length ? `<section class="wire">
    <h2>From the critics</h2>
    <ol>${data.wire.map((w) => `<li><b>${esc(w.when)}</b><span>${esc(w.text)}</span></li>`).join('')}</ol>
  </section>` : ''}

  <footer>
    <span>Every frame above was rendered from the real game in headless Chromium</span>
    <span>${esc(data.updated)}</span>
  </footer>
</div>`;

await writeFile(join(ROOT, 'docs/progress.html'), html);
console.log(`docs/progress.html  ${Math.round(Buffer.byteLength(html) / 1024)} KB  (${shots.length} frames)`);
