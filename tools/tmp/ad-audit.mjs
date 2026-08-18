// Frame audit: block map of L*, worst blocks, hue count, saturation area, chalk/ink usage.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
for (const f of process.argv.slice(2)) {
  const b64 = (await readFile(f)).toString('base64');
  const out = await page.evaluate(async (d) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + d; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const W = c.width, H = c.height;
    const px = g.getImageData(0, 0, W, H).data;
    const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const Yof = (r,gg,b) => 0.2126*s2l(r/255)+0.7152*s2l(gg/255)+0.0722*s2l(b/255);
    const Lof = (r,gg,b) => { const y=Yof(r,gg,b); const f=y>0.008856?Math.cbrt(y):7.787*y+16/116; return 116*f-16; };
    const HSL = (r,gg,b) => { r/=255;gg/=255;b/=255; const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b),dd=mx-mn; let h=0;
      if(dd>1e-6){ if(mx===r)h=((gg-b)/dd+(gg<b?6:0)); else if(mx===gg)h=(b-r)/dd+2; else h=(r-gg)/dd+4; h*=60;}
      const l=(mx+mn)/2; const s=dd<1e-6?0:dd/(1-Math.abs(2*l-1)); return [h,s,l]; };
    // 64x64 block medians
    const blocks = [];
    for (let by=0; by+64<=H; by+=64) for (let bx=0; bx+64<=W; bx+=64) {
      const vals=[];
      for(let y=by;y<by+64;y+=2) for(let x=bx;x<bx+64;x+=2){const i=(y*W+x)*4; vals.push(Lof(px[i],px[i+1],px[i+2]));}
      vals.sort((a,b2)=>a-b2);
      blocks.push({x:bx,y:by,L:vals[vals.length>>1]});
    }
    blocks.sort((a,b2)=>a.L-b2.L);
    const dark = blocks.slice(0,6).map(b2=>`(${b2.x},${b2.y})L${b2.L.toFixed(1)}`);
    const bright = blocks.slice(-4).map(b2=>`(${b2.x},${b2.y})L${b2.L.toFixed(1)}`);
    // hue histogram over pixels with S>=0.18 and area
    const hb = new Array(18).fill(0); let n=0, satArea=0, hiSatArea=0, chalkArea=0, inkArea=0;
    for (let i=0;i<px.length;i+=4){
      const [h,s] = HSL(px[i],px[i+1],px[i+2]);
      const L = Lof(px[i],px[i+1],px[i+2]);
      n++;
      if (s>=0.18) { hb[Math.floor(h/20)%18]++; satArea++; }
      if (s>=0.45) hiSatArea++;
      if (L>89) chalkArea++;
      if (L<20) inkArea++;
    }
    const hues = hb.map((v,i)=>[i*20, +(100*v/n).toFixed(2)]).filter(([,p])=>p>=1.0);
    return { dark, bright, hues, satPct:+(100*satArea/n).toFixed(1), hiSatPct:+(100*hiSatArea/n).toFixed(2),
      chalkPct:+(100*chalkArea/n).toFixed(2), inkPct:+(100*inkArea/n).toFixed(2), nHues: hues.length };
  }, b64);
  console.log('==', f);
  console.log(' darkest64:', out.dark.join(' '));
  console.log(' brightest64:', out.bright.join(' '));
  console.log(' hues>=1%:', out.nHues, JSON.stringify(out.hues));
  console.log(' S>=0.18 area', out.satPct+'%', ' S>=0.45 area', out.hiSatPct+'%', ' L*>89', out.chalkPct+'%', ' L*<20', out.inkPct+'%');
}
await browser.close();
