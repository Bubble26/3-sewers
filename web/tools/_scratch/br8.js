const { app } = globalThis.__SB;
const THREE = app.THREE;
const out = {};
app.scene.traverse((o) => {
  if (o.name === 'run_lane' || o.name === 'run_dust') {
    const m = new THREE.Matrix4(); const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const sc = new THREE.Vector3();
    const rows = [];
    for (let i = 0; i < Math.min(6, o.count); i++) {
      o.getMatrixAt(i, m); m.decompose(p, q, sc);
      const c = new THREE.Color(); if (o.instanceColor) o.getColorAt(i, c);
      rows.push({ p: [ +p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1) ], s: [ +sc.x.toFixed(2), +sc.y.toFixed(2), +sc.z.toFixed(2) ], c: c.getHexString() });
    }
    out[o.name] = { count: o.count, visible: o.visible, frustum: o.frustumCulled, hasColor: !!o.instanceColor, mat: { transparent: o.material.transparent, alphaTest: o.material.alphaTest, depthWrite: o.material.depthWrite, ro: o.renderOrder }, rows };
  }
  if (o.name === 'live_bag' && o.visible) out.liveBag = { op: +o.material.opacity.toFixed(2), pos: [o.position.x, +o.position.y.toFixed(2), o.position.z] };
});
const sm = [];
app.scene.traverse((o)=>{ if (o.isMesh && o.material && o.material.map && o.visible && o.geometry.type==='PlaneGeometry' && o.material.opacity>0 && o.material.opacity<1 && !o.name) sm.push(o.position.toArray().map(n=>+n.toFixed(1))); });
out.br = app.baserunning.debug.runners.map(r=>({who:r.who, st:r.st, s:r.s, len:r.len, bag:r.to}));
return out;
