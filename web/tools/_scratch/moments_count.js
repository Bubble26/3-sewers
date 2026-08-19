const SB = globalThis.__SB;
const sim = SB.sim, bus = SB.app.bus;
const counts = {};
const off = bus.on('*', (evt) => { counts[evt] = (counts[evt]||0)+1; });
const out = [];
for (const seed of [1920, 1927, 1934]) {
  for (const k of Object.keys(counts)) delete counts[k];
  SB.reset(seed);
  const step = 1/60; let t = 0, guard = 0;
  while (sim.state.phase !== 'over' && t < 900 && guard++ < 900*60) {
    if (sim.state.phase === 'pitch' && sim.swingAt < 0) {
      const tt = sim.timeToPlate ?? 0.9;
      if (sim.pitchT >= tt * (0.86 + 0.28*((guard%7)/7))) sim.swing();
    }
    SB.advance(step); t += step;
  }
  const m = {};
  for (const k of Object.keys(counts)) if (k.startsWith('moment:') || k.startsWith('street:')) m[k] = counts[k];
  out.push({ seed, seconds: Math.round(t), score: {...sim.state.score}, moments: m,
             ball: { roof: counts['ball:roof']||0, sewer: counts['ball:sewer']||0, ashcan: counts['ball:ashcan']||0,
                     window: counts['ball:window']||0, fire_escape: counts['ball:fire_escape']||0, fender: counts['ball:fender']||0 },
             street: SB.app.street.report(), faults: SB.app.moments.faults.slice(0,6), errors: SB.errors.slice(0,4) });
}
off();
return out;
