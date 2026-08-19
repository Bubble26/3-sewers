const A = globalThis.__SB.app, THREE = A.THREE;
const cam = A.get('cameras');
const out = {};
const pts = {
  n_a: [30.9, 13.2, 20], n_b: [30.9, 13.2, 30], n_c: [30.9, 16.5, 26],
  s_a: [-30.9, 13.2, 30], s_b: [-30.9, 13.2, 45], s_c: [-30.9, 16.5, 38],
  n_d: [26.0, 13.2, 24], s_d: [-26.0, 13.2, 34],
};
for (const which of ['batting','field']) {
  cam.pin = which; cam.cut(which, true); A.clock.render();
  const o = {};
  for (const [k,v] of Object.entries(pts)) {
    const n = new THREE.Vector3(...v).project(A.camera);
    o[k] = [Math.round((n.x+1)/2*1600), Math.round((1-n.y)/2*900)];
  }
  out[which] = o;
}
cam.pin = null;
return out;
