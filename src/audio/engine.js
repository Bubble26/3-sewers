import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
// Procedural WebAudio. No sample files -> the whole game stays a single self-contained page.
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; this.master = null; }
  ensure() {
    if (this.ctx || !this.enabled) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }
  blip(freq = 440, dur = 0.12, type = 'square', gain = 0.2) {
    const ctx = this.ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(this.master); o.start(); o.stop(ctx.currentTime + dur);
  }
  crack() { this.blip(180, 0.16, 'sawtooth', 0.35); this.blip(900, 0.06, 'square', 0.15); }
  whiff() { this.blip(120, 0.1, 'triangle', 0.12); }
}
export const audio = new Audio();

export default registerSystem({
  name: 'audio',
  order: 150,
  init(app) {
    app.audio = audio;
    if (app.flags.harness) audio.enabled = false;   // headless runs stay silent + deterministic
    bus.on('bat:contact', () => audio.crack());
    bus.on('strike', () => audio.whiff());
    const unlock = () => { audio.ensure(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  },
});
