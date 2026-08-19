// Every gameplay magic number lives here so pieces can be tuned independently.
export const T = {
  /**
   * THE STAGE (docs/DESIGN-BIBLE.md §17). 3D characters on a 2D stage, not a 3D world.
   * These numbers are the contract between the camera, the backdrop and the field layout —
   * three separate pieces that must agree on one set. Change them here or nowhere.
   */
  stage: {
    playDepth: 70,          // z=0 (plate) .. z=70 (deepest fielder). Nothing playable past it.
    playWidth: 46,          // curb to curb, the width kids move across
    backdrop: {             // flat cards, in z. Scenery only — nobody stands behind these.
      nearFacade: 84,
      midBlock: 130,
      farBlock: 190,
      elevated: 250,
      sky: 400,
    },
    parallax: { nearFacade: 0.55, midBlock: 0.34, farBlock: 0.18, elevated: 0.09, sky: 0.0 },
    lens: { fov: 20, max: 26 },        // long lens: flattens the street, kills convergence
    framings: {
      // Locked. The camera cuts between these; it does not fly. §17.4
      batting: { pos: [-3.5, 15, -46], look: [0, 3.4, 12], fov: 20 },
      field:   { pos: [0, 34, -70], look: [0, 2, 34], fov: 20 },
    },
    scale: { kidMinPct: 12, leadMinPct: 18, leadMaxPct: 26, ballMinPx: 9 },
  },

  // world scale: 1 unit = 1 foot
  street: { plateZ: 0, moundZ: 42, baseDist: 60, gutterX: 18 },
  pitch: { speed: 46, arcGravity: 22, releaseHeight: 4.2, plateWindow: 0.14 },
  bat: { swingTime: 0.26, contactWindow: 0.085, sweetSpot: 0.42, power: 1.0 },
  ball: { gravity: 32.2, drag: 0.018, bounce: 0.42, radius: 0.18, mass: 0.14 },
  run: { speed: 17.5, accel: 42 },
  field: { reaction: 0.22, speed: 16.5, throwSpeed: 68 },
  game: { innings: 3, outsPerInning: 3, strikes: 3, balls: 4 },
};
