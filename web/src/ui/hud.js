import { registerSystem } from '../app.js';
import { chalkText, chalkTally, chalkWidth } from './chalkfont.js';
import { CHALK, INK, PAVEMENT, TEAMS, ACCENTS, hexCSS } from '../render/palette.js';
import { screen } from '../chars/portraits.js';

/**
 * The HUD, per DESIGN-BIBLE §11: every element is a depicted physical object with a nameable
 * material. Point at any of it and the honest answer is "chalk on a granite kerbstone", not
 * "a rectangle".
 *
 *   score   chalk numerals on a kerb slab, rewritten each inning
 *   count   three chalked patches on the kerb flank — balls, strikes, outs — as tally marks
 *   bases   a chalk diamond, its corners drawn as the objects the bases actually are
 *
 * The bible's constraints, all obeyed and all checkable: ≤12% of frame, ≤3 corner clusters,
 * inside a 4% safe margin, nothing over the batter or the ball, no neutral grey below S 0.10,
 * no axis-aligned rectangle with four equal corners — everything sits 1–4° off frame axes — no
 * hairline under 1.5px, and no default fonts (chalkfont.js draws the letterforms rather than
 * typesetting them).
 *
 * Canvas rather than DOM, because chalk needs a brush. Redrawn only when the state it shows
 * changes, so a HUD that is static through most of an at-bat costs nothing per frame.
 */

const SAFE = 0.04;
const css = (hex, a = 1) => (a === 1 ? hexCSS(hex) : `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`);

export class HUD {
  constructor(root) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-canvas';
    Object.assign(this.canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none',
    });
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.last = '';
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.resize();
    addEventListener('resize', () => { this.resize(); this.last = ''; });
  }

  resize() {
    const w = this.canvas.clientWidth || 1600, h = this.canvas.clientHeight || 900;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w; this.h = h;
  }

  /** Only redraw when something visible actually changed. */
  update(s, extra = {}) {
    const key = [s.inning, s.half, s.balls, s.strikes, s.outs, s.score.away, s.score.home,
      (s.bases || []).map((b) => (b ? 1 : 0)).join(''), extra.batter || '', this.w, this.h].join('|');
    if (key === this.last) return;
    this.last = key;
    this.draw(s, extra);
  }

  draw(s, extra) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const m = Math.round(Math.min(this.w, this.h) * SAFE);
    const u = Math.max(13, Math.round(this.h * 0.026));   // one chalk cap-height

    // Top-left belongs to the announcer's name card, so the score takes the free bottom-right
    // corner and pairs with the base diamond to frame the play rather than crowd it.
    this.drawScore(ctx, this.w - m - Math.round(u * 12.4), this.h - m - Math.round(u * 4.6), u, s);
    this.drawCount(ctx, this.w - m, m, u, s);
    this.drawBases(ctx, m, this.h - m, u, s, extra);
  }

  // ── the kerbstone the score is written on ────────────────────────────────
  slab(ctx, x, y, w, h, tilt, seed = 1) {
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);

    let sd = seed * 7919;
    const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };

    // A kerbstone is a chipped quadrilateral with a broken arris, not four equal corners.
    // Walking the outline with jitter is what stops it reading as a UI panel.
    const edge = (px, py, amt) => [px + (rnd() - 0.5) * amt, py + (rnd() - 0.5) * amt];
    const pts = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) pts.push(edge(2 + (w - 3) * (i / steps), 2 * (1 - i / steps), 3.4));
    for (let i = 0; i <= 2; i++) pts.push(edge(w - 1 + i * 0.4, 1 + (h - 3) * (i / 2), 2.6));
    for (let i = 0; i <= steps; i++) pts.push(edge(w - (w - 1) * (i / steps), h - 2 + 2 * (i / steps), 3.4));
    for (let i = 0; i <= 2; i++) pts.push(edge(0.5 - i * 0.3, h - (h - 3) * (i / 2), 2.6));

    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();

    // it sits ON the street, so it casts
    ctx.save();
    ctx.shadowColor = 'rgba(20,14,10,0.45)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    const g = ctx.createLinearGradient(0, 0, w * 0.25, h);
    g.addColorStop(0, css(PAVEMENT.asphaltWarm, 0.95));
    g.addColorStop(0.55, css(PAVEMENT.asphaltShade, 0.96));
    g.addColorStop(1, css(PAVEMENT.asphaltDark, 0.96));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // grain: granite is speckled, and the speckle is most of why stone reads as stone
    ctx.save();
    ctx.clip();
    for (let i = 0; i < Math.round(w * h * 0.022); i++) {
      const gx = rnd() * w, gy = rnd() * h, r = 0.4 + rnd() * 1.15;
      ctx.globalAlpha = 0.05 + rnd() * 0.13;
      ctx.fillStyle = rnd() > 0.42 ? css(CHALK) : css(INK);
      ctx.beginPath();
      ctx.ellipse(gx, gy, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.strokeStyle = css(INK, 0.66);
    ctx.lineWidth = 2.0;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // the worn top arris catching the light
    ctx.strokeStyle = css(CHALK, 0.26);
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(4, 3.6);
    ctx.lineTo(w - 5, 1.6);
    ctx.stroke();
    ctx.restore();
  }

  drawScore(ctx, x, y, u, s) {
    const w = Math.round(u * 12.4), h = Math.round(u * 4.6);
    this.slab(ctx, x, y, w, h, -2.2, 5);

    const rows = [
      { name: TEAMS.away.name, runs: s.score.away, accent: TEAMS.away.primary, batting: s.half === 'top' },
      { name: TEAMS.home.name, runs: s.score.home, accent: TEAMS.home.primary, batting: s.half === 'bottom' },
    ];
    rows.forEach((r, i) => {
      const ry = y + u * 1.7 + i * u * 1.5;
      // the side at bat gets its cap-band colour chalked beside it — the only colour up here
      if (r.batting) {
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = css(r.accent);
        ctx.beginPath();
        ctx.ellipse(x + u * 0.62, ry - u * 0.3, u * 0.3, u * 0.23, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // shrink a long block name until it clears the runs column rather than colliding with it
      const nameLeft = x + u * 1.25;
      const room = (x + w - u * 2.1) - nameLeft;
      let size = u * 0.72;
      while (chalkWidth(r.name, size) > room && size > u * 0.42) size -= u * 0.03;
      chalkText(ctx, r.name, nameLeft, ry, size, { jitter: 3 + i, tilt: -2.2, alpha: r.batting ? 1 : 0.6 });
      chalkText(ctx, String(r.runs), x + w - u * 0.7, ry + u * 0.1, u * 1.1, {
        align: 'right', jitter: 11 + i, tilt: -2.2, alpha: r.batting ? 1 : 0.7,
      });
    });

    // the inning, scratched in the corner the way you'd note which frame you're rewriting
    const half = s.half === 'top' ? 'TOP' : 'BOT';
    chalkText(ctx, `${half} ${s.inning}`, x + w - u * 0.7, y + u * 4.25, u * 0.5, {
      align: 'right', alpha: 0.6, jitter: 21, tilt: -2.2,
    });
  }

  // ── three chalked patches on the kerb flank ──────────────────────────────
  drawCount(ctx, right, y, u, s) {
    const w = Math.round(u * 7.6), h = Math.round(u * 4.9);
    const x = right - w;
    this.slab(ctx, x, y, w, h, 3.1, 12);

    const lines = [
      { label: 'BALLS', on: s.balls, of: 3 },
      { label: 'STRIKES', on: s.strikes, of: 2 },
      { label: 'OUTS', on: s.outs, of: 2 },
    ];
    lines.forEach((l, i) => {
      const ry = y + u * 1.5 + i * u * 1.28;
      chalkText(ctx, l.label, x + u * 0.6, ry, u * 0.5, { alpha: 0.8, jitter: 31 + i, tilt: 3.1 });
      // tally marks at the bible's ≥24px floor, ghosted where the count has not reached
      chalkTally(ctx, x + u * 4.5, ry + u * 0.06, u * 0.9, l.on, l.of + 1, {
        jitter: 41 + i, tilt: 3.1,
        color: l.label === 'OUTS' && l.on >= l.of ? css(ACCENTS.claret) : css(CHALK),
      });
    });
  }

  // ── a chalk diamond whose corners are the objects the bases really are ───
  drawBases(ctx, x, bottom, u, s, extra) {
    const r = u * 1.75;
    const cx = x + r + u * 0.4, cy = bottom - r - u * 1.4;
    const bases = s.bases || [];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((3.2 * Math.PI) / 180);

    ctx.strokeStyle = css(CHALK, 0.5);
    ctx.lineWidth = 2.0;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, r); ctx.lineTo(r, 0); ctx.lineTo(0, -r); ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.stroke();

    // corners: home is the manhole casting, first the stoop, second a casting, third the hydrant
    const corners = [
      { p: [0, r], kind: 'casting', on: true },
      { p: [r, 0], kind: 'stoop', on: !!bases[0] },
      { p: [0, -r], kind: 'casting', on: !!bases[1] },
      { p: [-r, 0], kind: 'hydrant', on: !!bases[2] },
    ];
    for (const c of corners) {
      const [px, py] = c.p;
      ctx.save();
      ctx.translate(px, py);
      const k = u * 0.4;
      ctx.lineWidth = 1.9;
      ctx.strokeStyle = css(CHALK, c.on ? 0.95 : 0.45);
      ctx.beginPath();
      if (c.kind === 'hydrant') {
        ctx.moveTo(-k * 0.5, k); ctx.lineTo(-k * 0.5, -k * 0.3);
        ctx.lineTo(0, -k); ctx.lineTo(k * 0.5, -k * 0.3); ctx.lineTo(k * 0.5, k);
        ctx.closePath();
      } else if (c.kind === 'stoop') {
        ctx.moveTo(-k, k); ctx.lineTo(-k, 0); ctx.lineTo(0, 0); ctx.lineTo(0, -k);
        ctx.lineTo(k, -k); ctx.lineTo(k, k);
        ctx.closePath();
      } else {
        ctx.ellipse(0, 0, k, k * 0.82, 0, 0, Math.PI * 2);
      }
      if (c.on) { ctx.fillStyle = css(CHALK, 0.85); ctx.fill(); }
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    if (extra.batter) {
      chalkText(ctx, extra.batter, cx - r - u * 0.2, bottom - u * 0.1, u * 0.55, { alpha: 0.85, jitter: 57, tilt: 3.2 });
    }
  }
}

export default registerSystem({
  name: 'hud',
  order: 200,
  init(app) {
    this.hud = new HUD(document.getElementById('ui'));
  },
  lateUpdate(dt, app) {
    // A full-screen card owns the frame while it is up; the kerb chalk has no business
    // showing through the title or the box score.
    const covered = screen.name === 'title' || screen.name === 'results' || screen.name === 'team_select';
    this.hud.canvas.style.display = covered ? 'none' : 'block';
    if (covered) { this.hud.last = ''; return; }
    const s = app.sim.state;
    let batter = '';
    try { batter = app.sim.core?.kidName?.(app.sim.batterId) || ''; } catch { /* roster not up yet */ }
    this.hud.update(s, { batter });
  },
});
