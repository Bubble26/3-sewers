#!/usr/bin/env node
/**
 * soak.mjs — the rules core, forty ball games at a time, in about a second.
 *
 *   node tools/soak.mjs                 # the acceptance run
 *   node tools/soak.mjs --games 400     # the same distributions, less noise
 *   node tools/soak.mjs --verbose       # a line per game
 *
 * A port of tests/sim_test.gd from the Godot stickball project our rules core came
 * from (docs/godot-reference/, docs/PORT-SPEC.md), which published three numbers
 * off 40 CPU-vs-CPU games:
 *
 *     13.8 runs a game (+-2.0) · 3.6 sewer shots a game (+-1.0) ·
 *     a smashed window about once every 13 games (+-half) · and no hangs.
 *
 * It runs twice, because those two questions are different questions:
 *
 *   THE CONTROL   their twelve kids, their split, our ported rules. This is the
 *                 port-fidelity check and the thing the baselines apply to. If it
 *                 drifts, the port is wrong — not the baseline.
 *   THE BLOCK     our sixteen kids, eight a side, picked the way captains pick.
 *                 This is what actually ships, and it scores differently for
 *                 reasons that are about the roster and not about the rules. The
 *                 report says how differently, and why.
 *
 * Exit code 1 on a hang, on a control run outside tolerance, or if the block's
 * scoring leaves the sane band entirely.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MatchCore, blockIds, blockRoster, pickSides, pressGaps } from '../src/game/core.js';
import { T } from '../src/core/tuning.js';
import { ROSTER, QUIRKS, QUIRK_HOLDER } from '../src/chars/roster.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const num = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? Number(argv[i + 1]) : d; };
const GAMES = num('games', 40);
const SETTLED = num('settled', 400);      // the low-noise control: 40 games of anything is a coin toss
const INNINGS = num('innings', T.play.innings);
const GUARD = num('guard', 3000);         // their hang guard: 3000 pitches in one game
const VERBOSE = argv.includes('--verbose');

const BASE = {
  runs: { target: 13.8, tol: 2.0, label: 'runs a game' },
  hrs: { target: 3.6, tol: 1.0, label: 'sewer shots a game' },
  windows: { target: 13, tol: 6.5, label: 'games per smashed window' },
};

const b = (s) => `\x1b[1m${s}\x1b[0m`;
const d = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

let hangs = 0;

/** One soak: N games, seeds 1..N, CPU on both sides. Exactly the sim_test loop. */
function soak(roster, away, home, games) {
  const r = {
    scores: [], runs: 0, hrs: 0, windows: 0, fireEscapes: 0, flivvers: 0,
    ks: 0, walks: 0, fouls: 0, pitches: 0, plates: 0, awayRuns: 0, homeRuns: 0,
    close: 0, sewers: [0, 0, 0, 0], byKid: new Map(), longest: 0, cheese: 0,
  };
  for (let g = 0; g < games; g++) {
    const core = new MatchCore().setup(away, home, roster, -1, INNINGS, g + 1);
    let guard = 0;
    while (!core.gameOver && guard < GUARD) {
      guard += 1;
      const p = core.makeCpuPitch();
      core.beginPitch(p);
      const sw = core.cpuSwing(p);
      const ev = sw.swing ? core.resolveSwing(sw.errMs) : core.resolveNoSwing();
      if (ev.kind === 'in_play') {
        r.plates += 1;
        if (ev.result === 'hr') {
          r.hrs += 1;
          r.sewers[ev.sewers] += 1;
          r.byKid.set(ev.batter, (r.byKid.get(ev.batter) || 0) + 1);
        }
        if (ev.window) r.windows += 1;
        if (ev.fireEscape) r.fireEscapes += 1;
        if (ev.flivver) r.flivvers += 1;
      }
      if (ev.kind === 'strikeout') { r.ks += 1; r.plates += 1; }
      if (ev.kind === 'walk') { r.walks += 1; r.plates += 1; }
      if (ev.kind === 'foul') r.fouls += 1;
      if (core.checkHalf().cheese) r.cheese += 1;
    }
    if (guard >= GUARD) { hangs += 1; console.log(red(`  HANG at seed ${g + 1} — 3000 pitches and still playing`)); }
    r.pitches += guard;
    r.longest = Math.max(r.longest, guard);
    r.runs += core.score[0] + core.score[1];
    r.awayRuns += core.score[0];
    r.homeRuns += core.score[1];
    if (Math.abs(core.score[0] - core.score[1]) <= 3) r.close += 1;
    r.scores.push(`${core.score[0]}-${core.score[1]}`);
    if (VERBOSE) {
      console.log(d(`    seed ${String(g + 1).padStart(3)}  ${String(core.score[0]).padStart(2)}-${String(core.score[1]).padEnd(2)}`
        + `  ${String(guard).padStart(4)} pitches  ${core.winnerText()}${core.finalNote ? '  · ' + core.finalNote : ''}`));
    }
  }
  r.games = games;
  r.runsPer = r.runs / games;
  r.hrsPer = r.hrs / games;
  r.windowEvery = r.windows > 0 ? games / r.windows : Infinity;
  return r;
}

// ── the two rosters ─────────────────────────────────────────────────────────
// Their twelve, read straight from the reference dump. It is a test fixture and
// nothing else: none of it reaches the game, which uses our sixteen.
const raw = JSON.parse(readFileSync(ROOT + 'docs/godot-reference/characters.json', 'utf8'));
const theirRoster = {};
for (const [id, c] of Object.entries(raw)) {
  theirRoster[id] = { name: c.name, PWR: c.PWR, CON: c.CON, SPD: c.SPD, ARM: c.ARM, GLV: c.GLV, quirk: c.quirk };
}
const theirIds = Object.keys(theirRoster).sort();

const ourRoster = blockRoster();
const [visitors, gang] = pickSides(blockIds());
const nick = (id) => (ROSTER.find((k) => k.id === id) || { nick: id }).nick;

// ── run them ────────────────────────────────────────────────────────────────
const t0 = Date.now();
const control = soak(theirRoster, theirIds.slice(0, 6), theirIds.slice(6, 12), GAMES);
const settled = soak(theirRoster, theirIds.slice(0, 6), theirIds.slice(6, 12), SETTLED);
const block = soak(ourRoster, visitors, gang, GAMES);
const ms = Date.now() - t0;

// ── the report ──────────────────────────────────────────────────────────────
const row = (l, v) => console.log(`    ${d(String(l).padEnd(24))} ${v}`);
let broken = 0;
const against = (got, spec, { hard = true } = {}) => {
  const off = Math.abs(got - spec.target) > spec.tol;
  if (off && hard) broken += 1;
  const mark = off ? (hard ? red('OFF ') : yellow('----')) : green('OK  ');
  const shown = Number.isFinite(got) ? got.toFixed(1) : 'never';
  return `${mark} ${b(shown.padStart(5))}   ${d(`baseline ${spec.target} +-${spec.tol}`)}`;
};

console.log('');
console.log(b('  THREE SEWERS — RULES SOAK') + d(`   ${INNINGS} innings, CPU on both sides, ${ms}ms`));

console.log('');
console.log(b('  THE CONTROL') + d(`  their twelve kids, their split, our ported rules — ${GAMES} games, seeds 1..${GAMES}`));
console.log('    ' + d('scores: ') + control.scores.join(', '));
row(BASE.runs.label, against(control.runsPer, BASE.runs, { hard: false }));
row(BASE.hrs.label, against(control.hrsPer, BASE.hrs, { hard: false }));
row(BASE.windows.label, against(control.windowEvery, BASE.windows, { hard: false }));
console.log('    ' + d(`40 games is a noisy sample — a game runs 0 to 29 runs, so that mean carries about +-1.0`));
console.log('    ' + d(`settled over ${SETTLED} games:`));
row(BASE.runs.label, against(settled.runsPer, BASE.runs));
row(BASE.hrs.label, against(settled.hrsPer, BASE.hrs));
row(BASE.windows.label, against(settled.windowEvery, BASE.windows));

console.log('');
console.log(b('  THE BLOCK') + d(`  our sixteen, eight a side, picked the way captains pick — ${GAMES} games, seeds 1..${GAMES}`));
console.log('    ' + d('visitors  ') + visitors.map(nick).join(' · '));
console.log('    ' + d('the gang  ') + gang.map(nick).join(' · '));
console.log('    ' + d('scores: ') + block.scores.join(', '));
row(BASE.runs.label, against(block.runsPer, BASE.runs, { hard: false }));
row(BASE.hrs.label, against(block.hrsPer, BASE.hrs, { hard: false }));
row(BASE.windows.label, against(block.windowEvery, BASE.windows, { hard: false }));
row('runs, visitors to gang', `${(block.awayRuns / block.games).toFixed(1)} - ${(block.homeRuns / block.games).toFixed(1)}`
  + d(`   ${Math.round((block.close / block.games) * 100)}% of games inside three runs`));
row('sewer shots', `${block.hrs}  ${d(`one ${block.sewers[1]} · two ${block.sewers[2]} · three ${block.sewers[3]}`)}`);
row('windows smashed', `${block.windows}  ${d(`fire escapes ${block.fireEscapes} · flivver caroms ${block.flivvers} · CHEESE IT ${block.cheese}`)}`);
row('strikeouts / walks', `${block.ks} / ${block.walks}  ${d(`fouled off ${block.fouls}`)}`);
row('pitches thrown', `${block.pitches}  ${d(`${(block.pitches / block.games).toFixed(0)} a game, longest ${block.longest}`)}`);
row('sewer shots by', [...block.byKid.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
  .map(([id, n]) => `${nick(id)} ${n}`).join(' · '));

// The block scores lower than the control and that is a roster fact, not a rules
// fact — worth saying out loud every run so nobody "fixes" the rules over it.
const gap = settled.runsPer - block.runsPer;
if (Math.abs(gap) > 0.6) {
  console.log('');
  console.log('  ' + d(`the block scores ${gap.toFixed(1)} runs a game ${gap > 0 ? 'under' : 'over'} the control on the same rules.`));
  console.log('  ' + d('our sixteen are eight a side against their six, and our hitting is deliberately split —'));
  console.log('  ' + d('Tiny can only wallop, Rosie can only meet it — so the two halves of a hitter rarely'));
  console.log('  ' + d('arrive in the same kid. That costs runs and it buys characters. It is not a port bug.'));
}
if (block.runsPer < 6 || block.runsPer > 20) {
  broken += 1;
  console.log('  ' + red(`the block is at ${block.runsPer.toFixed(1)} runs a game, outside the sane band of 6 to 20`));
}

// The measurement the timing constants exist to protect (T.play, and PORT-SPEC).
const gaps = pressGaps();
console.log('');
console.log('  ' + d(`the hop is still a tell: ideal presses ${gaps.presses.map((t) => Math.round(t) + 'ms').join(' / ')}`
  + `, gaps ${gaps.gaps.map((t) => Math.round(t) + 'ms').join(' and ')}`
  + `, perfect window ${Math.round(gaps.perfectWindowMs)}ms wide.`));
console.log('  ' + d('A blind fixed rhythm cannot sit inside more than one of those. Do not close the gaps up.'));

const carried = Object.keys(QUIRK_HOLDER).length;
const total = Object.keys(QUIRKS).length - 1;      // 'none' is not a mechanic
if (carried < total) broken += 1;
console.log('  ' + d(`${carried} of ${total} quirks carried: `)
  + d(Object.entries(QUIRK_HOLDER).map(([q, id]) => `${q}=${nick(id)}`).join(' ')));

console.log('');
console.log(hangs === 0 && broken === 0 ? green(b('  SIM OK')) : red(b(`  SIM FAIL — ${hangs} hangs, ${broken} numbers out`)));
console.log('');
process.exit(hangs === 0 && broken === 0 ? 0 : 1);
