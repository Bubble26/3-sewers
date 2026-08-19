import { T } from '../core/tuning.js';

export function newGame() {
  return {
    phase: 'idle',           // idle | wind_up | pitch | swing | in_play | resolve | over
    inning: 1, half: 'top',
    outs: 0, balls: 0, strikes: 0,
    score: { home: 0, away: 0 },
    bases: [null, null, null],
    batterIdx: 0,
    lastEvent: '',
  };
}
export function isOver(s) { return s.inning > T.game.innings; }
