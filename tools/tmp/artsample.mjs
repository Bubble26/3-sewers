import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
// name:x:y:w:h
const REGIONS = [['sky',760,110,60,40],['upper-brick-L',60,40,60,40],['road-crown',800,700,64,64],['road-mid',700,520,64,64],
  ['awning-red',1400,370,40,20],['kid-shirt',800,700,20,20],['far-haze',790,330,40,20],['brick-right',1500,120,50,40],['sidewalk-L',120,560,40,30]];
for (const f of process.argv.slice(2)) {
  const b64 = (await readFile(f)).toString('base64');
  const out = await page.evaluate(async ([d, regions]) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + d; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const s2l = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const Lof = (r, gg, b) => { const y = 0.2126*s2l(r/255)+0.7152*s2l(gg/255)+0.0722*s2l(b/255); const f2 = y>0.008856?Math.cbrt(y):7.787*y+16/116; return 116*f2-16; };
    return regions.map(([n, x, y, w, h]) => {
      const px = g.getImageData(x, y, w, h).data;
      let r=0,gg=0,b=0,k=0;
      for (let i=0;i<px.length;i+=4){r+=px[i];gg+=px[i+1];b+=px[i+2];k++;}
      r/=k;gg/=k;b/=k;
      const hex = '#'+[r,gg,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
      const mx=Math.max(r,gg,b)/255,mn=Math.min(r,gg,b)/255,l=(mx+mn)/2;
      const S = (mx-mn)<1e-6?0:(mx-mn)/(1-Math.abs(2*l-1));
      return `${n} ${hex} L*${Lof(r,gg,b).toFixed(1)} S${S.toFixed(2)}`;
    });
  }, [b64, REGIONS]);
  console.log('==', f); console.log(out.join('\n'));
}
await browser.close();
