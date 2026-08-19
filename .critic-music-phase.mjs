import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 300000 });
const out = await page.evaluate(async () => {
  const R = (cue, seconds) => globalThis.__SB.app.audio.renderOffline({ cue, seconds, sampleRate: 44100 });
  function flux(ch, sr) {
    const hop=Math.round(sr*0.002), win=Math.round(sr*0.012);
    const a=Math.exp(-2*Math.PI*1200/sr);
    const hp=new Float32Array(ch.length); let py=0,px=0;
    for(let i=0;i<ch.length;i++){const y=a*(py+ch[i]-px); hp[i]=y; py=y; px=ch[i];}
    const N=Math.floor((ch.length-win)/hop); const env=new Float32Array(N);
    for(let k=0;k<N;k++){let s=0;const o=k*hop;for(let i=0;i<win;i++){const v=hp[o+i];s+=v*v;}env[k]=Math.sqrt(s/win);}
    const d=new Float32Array(N);
    for(let k=1;k<N;k++) d[k]=Math.max(0, Math.log(env[k]+1e-7)-Math.log(env[k-1]+1e-7));
    return {d,hop,N,env};
  }
  const res={};
  for (const [cue,secs] of [['swing_probe',6.4],['swing_probe_straight',6.4],['title',26],['team_select',23],['bed_play',26],['between_innings',15],['bed_rally',12],['win',9],['stinger_sewer',6],['world_radio',15]]) {
    const b=await R(cue,secs), ch=b.getChannelData(0), sr=b.sampleRate;
    const {d,hop,N,env}=flux(ch,sr);
    const plan=globalThis.__SB.music.analysisPlan(cue);
    const beat=60/plan.bpm;
    // weighted phase histogram
    const B=32, bins=new Array(B).fill(0);
    let tot=0;
    for(let k=1;k<N;k++){ const t=k*hop/sr; const p=((t%beat)+beat)%beat/beat; bins[Math.min(B-1,Math.floor(p*B))]+=d[k]; tot+=d[k]; }
    const norm=bins.map(v=>+(v/(tot/B)).toFixed(2));
    // autocorrelation of flux for tempo
    const lagMin=Math.round(0.20/0.002), lagMax=Math.round(1.2/0.002);
    let bestLag=0,best=-1;
    for(let L=lagMin;L<lagMax;L++){ let s=0; for(let k=0;k<N-L;k++) s+=d[k]*d[k+L]; s/= (N-L); if(s>best){best=s;bestLag=L;} }
    // loop seam: rms in 60ms either side of the span boundary
    const span = plan.span || null;
    res[cue]={ planBpm:plan.bpm, planSwing:plan.swing, acfBpm:+(60/(bestLag*0.002)).toFixed(1),
      phaseHist: norm,
      onPeak: norm.indexOf(Math.max(...norm)),
      offHalf: norm.slice(12,20).map((v,i)=>[+((i+12+0.5)/B).toFixed(3),v]),
      fluxTotal:+tot.toFixed(1), meanEnv:+(env.reduce((a,c)=>a+c,0)/N).toFixed(5) };
  }
  // loop seam check
  const seam={};
  for (const [cue,span,secs] of [['team_select',11.429,23],['between_innings',14.694,29],['bed_play',25.6,51],['world_radio',14.545,29]]) {
    const b=await R(cue,secs), ch=b.getChannelData(0), sr=b.sampleRate;
    const rms=(a,z)=>{let s=0,n=0;for(let i=Math.round(a*sr);i<Math.min(ch.length,Math.round(z*sr));i++){s+=ch[i]*ch[i];n++;}return n?Math.sqrt(s/n):0;};
    const db=v=>+(20*Math.log10(v||1e-9)).toFixed(2);
    seam[cue]={ before: db(rms(span-0.30,span-0.02)), at: db(rms(span-0.02,span+0.10)), after: db(rms(span+0.10,span+0.40)),
      // is there a click? max sample-to-sample jump near the seam
      maxStep: +(()=>{let m=0;for(let i=Math.round((span-0.05)*sr);i<Math.round((span+0.05)*sr);i++){const j=Math.abs(ch[i]-ch[i-1]); if(j>m)m=j;}return m;})().toFixed(4),
      typicalStep: +(()=>{let m=0;for(let i=Math.round(1*sr);i<Math.round(3*sr);i++){const j=Math.abs(ch[i]-ch[i-1]); if(j>m)m=j;}return m;})().toFixed(4) };
  }
  return {res, seam};
});
console.log(JSON.stringify(out,null,1));
await browser.close(); srv.close();
