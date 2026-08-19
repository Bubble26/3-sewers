const { app } = globalThis.__SB;
const log = [];
for (let i = 0; i < 26; i++) {
  app.clock.advance(1/30);
  const f = app.fielding.debug;
  const b = app.baserunning.debug;
  log.push(`t=${b.t} fp=${f.phase} call=${f.call||'-'} ball=${JSON.stringify(b.ballAt)} :: ` +
    b.runners.map(x=>`${x.who} ${x.st} ${x.at}->${x.to}/${x.tail} s=${x.s}/${x.len} v=${x.v} g=${x.gov} T=${x.touched}`).join(' || '));
}
return log.join('\n');
