const { app } = globalThis.__SB;
const pl = app.get('players');
const out = [];
for (const k of pl.runners) {
  let meshes = 0, vis = 0;
  k.group.traverse((o) => { if (o.isMesh) { meshes++; if (o.visible) vis++; } });
  out.push({ name: k.name, gv: k.group.visible, pos: k.group.position.toArray().map(n=>+n.toFixed(2)),
    scale: k.group.scale.toArray().map(n=>+n.toFixed(2)), meshes, vis,
    onBase: k.onBase, lock: +k.lock.toFixed(2), state: k.state,
    parent: k.group.parent && k.group.parent.type, inScene: !!k.group.parent });
}
out.push({ batter: pl.batter.group.visible, bp: pl.batter.group.position.toArray().map(n=>+n.toFixed(1)) });
return out;
