const { app } = globalThis.__SB;
const br = app.baserunning;
const out = { t: br.crew.now, runners: [] };
for (const r of br.crew.runners) {
  const k = r.kid;
  out.runners.push({
    who: r.id, st: r.st, v: +r.v.toFixed(2), slid: !!r.slid, headfirst: r.headfirst,
    roll: +(r.roll || 0).toFixed(3),
    clip: k && k.anim.cur && k.anim.cur.name, clipT: k && +k.anim.t.toFixed(3),
    lock: k && +k.lock.toFixed(2), state: k && k.state, kspeed: k && +k.speed.toFixed(2),
    groupY: k && +k.group.position.y.toFixed(2), rotz: k && +k.group.rotation.z.toFixed(2),
    lift: k && +k.rig.lift.toFixed(2),
  });
}
return out;
