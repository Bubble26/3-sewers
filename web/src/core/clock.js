// Fixed-timestep loop with deterministic stepping for the screenshot harness.
export class Clock {
  constructor(update, render, hz = 60) {
    this.update = update; this.render = render;
    this.dt = 1 / hz; this.acc = 0; this.last = 0; this.running = false;
    this.time = 0; this.frame = 0; this.paused = false; this.timeScale = 1;
  }
  start() {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      let delta = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      if (!this.paused) this.stepBy(delta * this.timeScale);
      this.render(this.time);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  stop() { this.running = false; if (this._raf) cancelAnimationFrame(this._raf); }
  stepBy(delta) {
    this.acc += delta;
    let guard = 0;
    while (this.acc >= this.dt && guard++ < 12) {
      this.update(this.dt, this.time);
      this.time += this.dt; this.frame++;
      this.acc -= this.dt;
    }
  }
  // Deterministic advance used by tools/shoot.mjs (no wall clock involved).
  advance(seconds) {
    const steps = Math.round(seconds / this.dt);
    for (let i = 0; i < steps; i++) { this.update(this.dt, this.time); this.time += this.dt; this.frame++; }
  }
}
