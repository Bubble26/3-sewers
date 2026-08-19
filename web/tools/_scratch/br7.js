const { app } = globalThis.__SB;
const THREE = app.THREE;
const pl = app.get('players');
const out = [];
const box = new THREE.Box3();
const v = new THREE.Vector3();
for (const k of [pl.batter, ...pl.runners, ...pl.fielders]) {
  if (!k.group.visible) continue;
  k.group.updateWorldMatrix(true, true);
  box.setFromObject(k.group);
  if (box.isEmpty()) continue;
  const c = box.getCenter(new THREE.Vector3());
  const top = new THREE.Vector3(c.x, box.max.y, c.z).project(app.camera);
  const bot = new THREE.Vector3(c.x, box.min.y, c.z).project(app.camera);
  out.push({ name: k.name.split(' ')[0], id: k.home && k.home.id, wx: +k.pos.x.toFixed(1), wz: +k.pos.y.toFixed(1),
    sx: Math.round((top.x*0.5+0.5)*1600), sy: Math.round((-top.y*0.5+0.5)*900),
    hpx: Math.round(Math.abs(bot.y-top.y)*450), scale: +k.group.scale.x.toFixed(2) });
}
return out;
