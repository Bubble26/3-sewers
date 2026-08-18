// Deterministic PRNG (mulberry32). Every random draw in the sim must come from here
// so the screenshot harness can replay identical frames.
export class RNG {
  constructor(seed = 1920) { this.seed = seed >>> 0; this.s = this.seed; }
  reset(seed = this.seed) { this.seed = seed >>> 0; this.s = this.seed; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[this.int(0, arr.length - 1)]; }
  chance(p) { return this.next() < p; }
}
export const rng = new RNG(1920);
