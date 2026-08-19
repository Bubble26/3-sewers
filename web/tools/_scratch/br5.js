const { app } = globalThis.__SB;
const core = app.sim.core;
const side = core.battingSide();
const out = { side, order: core.lineups[side].map((id,i)=>({ i, id, name: core.kidName(id), SPD: core.stat(id,'SPD'), quirk: core.quirkOf(id) })) };
out.other = core.lineups[1-side].map((id,i)=>({ i, id, name: core.kidName(id), SPD: core.stat(id,'SPD'), quirk: core.quirkOf(id) }));
return out;
