import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args:['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport:{width:800,height:600} });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`,{waitUntil:'commit',timeout:60000});
await page.waitForFunction(()=>globalThis.__SB?.ready,null,{timeout:300000});
const out = await page.evaluate(async () => {
  const db=v=>+(20*Math.log10(v||1e-9)).toFixed(2);
  const go=async(cue,secs,wins)=>{
    const b=await globalThis.__SB.app.audio.renderOffline({cue,seconds:secs,sampleRate:44100});
    const ch=b.getChannelData(0),sr=b.sampleRate;
    const rms=(a,z)=>{let s=0,n=0;for(let i=Math.round(a*sr);i<Math.min(ch.length,Math.round(z*sr));i++){s+=ch[i]*ch[i];n++;}return n?Math.sqrt(s/n):0;};
    const r={}; for(const [k,[a,z]] of Object.entries(wins)) r[k]=db(rms(a,z)); return r;
  };
  // title: bpm184 -> bar 1.30435s ; body starts at t1 = 2*bar = 2.6087
  const bar=4*60/184, t1=2*bar;
  const T={};
  for(let i=0;i<16;i++) T['bar'+(i+1)]=[t1+i*bar+0.02, t1+(i+1)*bar-0.02];
  const title=await go('title',26,T);
  // win: bpm176 -> bar = 4*60/176 = 1.3636
  const wb=4*60/176, W={};
  for(let i=0;i<6;i++) W['bar'+(i+1)]=[i*wb+0.02,(i+1)*wb-0.02];
  const win=await go('win',9,W);
  // between_innings bar 8 break: bpm196 -> bar=1.2245
  const bb=4*60/196, B={};
  for(let i=0;i<12;i++) B['bar'+(i+1)]=[i*bb+0.02,(i+1)*bb-0.02];
  const bi=await go('between_innings',15,B);
  return {title,win,between_innings:bi};
});
console.log(JSON.stringify(out,null,1));
await browser.close(); srv.close();
