import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 300000 });

const out = await page.evaluate(async () => {
  const db = v => +(20*Math.log10(v||1e-9)).toFixed(2);
  const R = (cue, seconds) => globalThis.__SB.app.audio.renderOffline({ cue, seconds, sampleRate: 44100 });

  // --- high-band flux onset detector (brushes/banjo transients survive a dense mix)
  function onsets(ch, sr) {
    const hop = Math.round(sr*0.002), win = Math.round(sr*0.012);
    const N = Math.floor((ch.length-win)/hop);
    // one-pole highpass at ~1.5 kHz to kill sustained bass/reeds
    const a = Math.exp(-2*Math.PI*1500/sr);
    const hp = new Float32Array(ch.length); let z=0, py=0, px=0;
    for (let i=0;i<ch.length;i++){ const y = a*(py + ch[i] - px); hp[i]=y; py=y; px=ch[i]; }
    const env = new Float32Array(N);
    for (let k=0;k<N;k++){ let s=0; const o=k*hop; for(let i=0;i<win;i++){const v=hp[o+i]; s+=v*v;} env[k]=Math.sqrt(s/win); }
    const d = new Float32Array(N);
    for (let k=1;k<N;k++) d[k]=Math.max(0, Math.log(env[k]+1e-7)-Math.log(env[k-1]+1e-7));
    const W = Math.round(0.15/0.002);
    const res=[]; let last=-9;
    for (let k=2;k<N-1;k++){
      let m=0,c=0; for(let j=Math.max(0,k-W);j<Math.min(N,k+W);j++){m+=d[j];c++;} m/=c;
      if (d[k]>=d[k-1] && d[k]>d[k+1] && d[k] > m*1.6+0.18) { const t=k*hop/sr; if(t-last>0.045){res.push(t); last=t;} }
    }
    return res;
  }
  // fold onsets to the beat grid; report the histogram of phase within the beat
  function swingPhase(on, bpm) {
    const beat = 60/bpm;
    const bins = new Array(24).fill(0);
    for (const t of on) { const p = ((t % beat)+beat)%beat/beat; bins[Math.min(23,Math.floor(p*24))]++; }
    // the two strongest clusters
    const idx = bins.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]);
    return { bins, top: idx.slice(0,4).map(([v,i])=>({phase:+((i+0.5)/24).toFixed(3), n:v})) };
  }

  const res = { swing: {}, bands: {}, stings: [], levels: {} };
  for (const [cue, secs] of [['swing_probe',6.4],['swing_probe_straight',6.4],['bed_play',26],['title',26],['between_innings',15],['team_select',24],['bed_rally',13]]) {
    const b = await R(cue, secs); const ch = b.getChannelData(0);
    const plan = globalThis.__SB.music.analysisPlan(cue);
    const on = onsets(ch, b.sampleRate);
    const gaps = on.slice(1).map((t,i)=>t-on[i]).filter(g=>g>0.05).sort((a,b)=>a-b);
    res.swing[cue] = { bpmPlan: plan.bpm, swingPlan: plan.swing, nOnsets: on.length,
      medGap: gaps.length? +gaps[gaps.length>>1].toFixed(4):null,
      impliedBpmFromMedGap: gaps.length? +(60/gaps[gaps.length>>1]).toFixed(1):null,
      ...swingPhase(on, plan.bpm) };
  }
  // --- band-limiting of world_radio vs title
  function band(ch, sr, f1, f2) {
    const W=Math.min(32768, ch.length); const start=Math.max(0,Math.floor(ch.length/2-W/2));
    let tot=0, n=24;
    for(let k=0;k<n;k++){ const f=f1*Math.pow(f2/f1,k/(n-1)); const w=2*Math.PI*f/sr; let re=0,im=0;
      for(let i=0;i<W;i+=4){ const s=ch[start+i]*(0.5-0.5*Math.cos(2*Math.PI*i/W)); re+=s*Math.cos(w*i); im+=s*Math.sin(w*i);} tot+=Math.sqrt(re*re+im*im);}
    return tot/n;
  }
  for (const cue of ['title','world_radio']) {
    const b = await R(cue, 12); const ch=b.getChannelData(0), sr=b.sampleRate;
    const mid = band(ch,sr,400,3000);
    res.bands[cue] = {
      sub_40_150: +(20*Math.log10(band(ch,sr,40,150)/mid)).toFixed(1),
      low_150_400: +(20*Math.log10(band(ch,sr,150,400)/mid)).toFixed(1),
      hi_4k_9k: +(20*Math.log10(band(ch,sr,4000,9000)/mid)).toFixed(1),
      vhi_9k_16k: +(20*Math.log10(band(ch,sr,9000,16000)/mid)).toFixed(1),
    };
  }
  // --- stings, RMS over the SOUNDING span only (fair)
  for (const c of globalThis.__SB.music.listCues().filter(n=>n.startsWith('walkup_'))) {
    const b = await R(c, 6); const ch=b.getChannelData(0), sr=b.sampleRate;
    let peak=0; for(let i=0;i<ch.length;i++){const v=Math.abs(ch[i]); if(v>peak)peak=v;}
    const thr=peak*0.001; let f=0,l=0;
    for(let i=0;i<ch.length;i++) if(Math.abs(ch[i])>thr){f=i;break;}
    for(let i=ch.length-1;i>=0;i--) if(Math.abs(ch[i])>thr){l=i;break;}
    let s=0; for(let i=f;i<=l;i++) s+=ch[i]*ch[i];
    res.stings.push({ cue:c.replace('walkup_',''), spanS:+((l-f)/sr).toFixed(2), rmsSpanDb: db(Math.sqrt(s/Math.max(1,l-f))), peakDb: db(peak) });
  }
  // --- announcer vs music level, both through their own offline paths
  for (const c of ['dot_line','gooch_line','kid_yell','crack','crack_wallop']) {
    try { const b = await globalThis.__SB.app.audio.renderOffline({cue:c, seconds:3, sampleRate:44100});
      const ch=b.getChannelData(0); let p=0,s=0; for(let i=0;i<ch.length;i++){const v=Math.abs(ch[i]); if(v>p)p=v; s+=ch[i]*ch[i];}
      res.levels[c]={peakDb:db(p), rmsDb:db(Math.sqrt(s/ch.length))};
    } catch(e){ res.levels[c]='ERR '+e.message; }
  }
  return res;
});
console.log(JSON.stringify(out,null,1));
await browser.close(); srv.close();
