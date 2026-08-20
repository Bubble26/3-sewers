import { registerSystem, app } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { bus } from '../core/bus.js';
import {
  screen, chalk, fitChalk, cardShadow, chalkHead,
} from '../chars/portraits.js';
import { CHALK, INK, PAVEMENT, ACCENTS, TEAMS, BALL, hexCSS } from '../render/palette.js';
import { getKid } from '../chars/roster.js';

/**
 * The frame around the game: the title you arrive at and the box score you leave on.
 *
 * Both are drawn with the same kit the choosin'-up-sides screen uses — the pavement, the slab
 * lettering, the chalk — because a second UI language would be a second game. The rule from
 * DESIGN-BIBLE §11 holds here too: everything is a depicted object. The title is painted on a
 * kerbstone and chalked on the roadway; the results are the scores chalked up the way the block
 * would actually settle an argument about who won.
 */

const C = (h) => hexCSS(h);

/* ── title ─────────────────────────────────────────────────────────────── */

function paintTitle(g, w, h) {
  const S = Math.min(w / 1280, h / 720);
  // No painted background: this canvas sits over the live view, so the title is the real
  // block at golden hour with a sign hung over it. A flat pavement fill would be throwing
  // away the best thing the game has.
  g.clearRect(0, 0, w, h);
  const veil = g.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(20,14,10,0.34)');
  veil.addColorStop(0.45, 'rgba(20,14,10,0.10)');
  veil.addColorStop(1, 'rgba(20,14,10,0.52)');
  g.fillStyle = veil;
  g.fillRect(0, 0, w, h);

  // the ball, oversized and rolling to rest against the manhole — the one saturated thing
  const bx = w * 0.5, by = h * 0.70, br = 21 * S;
  g.save();
  g.fillStyle = 'rgba(24,16,12,0.34)';
  g.beginPath();
  g.ellipse(bx + br * 0.25, by + br * 0.92, br * 1.15, br * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  const grd = g.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.15, bx, by, br);
  grd.addColorStop(0, C(BALL.rim));
  grd.addColorStop(0.32, C(BALL.new));
  grd.addColorStop(1, C(BALL.seam));
  g.fillStyle = grd;
  g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
  g.strokeStyle = C(INK); g.lineWidth = 2.4 * S; g.stroke();
  g.restore();

  // the name, hand-lettered on a kerbstone
  const tw = Math.min(w * 0.78, 760 * S);
  const ty = h * 0.30;
  g.save();
  g.translate(w / 2, ty);
  g.rotate(-0.022);
  cardShadow(g, -tw / 2, -78 * S, tw, 150 * S, 1.25);
  const stone = g.createLinearGradient(0, -78 * S, 0, 72 * S);
  stone.addColorStop(0, C(PAVEMENT.curb));
  stone.addColorStop(1, C(PAVEMENT.asphaltShade));
  g.fillStyle = stone;
  g.beginPath();
  g.moveTo(-tw / 2, -74 * S); g.lineTo(tw / 2 - 6 * S, -78 * S);
  g.lineTo(tw / 2, 68 * S); g.lineTo(-tw / 2 + 4 * S, 72 * S);
  g.closePath(); g.fill();
  g.strokeStyle = `rgba(43,31,23,0.75)`; g.lineWidth = 3 * S; g.stroke();
  g.restore();

  fitChalk(g, 'THREE SEWERS', w / 2, ty + 12 * S, 78 * S, tw * 0.80, {
    align: 'center', color: C(CHALK), tilt: -1.3,
  });
  chalk(g, 'MULBERRY STREET · 1925', w / 2, ty + 56 * S, 22 * S, {
    align: 'center', color: C(CHALK), alpha: 0.72, tilt: -1.3,
  });

  // the invitation, chalked on the road
  const pulse = 0.62 + 0.3 * Math.sin((app.time || 0) * 2.4);
  chalk(g, 'CHALK UP — PRESS ANYTHING', w / 2, h * 0.90, 26 * S, {
    align: 'center', alpha: pulse, tilt: 0.8,
  });
  chalk(g, 'BROOM HANDLE AND A PINK BALL · TILL THE LIGHTS COME ON', w / 2, h * 0.955, 14 * S, {
    align: 'center', alpha: 0.42,
  });
}

/* ── results ───────────────────────────────────────────────────────────── */

let finalCard = null;   // { away, home, note, text, star }

function paintResults(g, w, h) {
  const S = Math.min(w / 1280, h / 720);
  // Same choice as the title: the block stays visible behind the card, dimmed, because the
  // last thing you should see after a ball game is the street you played it on.
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(20,14,10,0.62)';
  g.fillRect(0, 0, w, h);

  const cw = Math.min(w * 0.74, 720 * S), ch = Math.min(h * 0.68, 430 * S);
  const cx = w / 2, cy = h * 0.48;

  g.save();
  g.translate(cx, cy);
  g.rotate(0.014);
  cardShadow(g, -cw / 2, -ch / 2, cw, ch, 1.5);
  const stone = g.createLinearGradient(0, -ch / 2, 0, ch / 2);
  stone.addColorStop(0, C(PAVEMENT.curb));
  stone.addColorStop(1, C(PAVEMENT.asphaltDark));
  g.fillStyle = stone;
  g.beginPath();
  g.moveTo(-cw / 2, -ch / 2 + 5 * S); g.lineTo(cw / 2 - 7 * S, -ch / 2);
  g.lineTo(cw / 2, ch / 2 - 4 * S); g.lineTo(-cw / 2 + 5 * S, ch / 2);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(43,31,23,0.8)'; g.lineWidth = 3.4 * S; g.stroke();
  g.restore();

  const f = finalCard || { away: 0, home: 0, note: '', text: '' };
  const top = cy - ch / 2;

  fitChalk(g, f.note || 'THAT’S THE BALL GAME', cx, top + 54 * S, 34 * S, cw * 0.82, {
    align: 'center', alpha: 0.9, tilt: 0.9,
  });

  const rows = [
    { name: TEAMS.away.name, runs: f.away, accent: TEAMS.away.primary },
    { name: TEAMS.home.name, runs: f.home, accent: TEAMS.home.primary },
  ];
  const won = f.away === f.home ? -1 : (f.away > f.home ? 0 : 1);
  rows.forEach((r, i) => {
    const ry = top + (120 + i * 62) * S;
    g.save();
    g.fillStyle = C(r.accent);
    g.globalAlpha = 0.95;
    g.beginPath(); g.ellipse(cx - cw * 0.36, ry - 10 * S, 9 * S, 7 * S, -0.2, 0, Math.PI * 2); g.fill();
    g.restore();
    fitChalk(g, r.name, cx - cw * 0.10, ry, 34 * S, cw * 0.44, {
      align: 'center', alpha: won === i ? 1 : 0.66,
    });
    chalk(g, String(r.runs), cx + cw * 0.34, ry + 4 * S, 46 * S, {
      align: 'center', alpha: won === i ? 1 : 0.7,
    });
  });

  // a rule scratched under the line score
  g.save();
  g.strokeStyle = `rgba(246,240,226,0.34)`;
  g.lineWidth = 2 * S;
  g.beginPath();
  g.moveTo(cx - cw * 0.38, top + 250 * S);
  g.lineTo(cx + cw * 0.38, top + 245 * S);
  g.stroke();
  g.restore();

  if (f.text) {
    fitChalk(g, f.text, cx, top + 288 * S, 20 * S, cw * 0.84, { align: 'center', alpha: 0.78 });
  }
  if (f.star) {
    const kid = getKid(f.star);
    if (kid) {
      chalkHead(g, kid, cx - cw * 0.30, top + 350 * S, 46 * S, {});
      fitChalk(g, `${kid.nick || kid.name} HAD THE DAY`, cx + cw * 0.10, top + 356 * S, 19 * S, cw * 0.5, { align: 'center', alpha: 0.8 });
    }
  }
  chalk(g, 'PRESS ANYTHING FOR ANOTHER', cx, cy + ch / 2 + 34 * S, 19 * S, {
    align: 'center', alpha: 0.55,
  });
}

/* ── system ────────────────────────────────────────────────────────────── */

function openTitle() { screen.open('title', paintTitle); }
function openResults() { screen.open('results', paintResults); }

export default registerSystem({
  name: 'screens',
  order: 208,
  init(a) {
    screen.mount();
    bus.on('game:over', (p) => {
      finalCard = {
        away: p.score?.away ?? 0,
        home: p.score?.home ?? 0,
        note: p.note || '',
        text: p.text || '',
        star: p.star || null,
      };
      openResults();
    });
    // The title is where a cold boot lands, but never in the harness — a screenshot
    // run wants the scenario it asked for, not a splash over the top of it.
    if (!a.flags.harness) openTitle();
  },
  lateUpdate() {
    if (screen.name === 'title' || screen.name === 'results') screen.paint();
  },
  onInput(action) {
    if (screen.name === 'title') { screen.close(); return; }
    if (screen.name === 'results') { screen.close(); app.sim.reset(Date.now() & 0xffff); }
  },
});

registerScenario('screen_title', {
  seed: 1925,
  setup: () => { openTitle(); screen.paint(); },
  settle: 0.02,
});

registerScenario('screen_results', {
  seed: 1926,
  setup: () => {
    finalCard = {
      away: 11, home: 12, note: 'WALK-OFF!', star: 'tiny',
      text: 'TIED IT WITH TWO GONE AND TOOK IT ON THE NEXT ONE',
    };
    openResults();
    screen.paint();
  },
  settle: 0.02,
});
