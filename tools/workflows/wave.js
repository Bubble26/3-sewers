export const meta = {
  name: 'stickball-wave',
  description: 'Build/critique loop: every piece is rebuilt until a fresh-context critic prefers it to Backyard Baseball',
  whenToUse: 'One wave of stickball pieces. Pass args = { wave, title, maxRounds, pieces: [...] }.',
  phases: [
    { title: 'Build', detail: 'one builder per piece, own files only' },
    { title: 'Critique', detail: 'fresh critic renders the real game and judges pixels' },
    { title: 'Integrate', detail: 'one agent plays the whole thing and smooths it' },
  ],
};

const REPO = '/home/user/logicposter/stickball';
const MAX = args?.maxRounds ?? 4;
const PIECES = args?.pieces ?? [];
const WAVE = args?.wave ?? '?';

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    piece: { type: 'string' },
    changed_files: { type: 'array', items: { type: 'string' } },
    scenarios_added: { type: 'array', items: { type: 'string' } },
    shots_verified: { type: 'boolean' },
    console_clean: { type: 'boolean' },
    what_changed: { type: 'string' },
    known_weakness: { type: 'string' },
  },
  required: ['piece', 'changed_files', 'shots_verified', 'console_clean', 'what_changed', 'known_weakness'],
  additionalProperties: false,
};

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    piece: { type: 'string' },
    scores: {
      type: 'object',
      properties: {
        joy: { type: 'number' }, readability: { type: 'number' }, character: { type: 'number' },
        period: { type: 'number' }, craft: { type: 'number' }, aliveness: { type: 'number' },
        feel: { type: 'number' }, cohesion: { type: 'number' },
      },
      required: ['joy', 'readability', 'character', 'period', 'craft', 'aliveness', 'feel', 'cohesion'],
      additionalProperties: false,
    },
    blind_test: { type: 'string' },
    verdict: { type: 'string', enum: ['WOWED', 'NOT_YET'] },
    biggest_gap: { type: 'string' },
    evidence: { type: 'string' },
    next_brief: { type: 'string' },
    build_broken: { type: 'boolean' },
  },
  required: ['piece', 'scores', 'blind_test', 'verdict', 'biggest_gap', 'evidence', 'next_brief', 'build_broken'],
  additionalProperties: false,
};

const COMMON = `
Working directory: ${REPO} (cd there first; it is NOT the repo root).

Read before doing anything:
  docs/CONTRACT.md         — architecture, the __SB harness API, hard rules
  docs/DESIGN-BIBLE.md     — the binding art/audio/comedy direction, palette, signature moments
  docs/BYB-REFERENCE.md    — the Backyard Baseball quality bar, as checkable specifics
  docs/PERIOD-REFERENCE.md — 1925 New York specifics with real dimensions
  docs/CRITIC-RUBRIC.md    — exactly how your work will be judged

Non-negotiable:
* Never run git commands. Another process handles commits.
* Never edit files owned by another piece (listed in your brief). If you need a change there,
  put it in known_weakness instead of reaching in.
* All randomness via src/core/rng.js. All tuning constants via src/core/tuning.js.
* Register your feature as a system in its own module (see docs/CONTRACT.md) and add at most
  one import line to src/boot/modules.js.
* Other agents are editing sibling files at the same time. If tools/shoot.mjs fails inside a
  file you do not own, wait 20 seconds and retry once — it is probably a half-written file,
  not your bug. Never "fix" someone else's module.
* No runtime network requests. Fonts embedded or drawn. Assets generated in code.
* node tools/shoot.mjs must exit 0 with zero console errors, and node tools/bundle.mjs must
  succeed, before you are done.
`;

function builderPrompt(p, round, brief) {
  return `You are the builder for the **${p.title}** piece of a 1920s New York stickball game in Three.js,
built to the standard of Humongous Entertainment's Backyard Baseball. This is round ${round} of wave ${WAVE}.
${COMMON}
## Your piece

${p.brief}

## Files you own (edit only these, plus your one line in src/boot/modules.js)

${p.files.map((f) => '  ' + f).join('\n')}

## Scenarios you must leave working

${(p.scenarios || []).map((s) => '  ' + s).join('\n') || '  (register at least two that show your work off)'}

## This round's brief

${brief}

## How to work

1. Read the reference docs and the existing code you are extending.
2. Build. Go far past "functional" — the bar is a beloved commercial kids' game, so sweat
   silhouettes, colour, timing, contact shadows, and the small jokes.
3. \`node tools/shoot.mjs --out shots/${p.key}-r${round}\` and **read your own PNGs with the Read
   tool**. If it is motion work, also \`node tools/film.mjs <scenario> --frames 12 --step 0.05
   --out shots/${p.key}-r${round}\` and read the strip.
4. Look at what you actually rendered and be honest: does it look like a beloved game or like
   programmer art? Iterate at least three times on your own before you stop. Most of the value
   is in rounds 2 and 3 of your own self-critique.
5. Finish only when shoot exits 0, console is clean, and the bundle builds.

Return the structured result. \`known_weakness\` must be the real thing you would fix next —
critics will find it anyway, and claiming there is none is an automatic fail.`;
}

function criticPrompt(p, round) {
  return `You are a hostile, fresh-eyed critic for the **${p.title}** piece of a 1920s New York stickball
game in Three.js. Round ${round}. You did not build this and you owe it nothing.

Working directory: ${REPO}.

Read \`docs/CRITIC-RUBRIC.md\` and follow its procedure exactly, plus \`docs/BYB-REFERENCE.md\`,
\`docs/DESIGN-BIBLE.md\` and \`docs/PERIOD-REFERENCE.md\` for the bar you are judging against.

Judge this piece specifically: ${p.brief}

Procedure:
1. \`node tools/shoot.mjs --out shots/critic-${p.key}-r${round}\`. Non-zero exit or any console
   error in report.json ⇒ build_broken=true and the piece fails this round regardless of looks.
2. **Read every PNG yourself.** These scenarios matter most: ${(p.scenarios || ['pitch', 'contact', 'deep_fly', 'wide']).join(', ')}.
3. For anything involving motion or timing, run \`node tools/film.mjs <scenario> --frames 12
   --step 0.05 --out shots/critic-${p.key}-r${round}\` and read the contact sheet.
4. Score every rubric axis 1-10. Be stingy: 7 = genuinely good, 9+ = would believe it shipped.
5. Do the blind test: describe our frame as an unlabelled screenshot, describe the equivalent
   Backyard Baseball moment, say plainly which is better. If ours loses, say ours loses.
6. Name the single biggest gap — one sentence, concrete, highest leverage.
7. Write next_brief as instructions a builder can execute immediately, naming specific files,
   specific geometry, specific colours, specific timings. Vague briefs waste a whole round.

WOWED requires: you would genuinely rather look at our frame than the Backyard Baseball frame,
no axis below 8, and zero console errors. Anything else is NOT_YET. Hesitating means NOT_YET.`;
}

async function runPiece(p) {
  const rounds = [];
  let brief = p.brief;
  for (let round = 1; round <= MAX; round++) {
    const build = await agent(builderPrompt(p, round, brief), {
      label: `build:${p.key}#${round}`, phase: 'Build', schema: BUILD_SCHEMA,
    });
    const crit = await agent(criticPrompt(p, round), {
      label: `critic:${p.key}#${round}`, phase: 'Critique', schema: CRITIC_SCHEMA,
    });
    if (!crit) { rounds.push({ round, error: 'critic died' }); continue; }
    rounds.push({ round, verdict: crit.verdict, scores: crit.scores, gap: crit.biggest_gap, blind: crit.blind_test, broken: crit.build_broken });
    log(`${p.key} r${round}: ${crit.verdict} — ${crit.biggest_gap}`);
    if (crit.verdict === 'WOWED' && !crit.build_broken) break;
    brief = `${crit.next_brief}\n\nThe critic's single biggest gap was: ${crit.biggest_gap}\nTheir evidence: ${crit.evidence}\nFix that first, then keep raising the rest.` +
      (build?.known_weakness ? `\nThe previous builder flagged: ${build.known_weakness}` : '');
  }
  return { piece: p.key, title: p.title, rounds };
}

phase('Build');
const results = await parallel(PIECES.map((p) => () => runPiece(p)));

phase('Integrate');
const integration = await agent(`You are the integrator for wave ${WAVE} ("${args?.title ?? ''}") of the 1920s stickball game.
${COMMON}
Several builders just worked in parallel on: ${PIECES.map((p) => p.title).join(', ')}.
Your job is to make the result feel like ONE game made by ONE team, not modules stapled together.

1. \`node tools/shoot.mjs --out shots/integrate-w${WAVE}\` and read every frame. Then run
   \`node tools/film.mjs contact --frames 12 --step 0.05 --out shots/integrate-w${WAVE}\` and read it.
2. Hunt specifically for seams: clashing colour temperature between systems, scale mismatches,
   double-registered systems, z-fighting, things that visually contradict each other, shadows
   that disagree, features that only look right in one scenario, and any scenario a builder
   left broken.
3. Fix the seams. You may edit any file, but prefer the smallest change that makes the whole
   read as one thing. Consolidate duplicated constants into src/core/tuning.js and duplicated
   colours into the palette module named by the design bible.
4. Delete dead code and stale placeholder geometry left behind by earlier rounds.
5. Verify: shoot exits 0, console clean, bundle builds, and re-read the frames to confirm the
   scene improved rather than regressed.

Return a plain-text report: what seams you found, what you changed, and the two weakest things
still visible in the frames.`, { label: `integrate:w${WAVE}`, phase: 'Integrate' });

return { wave: WAVE, pieces: results, integration };
