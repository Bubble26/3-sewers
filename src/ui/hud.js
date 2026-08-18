// DOM-based scorebug + count. Kept out of WebGL so text stays crisp.
export class HUD {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="scorebug">
        <span class="team away">AWAY <b data-away>0</b></span>
        <span class="inning" data-inning>T1</span>
        <span class="team home">HOME <b data-home>0</b></span>
      </div>
      <div class="count"><span data-count>0-0</span> <span data-outs>0 out</span></div>`;
    root.appendChild(this.el);
    this.$ = (s) => this.el.querySelector(s);
  }
  update(s) {
    this.$('[data-away]').textContent = s.score.away;
    this.$('[data-home]').textContent = s.score.home;
    this.$('[data-inning]').textContent = (s.half === 'top' ? 'T' : 'B') + s.inning;
    this.$('[data-count]').textContent = `${s.balls}-${s.strikes}`;
    this.$('[data-outs]').textContent = `${s.outs} out`;
  }
}
