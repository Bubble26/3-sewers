const { app } = globalThis.__SB;
const log = [];
for (let i = 0; i < 34; i++) {
  app.clock.advance(0.1);
  const f = app.fielding.debug;
  const b = app.baserunning.debug;
  log.push(`${(0.1*(i+1)).toFixed(2)} fp=${f.phase} call=${f.call||'-'} ball=${JSON.stringify(b.ballAt)} :: ` +
    b.runners.map(x=>`${x.who}/${x.body&&x.body.split(' ')[0]} ${x.st} ${x.at}->${x.to} ${x.tail} s=${x.s}/${x.len} v=${x.v} g=${x.gov} T=${x.touched}`).join(' || '));
}
return log.join('\n');
