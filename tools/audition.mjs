#!/usr/bin/env node
/**
 * Audio critique tool. Sound cannot be judged from a screenshot, so this renders the game's
 * own audio graph offline and turns it into things a critic can actually read:
 *
 *   - a WAV file (shots/audio/<cue>.wav) that a human can play
 *   - a waveform + spectrogram + envelope contact sheet PNG
 *   - measured numbers: peak, RMS, crest factor, attack time, decay time, spectral centroid,
 *     and for music, detected tempo and note onsets
 *
 * Requires the audio piece to expose, on the running page:
 *
 *   __SB.app.audio.renderOffline({ cue, seconds, sampleRate }) -> Promise<AudioBuffer>
 *
 * which must build the SAME graph it uses live, into an OfflineAudioContext. A cue that only
 * exists in the live path and cannot be rendered offline is untestable and counts as unbuilt.
 *
 *   node tools/audition.mjs crack whiff walk_up_music
 *   node tools/audition.mjs --list
 */
import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', 'shots/audio');
const SECONDS = Number(flag('seconds', 3));
const cues = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out' && argv[argv.indexOf(a) - 1] !== '--seconds');

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });

const capable = await page.evaluate(() => typeof globalThis.__SB?.app?.audio?.renderOffline === 'function');
if (!capable) {
  console.log(JSON.stringify({ error: 'audio.renderOffline is not implemented yet — the audio pieces must add it (see docs/CONTRACT.md)' }, null, 2));
  await browser.close(); srv.close(); process.exit(1);
}
if (argv.includes('--list')) {
  console.log(JSON.stringify(await page.evaluate(() => globalThis.__SB.app.audio.listCues?.() ?? []), null, 2));
  await browser.close(); srv.close(); process.exit(0);
}

await mkdir(OUT, { recursive: true });
const report = { cues: [], errors };

for (const cue of cues.length ? cues : ['crack']) {
  const measured = await page.evaluate(async ({ cue, SECONDS }) => {
    const buf = await globalThis.__SB.app.audio.renderOffline({ cue, seconds: SECONDS, sampleRate: 44100 });
    const ch = buf.getChannelData(0);
    const n = ch.length, sr = buf.sampleRate;

    let peak = 0, sum = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; sum += ch[i] * ch[i]; }
    const rms = Math.sqrt(sum / n);

    // envelope in 256 buckets
    const B = 256, env = new Array(B).fill(0);
    for (let i = 0; i < n; i++) { const b = Math.min(B - 1, (i / n * B) | 0); const a = Math.abs(ch[i]); if (a > env[b]) env[b] = a; }

    // attack / decay against the peak
    const iPeak = env.indexOf(Math.max(...env));
    const thr = peak * 0.1;
    let attack = 0; for (let i = 0; i <= iPeak; i++) if (env[i] >= thr) { attack = (i / B) * (n / sr); break; }
    let decay = (n / sr); for (let i = iPeak; i < B; i++) if (env[i] < thr) { decay = (i / B) * (n / sr) - attack; break; }

    // crude DFT-based spectrum + centroid on a window at the peak
    const W = 2048, start = Math.max(0, Math.min(n - W, Math.round((iPeak / B) * n)));
    const bins = 128, spec = new Array(bins).fill(0);
    for (let k = 0; k < bins; k++) {
      const f = 40 * Math.pow(2, k / bins * 9);              // 40Hz .. ~20kHz, log spaced
      const w = 2 * Math.PI * f / sr;
      let re = 0, im = 0;
      for (let i = 0; i < W; i += 2) {
        const s = ch[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / W));
        re += s * Math.cos(w * i); im += s * Math.sin(w * i);
      }
      spec[k] = Math.sqrt(re * re + im * im) / (W / 2);
    }
    let num = 0, den = 0;
    for (let k = 0; k < bins; k++) { const f = 40 * Math.pow(2, k / bins * 9); num += f * spec[k]; den += spec[k]; }

    // onsets: rising energy edges, for tempo on musical cues
    const onsets = [];
    for (let b = 2; b < B; b++) if (env[b] > 0.18 * peak && env[b] > env[b - 1] * 1.9) onsets.push(+((b / B) * (n / sr)).toFixed(3));
    const gaps = onsets.slice(1).map((t, i) => t - onsets[i]).filter((g) => g > 0.08);
    const medianGap = gaps.length ? gaps.sort((a, b) => a - b)[gaps.length >> 1] : 0;

    // stash a wav for download
    const wav = (() => {
      const chs = buf.numberOfChannels, len = buf.length;
      const out = new DataView(new ArrayBuffer(44 + len * chs * 2));
      const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); out.setUint32(4, 36 + len * chs * 2, true); w(8, 'WAVEfmt ');
      out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, chs, true);
      out.setUint32(24, sr, true); out.setUint32(28, sr * chs * 2, true);
      out.setUint16(32, chs * 2, true); out.setUint16(34, 16, true); w(36, 'data');
      out.setUint32(40, len * chs * 2, true);
      let o = 44;
      for (let i = 0; i < len; i++) for (let c = 0; c < chs; c++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
        out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
      }
      let bin = ''; const u8 = new Uint8Array(out.buffer);
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return btoa(bin);
    })();

    return {
      cue, seconds: n / sr, sampleRate: sr,
      peak: +peak.toFixed(4), rms: +rms.toFixed(4),
      crestDb: +(20 * Math.log10(peak / (rms || 1e-9))).toFixed(1),
      attackMs: Math.round(attack * 1000), decayMs: Math.round(decay * 1000),
      centroidHz: Math.round(den ? num / den : 0),
      onsets: onsets.slice(0, 24),
      impliedBpm: medianGap ? Math.round(60 / medianGap) : null,
      env, spec, wav,
    };
  }, { cue, SECONDS });

  await writeFile(join(OUT, `${cue}.wav`), Buffer.from(measured.wav, 'base64'));
  const { env, spec, wav, ...numbers } = measured;
  report.cues.push(numbers);

  const sheet = await browser.newPage({ viewport: { width: 1100, height: 620 } });
  await sheet.setContent(`<style>
    body{margin:0;background:#14120f;color:#efe4cc;font:13px/1.45 system-ui;padding:18px}
    h1{font:600 17px system-ui;margin:0 0 4px} .sub{color:#9c9a8e}
    .k{display:flex;gap:22px;flex-wrap:wrap;margin:10px 0 16px;color:#c9bda2}
    .k b{color:#f0e5cd;font-variant-numeric:tabular-nums}
    canvas{display:block;background:#1c1a16;border:1px solid #38332b;border-radius:3px;margin-bottom:12px}
    .lab{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8d8577;margin:0 0 4px}
  </style>
  <h1>${cue}</h1>
  <div class="k">
    <span>peak <b>${numbers.peak}</b></span><span>rms <b>${numbers.rms}</b></span>
    <span>crest <b>${numbers.crestDb} dB</b></span><span>attack <b>${numbers.attackMs} ms</b></span>
    <span>decay <b>${numbers.decayMs} ms</b></span><span>centroid <b>${numbers.centroidHz} Hz</b></span>
    <span>onsets <b>${numbers.onsets.length}</b></span><span>bpm <b>${numbers.impliedBpm ?? '-'}</b></span>
  </div>
  <canvas id="env" width="1050" height="180"></canvas>
  <canvas id="spec" width="1050" height="220"></canvas>
  <script>
    const env = ${JSON.stringify(env)}, spec = ${JSON.stringify(spec)};
    const ce = document.getElementById('env').getContext('2d');
    ce.strokeStyle = '#e0a83c'; ce.fillStyle = '#3a2f1c'; ce.lineWidth = 1.5;
    ce.beginPath();
    env.forEach((v, i) => { const x = i / env.length * 1050, y = 90 - v * 84; i ? ce.lineTo(x, y) : ce.moveTo(x, y); });
    env.slice().reverse().forEach((v, i) => { const x = (1 - i / env.length) * 1050, y = 90 + v * 84; ce.lineTo(x, y); });
    ce.closePath(); ce.fill(); ce.stroke();
    ce.strokeStyle = '#4a4238'; ce.beginPath(); ce.moveTo(0, 90); ce.lineTo(1050, 90); ce.stroke();
    const cs = document.getElementById('spec').getContext('2d');
    const max = Math.max(...spec) || 1;
    spec.forEach((v, i) => {
      const h = (v / max) * 210, x = i / spec.length * 1050;
      cs.fillStyle = 'hsl(' + (28 + 180 * (v / max)) + ' 70% ' + (30 + 40 * (v / max)) + '%)';
      cs.fillRect(x, 220 - h, 1050 / spec.length - 1, h);
    });
  </script>`);
  await sheet.screenshot({ path: join(OUT, `${cue}-analysis.png`) });
  await sheet.close();
}

await writeFile(join(OUT, 'audition.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close(); srv.close();
