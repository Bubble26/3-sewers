import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 300000 });

const out = await page.evaluate(async () => {
  const R = async (cue, seconds) => {
    const b = await globalThis.__SB.app.audio.renderOffline({ cue, seconds, sampleRate: 44100 });
    return b;
  };
  const rms = (ch, sr, a, bnd) => { let s=0,n=0; for(let i=Math.round(a*sr);i<Math.min(ch.length,Math.round(bnd*sr));i++){s+=ch[i]*ch[i];n++;} return n?Math.sqrt(s/n):0; };
  const db = v => +(20*Math.log10(v||1e-9)).toFixed(2);

  const A = await R('duck_proof', 7), B = await R('duck_proof_flat', 7);
  const ca = A.getChannelData(0), cb = B.getChannelData(0), sr = A.sampleRate;
  const win = globalThis.__SB.music.duckWindows('duck_proof');
  const res = {};
  for (const [k,[a,b]] of Object.entries(win)) {
    res[k] = { ducked: db(rms(ca,sr,a,b)), flat: db(rms(cb,sr,a,b)), deltaDb: +(db(rms(ca,sr,a,b))-db(rms(cb,sr,a,b))).toFixed(2) };
  }
  // per-50ms trace of the ratio so I can see the shape of the duck myself
  const trace = [];
  for (let t=0;t<7;t+=0.05) {
    const d=rms(ca,sr,t,t+0.05), f=rms(cb,sr,t,t+0.05);
    trace.push([+t.toFixed(2), +(db(d)-db(f)).toFixed(1)]);
  }
  // sample identity check: is the arrangement really bit-identical outside the ducks?
  let maxDiffEarly=0; for(let i=0;i<Math.round(1.5*sr);i++) maxDiffEarly=Math.max(maxDiffEarly,Math.abs(ca[i]-cb[i]));

  // walk-up stings
  const cues = globalThis.__SB.music.listCues().filter(n=>n.startsWith('walkup_'));
  const stings=[];
  for (const c of cues) {
    const bb = await R(c, 6); const ch = bb.getChannelData(0);
    let peak=0,s=0; for(let i=0;i<ch.length;i++){const v=Math.abs(ch[i]); if(v>peak)peak=v; s+=ch[i]*ch[i];}
    // find the sounding span (first/last sample above -60dBFS of peak)
    let first=0,last=0; const thr=peak*0.001;
    for(let i=0;i<ch.length;i++) if(Math.abs(ch[i])>thr){first=i;break;}
    for(let i=ch.length-1;i>=0;i--) if(Math.abs(ch[i])>thr){last=i;break;}
    const cen = globalThis.__AN ? 0 : 0;
    stings.push({ cue:c, peak:+peak.toFixed(3), rmsDb: db(Math.sqrt(s/ch.length)),
      startS:+(first/sr).toFixed(2), lenS:+((last-first)/sr).toFixed(2) });
  }
  // validate()
  const problems = globalThis.__SB.music.validate();
  return { duck: res, trace, maxDiffEarly:+maxDiffEarly.toFixed(6), stings, problems, cueCount: globalThis.__SB.music.listCues().length };
});
console.log(JSON.stringify(out,null,1));
await browser.close(); srv.close();
