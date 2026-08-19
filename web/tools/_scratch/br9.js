const { app } = globalThis.__SB;
const pl = app.get('players');
const k = pl.batter;
const br = app.baserunning.debug.runners[0];
return {
  name: k.name, pos: [ +k.pos.x.toFixed(1), +k.pos.y.toFixed(1) ], vis: k.group.visible,
  speed: +k.speed.toFixed(2), maxSpeed: k.maxSpeed, lock: +k.lock.toFixed(3), state: k.state,
  target: k.target ? [k.target.x, k.target.y] : null, glide: +k.glide.toFixed(2),
  clip: k.anim.clip && k.anim.clip.name, t: +(k.anim.t||0).toFixed(3), prev: k.anim.prev && k.anim.prev.name,
  face: +k.face.toFixed(2), faceGoal: +k.faceGoal.toFixed(2), runDist: +k.runDist.toFixed(2),
  layers: (k.anim.layers||[]).map(l=>l && l.name),
  br,
};
