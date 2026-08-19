const A = globalThis.__SB.app, THREE = A.THREE;
const cam = A.get('cameras');
const pts = {};
for (const z of [16, 24, 32, 40, 48, 56]) {
  pts['S'+z] = [-30.9, 13.2, z];
  pts['N'+z] = [30.9, 13.2, z];
}
const out = {};
for (const which of ['batting','field']) {
  cam.pin = which; cam.cut(which, true); A.clock.render();
  const o = {};
  for (const [k,v] of Object.entries(pts)) {
    const n = new THREE.Vector3(...v).project(A.camera);
    o[k] = Math.round((n.x+1)/2*1600) + ',' + Math.round((1-n.y)/2*900);
  }
  out[which] = o;
}
cam.pin = null;
return out;
