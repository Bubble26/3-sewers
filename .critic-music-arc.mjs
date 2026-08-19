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
  const db=v=>+(20*Math.log10(v||1e-9)).toFixed(1);
  const res={};
  for (const [cue,secs] of [['title',26],['win',9],['bed_play',26],['between_innings',15],['loss',8],['team_select',23]]) {
    const b=await R(cue,secs), ch=b.getChannelData(0), sr=b.sampleRate;
    const step=0.15, arc=[];
    for(let t=0;t<secs-step;t+=step){ let s=0,n=0; for(let i=Math.round(t*sr);i<Math.round((t+step)*sr);i++){s+=ch[i]*ch[i];n++;} arc.push(db(Math.sqrt(s/n))); }
    const mx=Math.max(...arc), mn=Math.min(...arc.filter(v=>v>-90));
    // beat-level articulation: within each 0.6 s window, (peak env - trough env)
    const contrasts=[];
    const win=Math.round(0.02*sr);
    const envN=Math.floor(ch.length/win); const env=[];
    for(let k=0;k<envN;k++){let s=0;for(let i=0;i<win;i++){const v=ch[k*win+i];s+=v*v;} env.push(Math.sqrt(s/win));}
    const per=Math.round(0.6/0.02);
    for(let k=0;k+per<envN;k+=per){ const w=env.slice(k,k+per).filter(v=>v>1e-6); if(w.length<per*0.8) continue; contrasts.push(db(Math.max(...w))-db(Math.min(...w))); }
    contrasts.sort((a,b)=>a-b);
    res[cue]={ arcRangeDb:+(mx-mn).toFixed(1), loudest:mx, quietest:mn,
      medianBeatContrastDb: contrasts.length? +contrasts[contrasts.length>>1].toFixed(1):null,
      arc: arc };
  }
  return res;
});
console.log(JSON.stringify(out));
await browser.close(); srv.close();
