import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errs=[]; page.on('pageerror', e=>errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 300000 });

await page.evaluate(() => {
  // shared analysis helpers installed once
  globalThis.__AN = {
    rmsWin(ch, sr, a, b) { let s=0,n=0; for(let i=Math.round(a*sr);i<Math.min(ch.length,Math.round(b*sr));i++){s+=ch[i]*ch[i];n++;} return n?Math.sqrt(s/n):0; },
    // 1ms-hop energy envelope, then a spectral-flux-ish onset detector
    onsets(ch, sr, opts={}) {
      const hop = Math.round(sr*0.002); // 2ms
      const win = Math.round(sr*0.010);
      const N = Math.floor((ch.length-win)/hop);
      const env = new Float32Array(N);
      for (let k=0;k<N;k++){ let s=0; const o=k*hop; for(let i=0;i<win;i++){const v=ch[o+i]; s+=v*v;} env[k]=Math.sqrt(s/win); }
      // log-domain positive difference
      const d = new Float32Array(N);
      for (let k=1;k<N;k++){ const a=Math.log(env[k]+1e-6), b=Math.log(env[k-1]+1e-6); d[k]=Math.max(0,a-b); }
      // adaptive threshold: local mean + delta
      const W = Math.round(0.12/0.002);
      const out=[];
      let last=-1e9;
      const thr = opts.thr ?? 0.55;
      for (let k=2;k<N-1;k++){
        let m=0,c=0; for(let j=Math.max(0,k-W);j<Math.min(N,k+W);j++){m+=d[j];c++;}
        m/=c;
        if (d[k]>d[k-1] && d[k]>=d[k+1] && d[k] > m*2.0 + thr && env[k] > (opts.floor??0.004)) {
          const t=k*hop/sr;
          if (t-last > (opts.minGap??0.035)) { out.push(+t.toFixed(4)); last=t; }
        }
      }
      return out;
    },
    // energy in a frequency band via goertzel-ish band sum on an FFT-free DFT
    bandEnergy(ch, sr, f1, f2, nbins=48) {
      const W=Math.min(16384, ch.length);
      const start=Math.max(0,Math.floor(ch.length/2 - W/2));
      let tot=0;
      for(let k=0;k<nbins;k++){
        const f=f1*Math.pow(f2/f1,k/(nbins-1));
        const w=2*Math.PI*f/sr; let re=0,im=0;
        for(let i=0;i<W;i+=4){ const s=ch[start+i]*(0.5-0.5*Math.cos(2*Math.PI*i/W)); re+=s*Math.cos(w*i); im+=s*Math.sin(w*i); }
        tot+=Math.sqrt(re*re+im*im)/(W/8);
      }
      return tot/nbins;
    },
    centroid(ch, sr) {
      const W=Math.min(16384,ch.length); const start=Math.max(0,Math.floor(ch.length/2-W/2));
      let num=0,den=0;
      for(let k=0;k<96;k++){
        const f=40*Math.pow(2,k/96*9); const w=2*Math.PI*f/sr; let re=0,im=0;
        for(let i=0;i<W;i+=4){ const s=ch[start+i]*(0.5-0.5*Math.cos(2*Math.PI*i/W)); re+=s*Math.cos(w*i); im+=s*Math.sin(w*i); }
        const m=Math.sqrt(re*re+im*im); num+=f*m; den+=m;
      }
      return den?Math.round(num/den):0;
    },
  };
});

async function render(cue, seconds) {
  return page.evaluate(async ({cue,seconds}) => {
    const buf = await globalThis.__SB.app.audio.renderOffline({ cue, seconds, sampleRate: 44100 });
    const ch = buf.getChannelData(0);
    const A = globalThis.__AN;
    let peak=0,sum=0; for(let i=0;i<ch.length;i++){const a=Math.abs(ch[i]); if(a>peak)peak=a; sum+=ch[i]*ch[i];}
    const rms=Math.sqrt(sum/ch.length);
    const on = A.onsets(ch, buf.sampleRate);
    const gaps = on.slice(1).map((t,i)=>t-on[i]);
    const sorted = gaps.slice().sort((a,b)=>a-b);
    return {
      cue, seconds: buf.length/buf.sampleRate,
      peak:+peak.toFixed(4), rms:+rms.toFixed(5),
      rmsDb:+(20*Math.log10(rms||1e-9)).toFixed(2),
      crestDb:+(20*Math.log10(peak/(rms||1e-9))).toFixed(1),
      centroid: A.centroid(ch, buf.sampleRate),
      nOnsets: on.length,
      onsets: on.slice(0,40),
      medGap: sorted.length? +sorted[sorted.length>>1].toFixed(4):null,
    };
  }, {cue, seconds});
}

const musicCues = await page.evaluate(() => globalThis.__SB.music ? globalThis.__SB.music.cues?.() ?? Object.keys(globalThis.__SB.music.list?.()??{}) : null).catch(()=>null);
console.log('__SB.music keys:', JSON.stringify(await page.evaluate(()=>globalThis.__SB.music?Object.keys(globalThis.__SB.music):null)));

const list = ['title','team_select','bed_play','bed_tension','bed_rally','stinger_hit','stinger_sewer','between_innings','win','loss','world_radio','swing_probe','swing_probe_straight','duck_proof','duck_proof_flat'];
const rows=[];
for (const c of list) {
  const secs = { title:26, team_select:24, bed_play:26, bed_tension:13, bed_rally:13, stinger_hit:3, stinger_sewer:6, between_innings:15, win:9, loss:8, world_radio:15, swing_probe:6.4, swing_probe_straight:6.4, duck_proof:7, duck_proof_flat:7 }[c] ?? 6;
  try { rows.push(await render(c, secs)); } catch(e){ rows.push({cue:c, err:e.message}); }
}
console.log(JSON.stringify(rows,null,1));
console.log('PAGEERRORS', JSON.stringify(errs));
await browser.close(); srv.close();
