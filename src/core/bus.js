// Tiny synchronous event bus. Gameplay emits, audio/fx/ui listen.
class Bus {
  constructor() { this.map = new Map(); this.log = []; }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, new Set());
    this.map.get(evt).add(fn);
    return () => this.map.get(evt).delete(fn);
  }
  emit(evt, payload = {}) {
    this.log.push({ evt, payload });
    if (this.log.length > 400) this.log.shift();
    const set = this.map.get(evt);
    if (set) for (const fn of set) { try { fn(payload); } catch (e) { console.error('bus handler', evt, e); } }
    const star = this.map.get('*');
    if (star) for (const fn of star) { try { fn(evt, payload); } catch (e) { console.error('bus *', e); } }
  }
}
export const bus = new Bus();
