/**
 * rig.js — the parametric kid.
 *
 * Every kid on the block is this one rig with different dials: height, weight, head shape,
 * posture, stance, wardrobe. DESIGN-BIBLE §5.1 fixes the proportions and they are enforced
 * here in arithmetic rather than in taste:
 *
 *     standing height = head-heights x head height        (3.0-3.5, two named exceptions)
 *     head            = 29-33% of standing height
 *     torso           ~ 1 head-height, shoulder to hip
 *     legs            = 1.2-1.5 head-heights
 *     shoulders       <= head width          <- the single most reliable "child" cue
 *     neck            = 0-0.15 head-heights
 *     hands           = 55-70% of head width, mitts, no anatomy
 *     shoes           = 0.7-0.9 head-heights long
 *     limbs are tubes. There is no muscle definition anywhere in this file.
 *
 * Shading is baked (see wardrobe.js): a two-band toon ramp plus a bounce band, authored
 * against a fixed key, so the kids look the same whichever way they face and whatever the
 * lighting piece is doing. Outlines are inverted hulls tinted from the fill they border.
 *
 * Attach points for the animation piece:
 *     kid.userData.attach.batGrip / ballHand / gloveHand / capTop / chest
 *     kid.userData.rig.{ root hips torso chest neck head armL armR foreL foreR
 *                        handL handR legL legR shinL shinR footL footR }
 * Faces:  setExpression(kid, name) from ./faces.js
 */
import * as THREE from 'three';
import { registerSystem, app } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import {
  CHALK, INK, SKIN, CLOTH, ACCENTS, TEAMS, AIR, PAVEMENT, FACADE, BALL, soot,
} from '../render/palette.js';
import {
  Body, partMesh, outlineOf, G, deformHead, mix, coolShade, inkOf, hexCSS,
  WOOL, HAIR, LEATHER, SOCKWOOL,
  FAMILIES, KIDS, LINEUP_ORDER, specFor, specFromColors,
  buildCap, buildHair, buildEars, buildKnicker, buildStocking, buildBoot,
  buildSuspenders, buildProp,
} from './wardrobe.js';
import { makeFace, setExpression, EXPRESSION_NAMES } from './faces.js';

/* ============================================================================
   Rest poses. Bad form, held with total confidence (BYB §1.4).
   [shoulder xyz], [elbow xyz] per side, plus stance and lean.
   ========================================================================= */
const POSES = {
  ready:      { sR: [0.10, 0, -0.26], sL: [0.10, 0, 0.26], eR: [-0.42, 0, 0.10], eL: [-0.42, 0, -0.10], spread: 0.16, toe: 0.11, lean: 0.03 },
  hipsHands:  { sR: [0.05, 0, -0.98], sL: [0.05, 0, 0.98], eR: [-0.55, 0, 1.72], eL: [-0.55, 0, -1.72], spread: 0.30, toe: 0.18, lean: -0.05 },
  armsCrossed:{ sR: [-0.30, 0, -0.52], sL: [-0.30, 0, 0.52], eR: [-1.30, 0, 1.60], eL: [-1.42, 0, -1.60], spread: 0.20, toe: 0.14, lean: -0.02 },
  scratch:    { sR: [-0.25, 0, -2.55], sL: [0.14, 0, 0.18], eR: [-1.55, 0, 0.55], eL: [-0.35, 0, -0.08], spread: 0.14, toe: 0.10, lean: 0.02 },
  pockets:    { sR: [0.05, 0, -0.30], sL: [0.05, 0, 0.30], eR: [-0.30, 0, 0.62], eL: [-0.30, 0, -0.62], spread: 0.18, toe: 0.15, lean: 0.04 },
  slouch:     { sR: [0.18, 0, -0.14], sL: [0.30, 0, 0.34], eR: [-0.22, 0, 0.06], eL: [-0.16, 0, -0.20], spread: 0.34, toe: 0.22, lean: -0.09, hip: 0.10 },
  point:      { sR: [-1.75, 0, -0.30], sL: [0.06, 0, 0.92], eR: [-0.22, 0, 0.05], eL: [-0.50, 0, -1.66], spread: 0.24, toe: 0.16, lean: 0.06 },
  batReady:   { sR: [-0.55, 0, -1.10], sL: [-0.62, 0, 0.86], eR: [-1.35, 0, 0.55], eL: [-1.50, 0, -0.35], spread: 0.34, toe: 0.16, lean: 0.02, turn: 0.42 },
  tidy:       { sR: [0.02, 0, -0.10], sL: [0.02, 0, 0.10], eR: [-0.10, 0, 0], eL: [-0.10, 0, 0], spread: 0.06, toe: 0.07, lean: 0.0 },
  sleeves:    { sR: [0.06, 0, -0.34], sL: [0.06, 0, 0.34], eR: [-0.18, 0, 0.04], eL: [-0.18, 0, -0.04], spread: 0.16, toe: 0.12, lean: 0.05 },
  sprintset:  { sR: [-1.05, 0, -0.22], sL: [0.95, 0, 0.22], eR: [-0.95, 0, 0], eL: [-0.80, 0, 0], spread: 0.26, toe: 0.08, lean: 0.20, stagger: 0.55 },
  crutch:     { sR: [0.02, 0, -0.16], sL: [0.22, 0, 0.30], eR: [-0.12, 0, 0.02], eL: [-0.30, 0, -0.10], spread: 0.22, toe: 0.15, lean: -0.04, hip: -0.06 },
};

/* ============================================================================
   Shared bits
   ========================================================================= */
let SHADOW_TEX = null;
function shadowTexture() {
  if (SHADOW_TEX) return SHADOW_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.86)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  SHADOW_TEX = new THREE.CanvasTexture(c);
  SHADOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return SHADOW_TEX;
}

/** Mandatory under every kid (§2.7): soft blue-violet ellipse, never grey, never black. */
function contactShadow(w, d) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      color: AIR.shadowTint, map: shadowTexture(), transparent: true, opacity: 0.36,
      depthWrite: false, fog: false, toneMapped: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  m.renderOrder = -2;
  m.name = 'contactShadow';
  return m;
}

/** Head geometry + the exact same deform applied to the face decal, so they agree. */
function makeSkull(hs, hh) {
  const geo = deformHead(G.sphere(1, 22, 16), hs);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  // read the extents BEFORE scaling: applyMatrix4 recomputes boundingBox in place, and
  // reading it afterwards silently multiplies the head width by the scale a second time.
  const w0 = bb.max.x - bb.min.x, d0 = bb.max.z - bb.min.z, h0 = bb.max.y - bb.min.y;
  const s = hh / h0;
  const yOff = -((bb.max.y + bb.min.y) / 2) * s;
  geo.scale(s, s, s);
  geo.translate(0, yOff, 0);
  return { geo, s, yOff, hw: w0 * s, hd: d0 * s };
}

function faceDecal(hs, hh, s, yOff, texture) {
  const phiHalf = 1.07;
  const geo = new THREE.SphereGeometry(1.018, 22, 22, Math.PI / 2 - phiHalf, phiHalf * 2, 0.60, 1.78);
  deformHead(geo, hs);
  geo.scale(s, s, s);
  geo.translate(0, yOff, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, fog: false, toneMapped: false,
  }));
  m.renderOrder = 3;
  m.name = 'face';
  return m;
}

/* ============================================================================
   THE RIG
   ========================================================================= */

export function buildKidFromSpec(specRef, opts = {}) {
  const spec = specFor(specRef);
  const fam = FAMILIES[spec.fam];
  const q = spec.quirk || {};

  /* ---- dials -> dimensions ------------------------------------------- */
  const heads = fam.heads + (spec.dh || 0);
  const tall = (fam.tall + (spec.dh || 0) * 0.28) * (spec.scale || 1);
  const hh = tall / heads;
  const build = fam.build;
  const neckH = hh * (fam.neck !== undefined ? fam.neck : 0.09);
  // Legs are claimed first at 1.30 head-heights, then the torso takes what is left and is
  // clamped to the short boxy range. That is what makes the head read as 30% of the kid.
  const torsoH = hh * Math.max(0.72, Math.min(1.05, heads - 1 - (neckH / hh) - 1.30));
  const legLen = tall - hh - neckH - torsoH;
  const ankleH = hh * 0.11;
  const thighLen = (legLen - ankleH) * 0.46;
  const shinLen = (legLen - ankleH) * 0.54;
  const shoeLen = hh * (0.74 + (fam.feet === 'bare' ? 0.14 : 0.04));

  const skull = makeSkull(fam.head, hh);
  const hw = skull.hw;
  const chestW = hw * (0.400 + build * 0.100);        // HALF shoulder width: <= head width
  const chestD = chestW * 0.74;
  const hipR = chestW * (0.82 + build * 0.26);
  const legR = hipR * 0.47;
  const handW = hw * (0.55 + build * 0.05);

  /* ---- colours -------------------------------------------------------- */
  const skinColor = SKIN[spec.skin ?? 1];
  const hairColor = HAIR[spec.hair ?? 1];
  const accent = ACCENTS[spec.accent] || ACCENTS.red;
  const teamCol = spec.team ? TEAMS.away.primary : TEAMS.home.primary;
  const seed = spec.id.charCodeAt(0) + spec.id.length;
  const shirt = CLOTH[seed % CLOTH.length];
  const trouser = WOOL[(seed + 2) % WOOL.length];
  const dirt = soot(FACADE.brickShade, 0.18);
  const slot = spec.slot || 'sweater';
  const topKind = (fam.top === 'dress' || fam.top === 'handmedown') ? fam.top
    : (slot === 'sweater' ? 'sweater' : slot === 'vest' ? 'vest' : fam.top);
  const hatKind = fam.hat.kind;

  const ctx = {
    spec, fam, hh, hw, hd: skull.hd, tall, heads, build,
    torsoH, chestW, chestD, hipR, legR, thighLen, shinLen, ankleH, shoeLen, handW, legLen,
    skinColor, trouser, trouserDark: soot(trouser, 0.26), buckle: PAVEMENT.manholeHigh,
    patchColor: seed % 2 ? mix(trouser, CLOTH[2], 0.55) : soot(mix(trouser, WOOL[(seed + 4) % WOOL.length], 0.6), 0.16),
    patchStitch: mix(CLOTH[0], PAVEMENT.curb, 0.30),
    buckleBand: mix(soot(trouser, 0.42), INK, 0.22),
    patched: seed % 3 !== 0, dirt, baggy: fam.baggy,
    bareLeg: !!fam.bareLeg,
    outline: hh * 0.050,
    teamColor: teamCol,
    teamOnCap: hatKind !== 'none',
    hat: hatKind === 'none' ? null : { ...fam.hat, color: slot === 'cap' ? accent : WOOL[(seed + 1) % WOOL.length] },
    hair: { style: spec.hairStyle || fam.hair, color: hairColor, ribbon: slot === 'ribbon' ? accent : null },
    ears: fam.ears || 0,
    earShade: coolShade(skinColor, 0.80),
    susp: { on: fam.susp, color: slot === 'suspenders' ? accent : LEATHER[seed % 3], offShoulder: seed % 4 === 0 ? 'L' : seed % 4 === 1 ? 'R' : null },
    prop: spec.prop,
    feet: fam.feet === 'bare'
      ? { kind: 'bare' }
      : {
        kind: fam.feet,
        color: fam.feet === 'keds' ? mix(CLOTH[3], CHALK, 0.4) : LEATHER[seed % 3],
        sole: fam.feet === 'keds' ? soot(CLOTH[2], 0.30) : soot(LEATHER[2], 0.25),
        tongue: LEATHER[(seed + 1) % 3], lace: mix(CLOTH[0], PAVEMENT.curb, 0.4),
      },
    capY: hh * Math.max(0.185, Math.min(0.28, 0.228 - ((hatKind === 'none' ? 1 : fam.hat.size) - 1) * 0.10)),
  };

  /* ---- hierarchy ------------------------------------------------------ */
  const kid = new THREE.Group();
  kid.name = 'kid:' + spec.id;
  const root = new THREE.Group(); kid.add(root);
  const hips = new THREE.Group(); hips.position.y = legLen; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = new THREE.Group(); chest.position.y = torsoH; torso.add(chest);
  const neck = new THREE.Group(); neck.position.y = neckH * 0.4; chest.add(neck);
  const head = new THREE.Group(); head.position.y = neckH * 0.6 + hh * 0.5; neck.add(head);

  /* ---- torso ---------------------------------------------------------- */
  const tb = new Body();
  {
    const prof = [
      [hipR * 0.98, -hh * 0.06], [hipR * 1.02, torsoH * 0.16], [chestW * 0.94, torsoH * 0.50],
      [chestW * 1.00, torsoH * 0.84], [chestW * 0.88, torsoH * 1.00],
    ];
    const t = G.tube(prof, 14);
    t.scale(1, 1, chestD / chestW);
    tb.add(t, shirt);
    // open collar, shirttail out on one side
    const col = G.tube([[chestW * 0.60, torsoH * 0.94], [chestW * 0.74, torsoH * 1.04], [chestW * 0.66, torsoH * 1.10]], 20);
    col.scale(1, 1, chestD / chestW * 1.06);
    tb.add(col, mix(shirt, CHALK, 0.20));
  }
  if (topKind === 'vest') {
    const v = G.tube([
      [chestW * 1.04, -hh * 0.03], [chestW * 1.10, torsoH * 0.30],
      [chestW * 1.06, torsoH * 0.66], [chestW * 0.98, torsoH * 0.90],
    ], 20);
    v.scale(1, 1, chestD / chestW);
    tb.add(v, accent);
    for (let i = 0; i < 3; i++) {
      const b = G.sphere(hh * 0.035, 8, 6);
      b.translate(0, torsoH * (0.28 + i * 0.20), chestD * 1.09);
      tb.add(b, PAVEMENT.manholeHigh);
    }
  } else if (topKind === 'sweater') {
    const s = G.tube([
      [hipR * 1.20, -hh * 0.30], [hipR * 1.22, -hh * 0.10], [chestW * 1.12, torsoH * 0.42],
      [chestW * 1.10, torsoH * 0.80], [chestW * 0.96, torsoH * 0.98],
    ], 20);
    s.scale(1, 1, chestD / chestW);
    tb.add(s, accent);
  } else if (topKind === 'handmedown') {
    // A small kid entirely inside an adult's wool sweater: the silhouette is a bell.
    const s = G.tube([
      [hipR * 1.92, -thighLen * 0.98], [hipR * 1.86, -thighLen * 0.74],
      [hipR * 1.44, -hh * 0.05], [chestW * 1.34, torsoH * 0.52],
      [chestW * 1.20, torsoH * 0.86], [chestW * 0.98, torsoH * 1.00],
    ], 20);
    s.scale(1, 1, chestD / chestW * 1.06);
    tb.add(s, accent);
    tb.smudge(0, -thighLen * 0.5, hipR, hipR * 1.6, dirt, 0.30);
  } else if (topKind === 'dress') {
    const s = G.tube([
      [hipR * 1.16, -hh * 0.16], [hipR * 1.10, hh * 0.02], [chestW * 1.04, torsoH * 0.50],
      [chestW * 1.02, torsoH * 0.86], [chestW * 0.92, torsoH * 1.00],
    ], 20);
    s.scale(1, 1, chestD / chestW);
    tb.add(s, mix(shirt, accent, 0.52));
    const sash = G.tube([[hipR * 1.20, -hh * 0.16], [hipR * 1.22, -hh * 0.04]], 14);
    sash.scale(1, 1, chestD / chestW);
    tb.add(sash, accent);
  }
  if (fam.bowtie) {
    for (const sx of [-1, 1]) {
      const w = G.box(hh * 0.13, hh * 0.11, hh * 0.05, hh * 0.02, 2);
      w.rotateZ(sx * 0.5);
      w.translate(sx * hh * 0.085, torsoH * 1.02, chestD * 0.80);
      tb.add(w, accent);
    }
    const kn = G.sphere(hh * 0.035, 8, 6);
    kn.translate(0, torsoH * 1.02, chestD * 0.86);
    tb.add(kn, soot(accent, 0.20));
  }
  buildSuspenders(tb, ctx);
  buildProp(tb, ctx);
  tb.smudge(0, hh * 0.05, chestD, hipR * 1.6, dirt, 0.22);
  torso.add(partMesh(tb, ctx.outline, 'torso'));

  let tailG = null;
  if (topKind === 'shirt' || topKind === 'vest') {
    const tbo = new Body();
    const tail = G.box(chestW * 0.80, hh * 0.26, chestD * 0.34, hh * 0.05, 2);
    tail.rotateZ(0.14);
    tail.translate(chestW * 0.62, -hh * 0.13, chestD * 0.66);
    tbo.add(tail, mix(shirt, CHALK, 0.10));
    tbo.smudge(chestW * 0.62, -hh * 0.24, chestD * 0.66, hh * 0.2, dirt, 0.3);
    tailG = new THREE.Group();
    tailG.add(partMesh(tbo, ctx.outline, 'shirttail'));
    torso.add(tailG);
  }

  // dropped-waist skirt, hem taken up to mid-calf, hangs from the hips not the ribs
  if (topKind === 'dress') {
    const sb = new Body();
    const hem = -(thighLen + shinLen * 0.42);
    const s = G.tube([
      [hipR * 1.18, hh * 0.02], [hipR * 1.34, -thighLen * 0.40],
      [hipR * 1.62, hem + hh * 0.06], [hipR * 1.66, hem],
    ], 16);
    sb.add(s, mix(shirt, accent, 0.52));
    const trim = G.tube([[hipR * 1.66, hem], [hipR * 1.68, hem + hh * 0.05]], 16);
    sb.add(trim, accent);
    sb.smudge(0, hem + hh * 0.1, hipR, hipR * 1.4, dirt, 0.24);
    tailG = new THREE.Group();
    tailG.add(partMesh(sb, ctx.outline, 'skirt'));
    hips.add(tailG);
  }

  /* ---- arms ----------------------------------------------------------- */
  const armLen = torsoH * 0.90 + thighLen * 0.50;    // hangs to mid-thigh, not the knee
  const upperLen = armLen * 0.50, foreLen = armLen * 0.50;
  const armR2 = hh * 0.150 * (0.90 + build * 0.20);
  const rig = { root, hips, torso, chest, neck, head };
  const sleeveLong = topKind === 'sweater' || topKind === 'handmedown' || topKind === 'dress';
  const sleevePast = topKind === 'handmedown';
  for (const side of [-1, 1]) {
    const nm = side < 0 ? 'R' : 'L';
    const sh = new THREE.Group();
    sh.position.set(side * chestW * 0.92, -torsoH * 0.07, 0);   // chest is already at the shoulder line
    chest.add(sh);
    const ub = new Body();
    const up = G.tube([[armR2 * 1.05, 0], [armR2, -upperLen * 0.5], [armR2 * 0.94, -upperLen]], 10);
    ub.add(up, sleeveLong || topKind !== 'shirt' ? (topKind === 'shirt' ? shirt : accent) : shirt);
    if (topKind === 'sweater' || topKind === 'handmedown') {
      const sl = G.tube([[armR2 * 1.22, 0], [armR2 * 1.16, -upperLen * 0.6], [armR2 * 1.10, -upperLen]], 10);
      ub.add(sl, accent);
    } else if (topKind === 'dress') {
      const sl = G.tube([[armR2 * 1.20, 0], [armR2 * 1.12, -upperLen * 0.42]], 10);
      ub.add(sl, mix(shirt, accent, 0.16));
    } else {
      // sleeves rolled to a hard cuff roll
      const cuff = G.tube([[armR2 * 1.06, -upperLen * 0.84], [armR2 * 1.14, -upperLen * 0.97], [armR2 * 1.00, -upperLen * 1.02]], 10);
      ub.add(cuff, soot(shirt, 0.10));
    }
    // Team marker for the kids with no cap to band: a strip of dyed flannel round the arm.
    if (!ctx.teamOnCap && side > 0) {
      const b = G.tube([[armR2 * 1.10, -upperLen * 0.26], [armR2 * 1.16, -upperLen * 0.40],
        [armR2 * 1.08, -upperLen * 0.50]], 12);
      ub.add(b, teamCol);
    }
    sh.add(partMesh(ub, ctx.outline, 'upper' + nm));

    const el = new THREE.Group(); el.position.y = -upperLen; sh.add(el);
    const fb = new Body();
    const skinFore = !sleeveLong;
    const fo = G.tube([[armR2 * 0.92, 0], [armR2 * 0.86, -foreLen * 0.55], [armR2 * 0.90, -foreLen]], 10);
    fb.add(fo, skinFore ? skinColor : accent);
    if (skinFore) fb.smudge(0, -foreLen * 0.8, armR2, armR2 * 2.4, dirt, 0.28);
    if (sleevePast) {
      const sl = G.tube([[armR2 * 1.20, 0], [armR2 * 1.16, -foreLen * 0.7], [armR2 * 1.24, -foreLen * 1.30], [armR2 * 0.9, -foreLen * 1.40]], 10);
      fb.add(sl, accent);
    }
    sh.userData.name = nm;
    el.add(partMesh(fb, ctx.outline, 'fore' + nm));

    const hd = new THREE.Group(); hd.position.y = -foreLen; el.add(hd);
    if (!sleevePast) {
      const hb = new Body();
      const mitt = G.sphere(handW * 0.50, 12, 9);
      mitt.scale(0.58, 1.06, 0.94);
      mitt.translate(0, -handW * 0.20, 0);
      hb.add(mitt, mix(skinColor, coolShade(skinColor), 0.28));
      const thumb = G.sphere(handW * 0.19, 8, 6);
      thumb.scale(0.8, 1.15, 1.0);
      thumb.translate(-side * handW * 0.15, -handW * 0.08, handW * 0.24);
      hb.add(thumb, mix(skinColor, coolShade(skinColor), 0.28));
      hb.smudge(0, -handW * 0.46, 0, handW * 1.05, dirt, 0.50);   // black palm: dirt shape #3
      hd.add(partMesh(hb, ctx.outline * 0.85, 'hand' + nm));
    }
    const grip = new THREE.Object3D();
    grip.name = 'grip' + nm;
    grip.position.set(0, -handW * 0.34, handW * 0.10);
    hd.add(grip);
    rig['arm' + nm] = sh; rig['fore' + nm] = el; rig['hand' + nm] = hd; rig['grip' + nm] = grip;
  }

  /* ---- legs ----------------------------------------------------------- */
  const braceSide = fam.brace === 'R' ? -1 : fam.brace === 'L' ? 1 : 0;
  for (const side of [-1, 1]) {
    const nm = side < 0 ? 'R' : 'L';
    const hipG = new THREE.Group();
    hipG.position.set(side * hipR * 0.56, 0, 0);
    hips.add(hipG);
    const lb = new Body();
    buildKnicker(lb, ctx, side);
    if (side === braceSide) {
      for (const ox of [-1, 1]) {
        const rod = G.cyl(hh * 0.020, hh * 0.020, thighLen * 0.82, 6);
        rod.translate(ox * legR * 1.24, -thighLen * 0.55, legR * 0.18);
        lb.add(rod, PAVEMENT.manholeHigh);
      }
      const band = G.ring(legR * 1.22, hh * 0.022, 6, 14);
      band.rotateX(Math.PI / 2);
      band.translate(0, -thighLen * 0.98, 0);
      lb.add(band, PAVEMENT.manholeHigh);
    }
    hipG.add(partMesh(lb, ctx.outline, 'thigh' + nm));

    const knee = new THREE.Group(); knee.position.y = -thighLen; hipG.add(knee);
    const sb = new Body();
    const bareTop = fam.highWater || 0;
    const shinSkin = G.tube([[legR * 0.90, 0], [legR * 0.80, -shinLen * 0.6], [legR * 0.68, -shinLen]], 10);
    sb.add(shinSkin, skinColor);
    if (!ctx.bareLeg) {
      const sock = {
        color: SOCKWOOL[(seed + (side < 0 ? 0 : 2)) % SOCKWOOL.length],   // mismatched socks
        sag: side < 0 ? 1.0 : 0.55, phase: side < 0 ? 0.4 : 2.1,
      };
      buildStocking(sb, ctx, side, sock, bareTop);
    } else {
      sb.smudge(0, -shinLen * 0.05, legR * 0.8, legR * 2.4, dirt, 0.42);
    }
    if (side === braceSide) {
      for (const ox of [-1, 1]) {
        const rod = G.cyl(hh * 0.020, hh * 0.020, shinLen * 0.92, 6);
        rod.translate(ox * legR * 1.00, -shinLen * 0.48, legR * 0.12);
        sb.add(rod, PAVEMENT.manholeHigh);
      }
      const band = G.ring(legR * 1.00, hh * 0.022, 6, 14);
      band.rotateX(Math.PI / 2);
      band.translate(0, -shinLen * 0.90, 0);
      sb.add(band, PAVEMENT.manholeHigh);
    }
    knee.add(partMesh(sb, ctx.outline, 'shin' + nm));

    const foot = new THREE.Group(); foot.position.y = -shinLen; knee.add(foot);
    const fb2 = new Body();
    buildBoot(fb2, ctx, side);
    foot.add(partMesh(fb2, ctx.outline, 'foot' + nm));
    rig['leg' + nm] = hipG; rig['shin' + nm] = knee; rig['foot' + nm] = foot;
  }

  /* ---- head ----------------------------------------------------------- */
  const hb = new Body();
  hb.add(skull.geo, skinColor, { term: -0.30 });
  buildEars(hb, ctx);
  hb.smudge(hw * 0.42 * ((seed % 2) ? 1 : -1), -hh * 0.02, ctx.hd * 0.32, hh * 0.24, dirt, 0.24);
  if (neckH > 0.01) {
    const nk = G.cyl(hw * 0.24, hw * 0.27, neckH * 1.9, 10);
    nk.translate(0, -hh * 0.46 - neckH * 0.5, -ctx.hd * 0.04);
    hb.add(nk, skinColor, { shade: 0.62 });
  }
  head.add(partMesh(hb, ctx.outline, 'head'));

  const hairB = new Body();
  buildHair(hairB, ctx);
  let hairG = null;
  if (!hairB.empty) { hairG = new THREE.Group(); hairG.add(partMesh(hairB, ctx.outline * 0.9, 'hair')); head.add(hairG); }

  const brim = ctx.hat ? (ctx.hat.kind === 'adult' ? 0.30 : 0.245) : 0;
  const face = makeFace(spec, { brim });
  head.add(faceDecal(fam.head, hh, skull.s, skull.yOff, face.texture));

  const capG = buildCap(null, ctx);
  if (capG) { head.add(capG); rig.cap = capG; }

  /* ---- the crutch: a different outline entirely, three ground contacts -- */
  if (fam.crutch) {
    const cb = new Body();
    const len = legLen + torsoH * 0.86;
    const wood = LEATHER[1];
    for (const ox of [-1, 1]) {
      const rod = G.cyl(hh * 0.032, hh * 0.030, len * 0.52, 8);
      rod.rotateZ(ox * 0.055);
      rod.translate(ox * hh * 0.10, -len * 0.26 + torsoH * 0.10, 0);
      cb.add(rod, wood);
    }
    const shaft = G.cyl(hh * 0.036, hh * 0.040, len * 0.50, 8);
    shaft.translate(0, -len * 0.76 + torsoH * 0.10, 0);
    cb.add(shaft, wood);
    const pad = G.box(hh * 0.34, hh * 0.10, hh * 0.16, hh * 0.045, 2);
    pad.translate(0, torsoH * 0.10, 0);
    cb.add(pad, mix(shirt, WOOL[0], 0.5));
    const grip2 = G.cyl(hh * 0.036, hh * 0.036, hh * 0.30, 8);
    grip2.rotateZ(Math.PI / 2);
    grip2.translate(0, -len * 0.30 + torsoH * 0.10, 0);
    cb.add(grip2, soot(wood, 0.20));
    const tip = G.cyl(hh * 0.055, hh * 0.062, hh * 0.10, 8);
    tip.translate(0, -len * 1.00 + torsoH * 0.10, 0);
    cb.add(tip, soot(PAVEMENT.asphaltDark, 0.2));
    const cg = new THREE.Group();
    cg.add(partMesh(cb, ctx.outline, 'crutch'));
    cg.position.set(-chestW * 1.55, torsoH * 0.86, chestD * 0.20);
    cg.rotation.z = 0.10;
    chest.add(cg);
    rig.crutch = cg;
  }

  /* ---- pose ----------------------------------------------------------- */
  const pose = POSES[opts.pose || spec.pose] || POSES.ready;
  rig.armR.rotation.set(...pose.sR); rig.armL.rotation.set(...pose.sL);
  rig.foreR.rotation.set(...pose.eR); rig.foreL.rotation.set(...pose.eL);
  rig.legR.rotation.set(0, -pose.toe, -pose.spread + (pose.hip || 0));
  rig.legL.rotation.set(pose.stagger ? -pose.stagger : 0, pose.toe, pose.spread + (pose.hip || 0));
  if (pose.stagger) rig.legR.rotation.x = pose.stagger * 0.7;
  torso.rotation.x = -pose.lean;
  torso.rotation.y = pose.turn || 0;
  head.rotation.set(
    (q.headPitch || 0) - pose.lean * 0.4,
    (q.headYaw || 0) + ((seed % 5) - 2) * 0.045,
    (q.headTilt || 0) + ((seed % 3) - 1) * 0.055,
  );

  /* ---- shadow + bookkeeping ------------------------------------------- */
  kid.add(contactShadow(chestW * 2 * 1.18, chestW * 2 * 0.86));

  kid.userData.spec = spec;
  kid.userData.face = face;
  kid.userData.expression = face.expression;
  kid.userData.baseExpression = spec.ex || 'neutral';
  kid.userData.parts = rig;
  /**
   * The contract src/chars/anim.js binds against. Its L/R are SCREEN sides (L = -X),
   * which for a kid facing +Z is the kid's own right — the clips were authored that way,
   * so the mapping is deliberately crossed here rather than in the clips.
   * Every entry is an Object3D whose rest transform is this kid's pose.
   */
  kid.userData.joints = {
    base: root, hips, chest: torso, neck, head,
    armL: rig.armR, armR: rig.armL, elbL: rig.foreR, elbR: rig.foreL,
    handL: rig.handR, handR: rig.handL,
    legL: rig.legR, legR: rig.legL, kneeL: rig.shinR, kneeR: rig.shinL,
    footL: rig.footR, footR: rig.footL,
  };
  if (rig.cap) kid.userData.joints.brim = rig.cap;
  if (hairG) kid.userData.joints.hair = hairG;
  if (tailG) kid.userData.joints.shirt = tailG;
  kid.userData.attach = {
    batGrip: rig.gripR, ballHand: rig.gripR, gloveHand: rig.gripL,
    chest, head, capTop: rig.cap || head,
  };
  kid.userData.cloth = { shirt, trouser, accent, team: teamCol, skin: skinColor, hair: hairColor };
  kid.userData.metrics = {
    tall, headH: hh, heads: +(tall / hh).toFixed(2),
    headPct: +((hh / tall) * 100).toFixed(1),
    shoulderVsHead: +((chestW * 2) / hw).toFixed(2),
    handVsHead: +(handW / hw).toFixed(2),
    shoeVsHead: +(shoeLen / hh).toFixed(2),
    legHeads: +(legLen / hh).toFixed(2),
    family: spec.fam,
  };
  kid.userData.setExpression = (n) => setExpression(kid, n);
  return kid;
}

/**
 * Legacy entry point. players.js calls buildKid({ shirt, cap, ... }); map any such call onto
 * a real kid deterministically so the street fills with characters rather than colour swaps.
 */
export function buildKid(opts = {}) {
  if (opts && opts.spec) return buildKidFromSpec(opts.spec, opts);
  if (opts && opts.id) return buildKidFromSpec(opts.id, opts);
  return buildKidFromSpec(specFromColors(opts), { ...opts, pose: 'ready' });
}

/** Head + shoulders bust, for the face sheet. */
export function buildBust(specRef) {
  const kid = buildKidFromSpec(specRef);
  const g = new THREE.Group();
  const rig = kid.userData.parts;
  const hh = kid.userData.metrics.headH;
  rig.head.position.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  g.add(rig.head);
  const bust = new Body();
  const cw = hh * 0.46;
  const cloth = kid.userData.cloth;
  const sh = G.tube([
    [cw * 0.44, -hh * 0.58], [cw * 0.58, -hh * 0.70],
    [cw * 1.06, -hh * 0.86], [cw * 1.15, -hh * 1.00],
  ], 20);
  sh.scale(1, 1, 0.76);
  bust.add(sh, cloth.shirt);
  const collar = G.tube([[cw * 0.48, -hh * 0.62], [cw * 0.68, -hh * 0.74], [cw * 0.60, -hh * 0.80]], 20);
  collar.scale(1, 1, 0.82);
  bust.add(collar, mix(cloth.shirt, CHALK, 0.18));
  g.add(partMesh(bust, hh * 0.042, 'bust'));
  g.userData.face = kid.userData.face;
  g.userData.spec = kid.userData.spec;
  return g;
}

/* ============================================================================
   PROPS for the lineup — a broom handle and a Spaldeen, purely to prove the
   attach points work. The real ones belong to the props piece.
   ========================================================================= */
function broomBat(len) {
  const b = new Body();
  const s = G.cyl(len * 0.019, len * 0.024, len, 10);
  s.translate(0, len * 0.5, 0);
  b.add(s, mix(LEATHER[0], CLOTH[2], 0.45));
  const tape = G.cyl(len * 0.028, len * 0.028, len * 0.22, 10);
  tape.translate(0, len * 0.11, 0);
  b.add(tape, soot(CLOTH[0], 0.20));
  const g = new THREE.Group();
  g.add(partMesh(b, len * 0.012, 'broombat'));
  return g;
}
function spaldeen(r) {
  const b = new Body();
  b.add(G.sphere(r, 14, 10), BALL.new);
  const g = new THREE.Group();
  g.add(partMesh(b, r * 0.22, 'spaldeen'));
  return g;
}

/* ============================================================================
   STUDIO — 'lineup' and 'face_sheet' live 400 ft above the street so nothing
   the world piece builds can wander into frame.
   ========================================================================= */
const STUDIO_Y = 400;
// Front row and back row between them carry all nine silhouette families.
const LINEUP_FRONT = ['irving', 'sal', 'sidney', 'eugene', 'ethel', 'abie'];
const LINEUP_BACK = ['otto', 'reese', 'bessie', 'cheech', 'tiny', 'maureen'];
const SHEET = ['sal', 'ethel', 'reese', 'bessie', 'cheech', 'kathleen', 'booker', 'gertie'];
const SHEET_EX = ['neutral', 'grin', 'determined', 'shock', 'disappointed', 'taunt', 'yell', 'smug'];

function backdrop(w, h, top, bottom) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, hexCSS(top));
  g.addColorStop(1, hexCSS(bottom));
  x.fillStyle = g; x.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, fog: false, toneMapped: false }));
}

/* ============================================================================
   SYSTEM
   ========================================================================= */
export default registerSystem({
  name: 'characters',
  order: 21,

  init(a) {
    this.lineup = null;
    this.sheet = null;
    this.mode = null;
    this.t = 0;
    this.cam = {
      pos: a.camera.position.clone(),
      quat: a.camera.quaternion.clone(),
      fov: a.camera.fov,
    };
  },

  buildLineup(a) {
    if (this.lineup) return this.lineup;
    const g = new THREE.Group();
    g.position.set(0, STUDIO_Y, 0);

    const bd = backdrop(96, 44, mix(AIR.skyFill, FACADE.partyWall, 0.34), mix(AIR.skyFill, CHALK, 0.46));
    bd.position.set(0, 16, -13);
    g.add(bd);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(96, 40),
      new THREE.MeshBasicMaterial({ color: PAVEMENT.blockCrown, fog: false, toneMapped: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = 6;
    g.add(ground);

    // A stoop rises 4-6 ft to the parlour floor, so the back row stands on one and every
    // kid on it clears the front row's caps completely.
    const RISE = 4.95;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(34, RISE, 9),
      new THREE.MeshBasicMaterial({ color: mix(PAVEMENT.sidewalk, CHALK, 0.30), fog: false, toneMapped: false }),
    );
    step.position.set(0, RISE / 2, -4.9);
    g.add(step);
    const nosing = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.34, 9.5),
      new THREE.MeshBasicMaterial({ color: soot(PAVEMENT.curb, 0.18), fog: false, toneMapped: false }),
    );
    nosing.position.set(0, RISE - 0.17, -4.9);
    g.add(nosing);

    const place = (ids, y, z, gap, rot) => ids.forEach((id, i) => {
      const kid = buildKidFromSpec(id);
      kid.position.set((i - (ids.length - 1) / 2) * gap, y, z);
      kid.rotation.y = rot + ((i % 3) - 1) * 0.11;      // kids face +Z, the camera is at +Z
      g.add(kid);
      if (id === 'sal') {
        const bat = broomBat(kid.userData.metrics.tall * 0.66);
        bat.rotation.set(-0.26, 0, 0.62);
        kid.userData.attach.batGrip.add(bat);
      }
      if (id === 'eugene') {
        const ball = spaldeen(0.19);
        ball.position.set(0, -0.05, 0.05);
        kid.userData.attach.ballHand.add(ball);
      }
    });
    place(LINEUP_BACK, RISE, -3.2, 3.30, 0);
    place(LINEUP_FRONT, 0, 2.4, 3.00, 0);

    a.scene.add(g);
    this.lineup = g;
    return g;
  },

  buildSheet(a) {
    if (this.sheet) return this.sheet;
    const g = new THREE.Group();
    g.position.set(0, STUDIO_Y + 40, 0);
    const bd = backdrop(40, 24, mix(FACADE.partyWall, AIR.skyFill, 0.34), mix(FACADE.partyWall, CHALK, 0.28));
    bd.position.set(0, 0, -6);
    g.add(bd);
    this.busts = [];
    const cols = 4, dx = 2.68, dy = 2.44;
    SHEET.forEach((id, i) => {
      const b = buildBust(id);
      const cx = (i % cols - (cols - 1) / 2) * dx;
      const cy = ((i < cols ? 1 : 0) - 0.5) * dy;
      b.position.set(cx, cy - 0.06, 0);
      b.rotation.y = -Math.atan2(cx, 8.3);
      b.rotation.x = Math.atan2(cy, 8.3) * 0.55;
      g.add(b);
      setExpressionOn(b, SHEET_EX[i]);
      this.busts.push({ g: b, i });
    });
    a.scene.add(g);
    this.sheet = g;
    return g;
  },

  onScenario(name, a) {
    this.mode = name;
    const mine = name === 'lineup' || name === 'face_sheet';
    if (name === 'lineup') this.buildLineup(a);
    if (name === 'face_sheet') this.buildSheet(a);
    if (this.lineup) this.lineup.visible = name === 'lineup';
    if (this.sheet) this.sheet.visible = name === 'face_sheet';
    if (!mine) {
      a.camera.position.copy(this.cam.pos);
      a.camera.quaternion.copy(this.cam.quat);
      if (a.camera.fov !== this.cam.fov) { a.camera.fov = this.cam.fov; a.camera.updateProjectionMatrix(); }
    }
    this.t = 0;
  },

  update(dt) {
    if (this.mode !== 'face_sheet' || !this.busts) return;
    this.t += dt;
    const step = Math.floor(this.t / 0.55);
    for (const b of this.busts) {
      const want = SHEET_EX[(b.i + step) % SHEET_EX.length];
      if (b.g.userData.face.expression !== want) b.g.userData.face.apply(want);
    }
  },
});

function setExpressionOn(bust, name) {
  if (bust.userData.face) bust.userData.face.apply(name);
}

/* ---------------------------------------------------------------------------
   Scenarios
   ------------------------------------------------------------------------ */
registerScenario('lineup', {
  seed: 1925,
  setup: () => {
    app.camera.position.set(0, STUDIO_Y + 4.85, 15.9);
    app.camera.lookAt(0, STUDIO_Y + 4.60, -0.6);
  },
  settle: 0.1,
});

registerScenario('face_sheet', {
  seed: 1925,
  setup: () => {
    app.camera.position.set(0, STUDIO_Y + 40, 8.3);
    app.camera.lookAt(0, STUDIO_Y + 40, 0);
  },
  settle: 0.05,
});

export { setExpression } from './faces.js';
