// Every gameplay magic number lives here so pieces can be tuned independently.
export const T = {
  // world scale: 1 unit = 1 foot
  street: { plateZ: 0, moundZ: 42, baseDist: 60, gutterX: 18 },
  pitch: { speed: 46, arcGravity: 22, releaseHeight: 4.2, plateWindow: 0.14 },
  bat: { swingTime: 0.26, contactWindow: 0.085, sweetSpot: 0.42, power: 1.0 },
  ball: { gravity: 32.2, drag: 0.018, bounce: 0.42, radius: 0.18, mass: 0.14 },
  run: { speed: 17.5, accel: 42 },
  field: { reaction: 0.22, speed: 16.5, throwSpeed: 68 },
  game: { innings: 3, outsPerInning: 3, strikes: 3, balls: 4 },
};
