const { app } = globalThis.__SB;
const log = [];
for (let i = 0; i < 40; i++) {
  app.clock.advance(0.1);
  const f = app.fielding.debug;
  const b = app.baserunning.debug;
  log.push({ t: +(0.1*(i+1)).toFixed(2), fp: f.phase, prompt: !!f.prompt, call: f.call,
    r: b.runners.map(x=>`${x.who}:${x.st}:${x.at}->${x.to}:s${x.s}/${x.len}`).join(' | ') });
}
return log;
