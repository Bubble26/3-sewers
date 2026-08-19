const A = globalThis.__SB.app, THREE = A.THREE;
const w = A.moments.woman;
const p = w.mesh.position.clone();
const n = p.clone().project(A.camera);
return { visible: w.mesh.visible, t: w.t, pos: p.toArray(), ndc: [n.x.toFixed(2), n.y.toFixed(2), n.z.toFixed(2)],
         screen: [Math.round((n.x+1)/2*1600), Math.round((1-n.y)/2*900)], framing: A.get('cameras').framing,
         fired: A.moments.fired };
