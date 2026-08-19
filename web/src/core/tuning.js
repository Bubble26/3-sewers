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

  /**
   * THE RULES CORE — ported from the Godot project `3-sewers`
   * (../threesewers/scripts/tuning.gd + match_core.gd, see docs/PORT-SPEC.md).
   *
   * Every number under T.play arrived here from a rules engine that was already
   * soak-tested over 40 CPU games: 13.8 runs a game, 3.6 sewer shots, a smashed
   * window about every 13 games. `node tools/soak.mjs` re-measures all three.
   *
   * ── READ THIS BEFORE YOU "IMPROVE" THE TIMING NUMBERS ──────────────────────
   * The comments below are measurement evidence, not decoration. They record two
   * failures that were found the expensive way, and the numbers that fix them.
   * If you change a timing constant, re-run the measurement that produced it or
   * you are re-introducing a bug somebody already paid for.
   */
  play: {
    innings: 3,                    // INNINGS
    ballsWalk: 4,                  // BALLS_WALK
    strikesK: 3,                   // STRIKES_K
    positions: ['P', 'C', '1B', 'SS', 'LF', 'RF'],   // POS_LIST — the six a stickball side fields

    // The pitch, and the whole batting game with it.
    //
    // Two separate failures have been measured here and both are addressed by
    // these numbers.
    //
    // The first was that the hop carried no information: fast and spinner
    // rebounded 1.4% apart. Retuning moved that defect rather than removing it —
    // fast and drop then sat within 0.045-0.14 of a ball diameter of each other
    // for the whole 200ms after the bounce, because their rebound speeds had
    // ended up nearly identical. These are searched, not guessed: the worst pair
    // is now 0.76 ball diameters apart 100ms after the bounce and 0.98 at 133ms,
    // which is the threshold at which a difference is a tell rather than a
    // rounding error.
    //
    // The second was worse and less obvious. A player who never looked at the
    // ball and simply tapped a fixed 310ms after every bounce scored 56.6%
    // perfect contact, against 71.5% for reading the pitch flawlessly. Reading
    // the hop bought 2.4 points of whiff rate — the mechanic the game is named
    // for was decorative. The cause was that the three ideal presses spanned
    // 100ms while the perfect-contact window is 108ms wide, so one fixed delay
    // sat inside all three. The gaps are now 120ms and 160ms, both wider than
    // that window, so a single blind rhythm cannot be right about more than one
    // pitch.
    //
    //   type     bounce->plate   crosses at   press after bounce   doing
    //   fast        300ms           67px           250ms           low, flat, first
    //   spinner     420ms           99px           370ms           mid hop + kick
    //   drop        580ms          142px           530ms           lobs high, falling
    pitchTimes: { fast: 0.52, spinner: 0.58, drop: 0.62 },   // PITCH_TIMES  hand -> plate
    pitchTB:    { fast: 0.30, spinner: 0.42, drop: 0.58 },   // PITCH_TB     hand -> the one bounce
    bounceRest: { fast: 0.24, spinner: 0.36, drop: 0.55 },   // BOUNCE_REST  restitution off the cobbles
    // The pitcher's hand, in world px off the cobbles. A low release caps every
    // rebound, and it is the rebound spread that carries the read.
    pitchArcH: 280.0,                                        // PITCH_ARC_H
    spinKick:  { fast: 0.0, spinner: 34.0, drop: 8.0 },      // SPIN_KICK  sideways kick off the hop
    // ballistics — one gravity for the whole game, in world px/s^2 (a kid is
    // ~160 world px ≈ 1.4 m, so ~1500 reads just a touch snappier than earth)
    ballG: 1500.0,                                           // BALL_G
    ballGChop: 3000.0,                                       // BALL_G_CHOP  grounders are chopped down hard
    groundRest: 0.55,                                        // GROUND_REST  cobble restitution for grounder hops
    // The prompt used to stay lit for 660ms while only ±163ms of that could ever
    // connect — 51% of the window it invited you to swing in was a guaranteed
    // whiff. The window now matches roughly what contact actually tolerates.
    swingEarly: 0.18,                                        // SWING_EARLY
    // 0.13, not 0.18: the ball leaves the bottom of the screen 43ms after it
    // crosses the plate, and the window used to stay open 129ms past that — up to
    // 100ms per pitch of being invited to swing at a ball that is gone.
    swingLate: 0.13,                                         // SWING_LATE
    // Their world is 2D px, ours is feet (1 unit = 1 ft, T.street). A kid is ~160
    // of their px and ~4.6 of our feet, so this is the only honest bridge between
    // the two. The TIMES above are seconds and port straight across — it is the
    // times, not the pixels, that carry the measurement.
    worldPxPerFoot: 34.8,

    // ── the arm on the manhole ────────────────────────────────────────────────
    // pitch_quality(): a floor of 0.35 plus the pitcher's wing, nudged by quirks,
    // then jittered. Quality makes the batter's timing error hurt more (see eff).
    quality: {
      base: 0.35, perArm: 0.05,
      spinner: 0.08,            // quirk 'spinner' — the hop breaks extra
      rifle: 0.05,              // quirk 'rifle' behind the plate steadies him
      southpawFirstLook: 0.12,  // quirk 'southpaw' — only until they have seen him once
      jitter: 0.06, min: 0.20, max: 0.95,
    },
    // What a CPU kid does at the plate. aim_strike is the pitcher's intent, not the call.
    cpu: {
      aimStrike: 0.62, aimStrikeTwoStrikes: 0.50,
      swingAtStrike: 0.82,
      swingAtBallBase: 0.55, swingAtBallPerCon: 0.03, swingAtBallMin: 0.12, swingAtBallMax: 0.50,
      sigmaFloor: 36.0, sigmaBase: 110.0, sigmaPerCon: 5.0, sigmaPerQuality: 50.0,
    },
    // The ump is a kid on a stoop with a candy in his cheek: he misses one in ten.
    umpire: { calledStrike: 0.9 },

    // ── contact ───────────────────────────────────────────────────────────────
    // eff = |error ms| scaled by pitch quality; the three thresholds widen with the
    // batter's EYE. perfect/good/weak in ms. The 108ms good window is the one the
    // press gaps above are spaced wider than — do not narrow it in isolation.
    contact: {
      effBase: 0.78, effPerQuality: 0.55,
      perfectBase: 45.0,  perfectPerCon: 2.5,
      goodBase: 108.0,    goodPerCon: 4.0,
      weakBase: 175.0,    weakPerCon: 4.0,
      perfectQ: [0.85, 1.0], goodQ: [0.5, 0.84], weakQ: [0.15, 0.49],
      foulChance: 0.55,          // weak contact fouls off this often — the at-bat that will not die
      onHouseCon: 1.0,           // quirk 'on_house': every teammate on base sharpens the kid at bat
      eagleEyeCon: 3.0,          // quirk 'eagle_eye': + EYE with two strikes only
    },

    // ── the ball in play ──────────────────────────────────────────────────────
    // carry 0..1.45 is how far up the street it goes; lane -1..+1 is curb to curb
    // (negative is the window side); loft is ground | line | fly.
    inplay: {
      carryBase: 0.26, carryPerPwr: 0.044, carryJitter: [-0.05, 0.07], carryMin: 0.05, carryMax: 1.45,
      wallopFloor: 0.45,          // quirk 'wallop': even his mishits jump off the stick
      threeSewersAt: 0.8, threeSewersBonus: 0.22,   // quirk 'three_sewers': the big ones go a sewer farther
      lanePull: [0.2, 1.0], laneJitter: 0.35,
      flyAt: 0.78, flyOdds: 0.6,                    // >0.78 quality: fly 60% / line 40%
      midAt: 0.5, midLineOdds: 0.55, midFlyOdds: 0.5,
    },
    // The street itself — named streetRules, not street, because T.street above is
    // geometry and these are rules. Every one of them is a signature moment, so they
    // are deliberately rare enough to stay a moment.
    streetRules: {
      windowCarry: 0.75, windowLane: -0.55, windowOdds: 0.5,   // deep pull-side fly smashes glass = HOME RUN you sprint away from
      sewerCarry: 0.55,                                        // over the sewers on the fly
      sewerTwo: 0.72, sewerThree: 0.9,                         // graded in sewers, out loud, by the Gooch
      fireEscapeCarry: 0.38, fireEscapeLane: 0.7, fireEscapeOdds: 0.25,  // rattles into the ironwork = ground-rule double
      flivverLane: 0.85, flivverCarry: 0.3, flivverOdds: 0.3,  // off the parked Ford's fender — live carom (theirs: Mr. Esposito's flivver)
    },
    // Gloves. catch = 0.3 + HANDS*0.05, clamped; a liner is much harder than a fly.
    gloves: {
      catchBase: 0.3, catchPerGlv: 0.05, catchMin: 0.2, catchMax: 0.92,
      spitShine: 0.08,            // quirk 'spit_shine': his side's gloves never let one slip
      lineCatchScale: 0.55,
      flyDoubleCarry: 0.42, lineDoubleCarry: 0.44, lineDoubleOdds: 0.5,
      deepAt: 0.34, ssLane: -0.2, firstLane: 0.35, pitcherCarry: 0.14,
    },
    // The race to first, and the throw the human gets to make.
    race: {
      perSpd: 0.035, perCarry: 0.32, perTeamGlv: 0.02, jitter: 0.12,
      headfirst: 0.05,            // quirk 'headfirst': wins the close ones on the basepaths
      promptLo: -0.18, promptHi: 0.22,   // only a genuinely close play asks the human to pick a base
      throwDeadline: 1.4,
      outAtFirst: 0.16, outAtHome: 0.1,
    },
    // Baserunning. Speedsters take the extra base on their own.
    run: { stretchSpd: 8, stretchOdds: 0.3, extraOdds: 0.4 },   // extraOdds: quirk 'extra'

    // ── between halves ────────────────────────────────────────────────────────
    // CHEESE IT! — the beat cop rounds the corner. A kid with 'lookout' on either
    // side sees him coming, so it happens half as often and is over twice as fast.
    cheese: { chance: 0.16, len: 2.2, lookoutChance: 0.08, lookoutLen: 1.4 },
    extraInnings: 2,             // called on account of supper after this many extra
  },
};
