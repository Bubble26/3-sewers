/**
 * roster.js — WHO THESE KIDS ARE.
 * ============================================================================
 * Sixteen kids off one block, half past three on a Tuesday in September 1925.
 * This file is DATA ONLY. It imports nothing that can move, draws nothing, and
 * registers nothing, so every other system can read it at any point in boot.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT — what other pieces are promised, by name
 * ---------------------------------------------------------------------------
 * The announcer piece reads:   kid.nick, kid.name, kid.call, kid.rep,
 *                              kid.say.*, kid.charm, kid.secret, kid.title
 * The character-art piece reads: kid.art  — a complete wardrobe/rig spec. Pass it
 *                              straight to buildKid({ spec: kid.art }); wardrobe's
 *                              specFor() returns an object ref unchanged, so a kid
 *                              needs no entry in wardrobe.KIDS to be buildable.
 * The audio piece reads:       kid.voice — { pitch, rasp, sting } for the per-character
 *                              instrument sting (DESIGN-BIBLE §7.3).
 * Gameplay slots read:         kid.stats — six axes, integers 1..4, never 0, never 5.
 * The rules core reads:        kid.quirk.id and playCard(kid) — the 1..4 tallies mapped
 *                              onto the five axes src/game/core.js was ported against.
 * The UI reads:                kid.accent (a key into palette ACCENTS) and kid.art.skin.
 *
 * Nothing in here is optional. Every kid has every field. A missing field is a bug,
 * not a default, because a kid with a blank line is a kid the player will not remember.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE
 * ---------------------------------------------------------------------------
 *   id        stable slug, lower case, never rendered
 *   name      the name on the rent book
 *   nick      what the block calls him, and it is permanent and usually cruel
 *   tag       the disambiguator chalked under a shared nickname, or ''
 *   call      what his mother yells out of the window, in her own caps
 *   age       8..13
 *   sex       'b' | 'g'
 *   home      the family's community — a fact of the block, never a punchline (§8.3)
 *   rep       ONE line. The thing you would say about him at the hydrant.
 *   stats     { power contact speed arm fielding nerve }, each 1..4, drawn as chalk tallies.
 *             House rules from DESIGN-BIBLE §5.5, enforced by auditRoster() below:
 *             every kid has at least one 4 and at least one 1 or 2; nobody is good at
 *             everything except one legend; the best hitter and the best arm are
 *             different kids.
 *   stance    { name, note } — traceable to a real 1925 stance (§12), never generic
 *   arm       { quirk } — the thing he does on the mound that everybody imitates
 *   say       { picked passed hit field } — what he actually yells, in his own words
 *   charm     the superstition. Everybody has one and nobody thinks it is a superstition.
 *   secret    { label, text } — the hidden trait the game reveals in play, not in a menu
 *   quirk     { id, name, desc } — the one thing he does that changes the rules. `id` is a
 *             mechanic in src/game/core.js (see QUIRKS below); `name` and `desc` are ours.
 *             Four kids carry id 'none' and a joke, because most kids are just a kid.
 *   owns      'ball' | 'stick' | null — the block's whole power structure (§8.1)
 *   captain   true for the two who are captains by acclamation (period §1.8)
 *   title     an earned label rendered over the head, or ''
 *   accent    key into palette ACCENTS — his one saturated garment (§2.9)
 *   art       the full appearance spec: see wardrobe.js K() for the dial names
 *             ({ id name nick sex fam skin hair accent slot hairStyle prop pose team
 *               ex dh scale quirk }), plus ONE dial this file adds:
 *               art.hat === 'none'  — this kid plays bare-headed, whatever headwear
 *               the silhouette family carries. Five girls use it, because 1925 girls
 *               on a block wore a ribbon or a bob and not a boy's newsboy cap
 *               (PERIOD §5.1), and thirteen caps in a sixteen-card set is a set of
 *               caps rather than a set of kids. wardrobe.FAMILIES does not read this
 *               dial yet, so the 3-D rig still caps those five: see the hand-off note.
 *   voice     { pitch, rasp, sting }
 *
 * Legacy fields (power/speed/armRate/colors) are kept at the bottom of each record
 * because players.js has imported ROSTER since wave 0 and append-only is the rule.
 *
 * ---------------------------------------------------------------------------
 * SIX AXES, NOT FOUR
 * ---------------------------------------------------------------------------
 * DESIGN-BIBLE §5.5 names four axes (Hitting / Running / Fielding / Arm) on a
 * 4-point chalk-tally scale. We ship six — power and contact split hitting, and
 * nerve is added — on the same 4-point scale and the same tally rendering, because
 * splitting hitting is what makes Tiny (power 4, contact 1) a different kid from
 * Rosie (power 2, contact 4). BIBLE_AXES below maps the six back onto the bible's
 * four for anything that wants the original card.
 */

/* ============================================================================
   Scales
   ========================================================================= */

/** The six axes, in card order. */
export const STAT_KEYS = ['power', 'contact', 'speed', 'arm', 'fielding', 'nerve'];

/** Card labels. Short enough for a slab face at 15 px. */
export const STAT_LABEL = {
  power: 'WALLOP', contact: 'EYE', speed: 'WHEELS',
  arm: 'WING', fielding: 'HANDS', nerve: 'NERVE',
};

/** What the number actually means to a kid on this block. */
export const STAT_GLOSS = {
  power: 'how far it goes when he gets all of it',
  contact: 'how often he gets any of it',
  speed: 'first to the corner, first to the sewer grate',
  arm: 'the throw from the far manhole, on the fly',
  fielding: 'whether it sticks',
  nerve: 'two out, tying run, and his mother is at the window',
};

/** The bible's original four, rebuilt from the six. */
export const BIBLE_AXES = {
  hitting: (s) => Math.round((s.power + s.contact) / 2),
  running: (s) => s.speed,
  fielding: (s) => s.fielding,
  arm: (s) => s.arm,
};

export const MAX_STAT = 4;

/* ============================================================================
   The sixteen
   ========================================================================= */

export const ROSTER = [
  {
    id: 'sal',
    name: 'Salvatore Marino', nick: 'Socks', tag: '', call: 'SAL-VA-TO-RE! SUPPER!',
    age: 13, sex: 'b', home: 'Italian',
    rep: 'Owns the stick, so he bats first, and he will explain to you why that is fair.',
    stats: { power: 4, contact: 3, speed: 2, arm: 3, fielding: 2, nerve: 4 },
    stance: { name: "the Ruth, misremembered", note: 'Feet together, hands low, stick straight up — off a newsreel, and copied wrong.' },
    arm: { quirk: 'Rubs the ball on his thigh nine times. Nine. The whole block counts along.' },
    say: { picked: "I'M PICKIN'.", passed: '', hit: 'SOME WALLOP!', field: "IT'S MINE! MINE!" },
    charm: 'Taps the manhole four times instead of two, on the theory that twice is twice as good.',
    secret: { label: 'CANNOT HIT SLOW', text: 'Cannot hit a slow ball. Not one. Nobody has worked it out yet and he prays nightly that it holds.' },
    quirk: { id: 'none', name: 'NO QUIRK THE BLOCK WILL ADMIT', desc: 'He owns the stick, bats first, and explains why that is fair. He is fairly sure that is the quirk.' },
    owns: 'stick', captain: true, title: '',
    accent: 'red',
    art: {
      id: 'sal', name: 'Salvatore Marino', nick: 'Socks', sex: 'b', fam: 'fireplug',
      skin: 3, hair: 0, accent: 'red', slot: 'sweater', prop: 'stick',
      pose: 'batReady', team: 0, ex: 'determined', quirk: { browThick: 1.3, droopy: 'R' },
    },
    voice: { pitch: 0.92, rasp: 0.55, sting: 'trombone' },
    power: 8, speed: 5, armRate: 6, colors: { shirt: 0xc8402f, cap: 0x4a3b2e },
  },

  {
    id: 'kathleen',
    name: 'Kathleen Doyle', nick: 'Legs', tag: '', call: 'KATH-LEEN MARY DOYLE!',
    age: 13, sex: 'g', home: 'Irish',
    rep: 'Owns the ball. Therefore owns the score, the arguments, and the hour the game ends.',
    stats: { power: 2, contact: 3, speed: 4, arm: 4, fielding: 3, nerve: 4 },
    stance: { name: 'the Cobb split grip', note: 'Hands three inches apart on the handle, off a Sunday rotogravure she still has folded up.' },
    arm: { quirk: 'Says out loud what she is about to throw. Then throws it. It is not a trick and it still works.' },
    say: { picked: "I'M PICKIN'.", passed: '', hit: 'AND HOW!', field: 'I GOT IT!' },
    charm: 'Will not step on a crack between the stoop and the plate, which on Belgian block takes a while.',
    secret: { label: 'NEVER ONCE WENT HOME', text: 'Has never once taken her ball and gone home. Everybody knows it. It is the only reason anybody dares argue with her.' },
    quirk: { id: 'spinner', name: 'CALLS IT FIRST', desc: 'Says out loud what she is about to throw, throws it, and it breaks off the hop anyway.' },
    owns: 'ball', captain: true, title: '',
    accent: 'bottleGreen',
    art: {
      id: 'kathleen', name: 'Kathleen Doyle', nick: 'Legs', sex: 'g', fam: 'beanpole',
      skin: 0, hair: 3, accent: 'bottleGreen', slot: 'ribbon', hairStyle: 'ponytail',
      prop: 'ball', pose: 'point', team: 1, ex: 'grin', dh: -0.06, quirk: { freckles: 2 },
    },
    voice: { pitch: 1.18, rasp: 0.30, sting: 'penny_whistle' },
    power: 4, speed: 9, armRate: 8, colors: { shirt: 0x2f7f63, cap: 0x6d3f2a },
  },

  {
    id: 'filomena',
    name: 'Filomena Greco', nick: 'Fanny', tag: '', call: 'FI-LO-ME-NA!',
    age: 9, sex: 'g', home: 'Italian',
    rep: 'Nine years old, four foot nothing. Nobody has ever picked second.',
    stats: { power: 4, contact: 4, speed: 4, arm: 2, fielding: 4, nerve: 4 },
    stance: { name: 'flat on the shoulder', note: 'Feet together, stick flat on her shoulder. Waits.' },
    arm: { quirk: 'Does not pitch. Has never said why.' },
    say: { picked: 'Okay.', passed: 'Okay.', hit: 'Two sewers.', field: 'Mine.' },
    charm: 'Ties the left boot twice. Never the right.',
    secret: { label: 'NOT OUT SINCE EASTER', text: 'Nobody has got her out since Easter. Nobody has thought to mention it.' },
    quirk: { id: 'three_sewers', name: 'TWO SEWERS', desc: 'When she gets all of it, it comes down a full sewer past where anybody was standing.' },
    owns: null, captain: false, title: 'TWO-SEWER MAN',
    accent: 'claret',
    art: {
      id: 'filomena', name: 'Filomena Greco', nick: 'Fanny', sex: 'g', fam: 'fireplug',
      skin: 3, hair: 0, accent: 'claret', slot: 'sweater', hat: 'none', hairStyle: 'braids',
      prop: null, pose: 'ready', team: 0, ex: 'neutral', dh: -0.08, scale: 0.9,
      quirk: { eyeSize: 1.06 },
    },
    voice: { pitch: 1.34, rasp: 0.10, sting: 'mandolin' },
    power: 9, speed: 9, armRate: 4, colors: { shirt: 0xb03a5e, cap: 0x3c3329 },
  },

  {
    id: 'dom',
    name: 'Dominick Marino', nick: 'Junior', tag: '', call: "DOM-IN-ICK! IN! NOW!",
    age: 8, sex: 'b', home: 'Italian',
    rep: "Sal's brother. Comes with the stick whether you want him or not.",
    stats: { power: 1, contact: 2, speed: 4, arm: 1, fielding: 2, nerve: 3 },
    stance: { name: 'the oar', note: 'The stick is taller than he is, so he holds it like an oar and chops down at it.' },
    arm: { quirk: 'Has never been allowed to pitch.' },
    say: { picked: "I'LL GO LAST! I DON'T CARE!", passed: "That's fine. That's fine.", hit: 'DID YOU SEE IT?', field: 'I ALMOST HAD IT!' },
    charm: "Wears one of Sal's socks. Just the one.",
    secret: { label: 'NEVER BEEN TAGGED', text: 'Nobody on this block has ever tagged him out. Nobody has noticed, because nobody has ever put him on.' },
    quirk: { id: 'none', name: 'NOTHING PROVEN YET', desc: 'Nobody has had him on base long enough to find out what he does there.' },
    owns: null, captain: false, title: '',
    accent: 'mustard',
    art: {
      id: 'dom', name: 'Dominick Marino', nick: 'Junior', sex: 'b', fam: 'sack',
      skin: 3, hair: 0, accent: 'mustard', slot: 'sweater', prop: 'jar',
      pose: 'sleeves', team: 0, ex: 'disappointed', dh: -0.10, scale: 0.86,
      quirk: { eyeSize: 1.16, freckles: 1 },
    },
    voice: { pitch: 1.44, rasp: 0.18, sting: 'kazoo' },
    power: 2, speed: 9, armRate: 2, colors: { shirt: 0xe3a32b, cap: 0x554433 },
  },

  {
    id: 'irving',
    name: 'Irving Lefkowitz', nick: 'Skinny', tag: '', call: 'OI-VING! IRVING!',
    age: 13, sex: 'b', home: 'Jewish',
    rep: 'Six feet of elbows, two of which are usually in your way.',
    stats: { power: 3, contact: 2, speed: 3, arm: 4, fielding: 1, nerve: 2 },
    stance: { name: 'the Keeler choke', note: "Choked up four inches, chin on the shoulder. It is Wee Willie's, and he is not Wee Willie." },
    arm: { quirk: 'Sidearm from so far outside it looks like it came off the curb.' },
    say: { picked: 'ON THE LEVEL!', passed: 'Ah, ya bum.', hit: 'HOT SOCKS!', field: 'I HAD IT!' },
    charm: 'Will not play with the fire-escape ladder down. Somebody always puts it down.',
    secret: { label: 'ONE HOP AND YOU ARE OUT', text: 'Cannot catch a thing. Let it reach him on one hop and he will throw out anybody in New York.' },
    quirk: { id: 'rifle', name: 'THE ARM BEHIND THE PLATE', desc: 'Catching, he settles whoever is out on the manhole, and the pitches come in sharper for it.' },
    owns: null, captain: false, title: '',
    accent: 'olive',
    art: {
      id: 'irving', name: 'Irving Lefkowitz', nick: 'Skinny', sex: 'b', fam: 'beanpole',
      skin: 1, hair: 5, accent: 'olive', slot: 'suspenders', prop: 'slingshot',
      pose: 'scratch', team: 0, ex: 'shock', quirk: { eyeSize: 1.1 },
    },
    voice: { pitch: 1.06, rasp: 0.42, sting: 'clarinet' },
    power: 6, speed: 6, armRate: 9, colors: { shirt: 0x8fa23c, cap: 0x40352a },
  },

  {
    id: 'bessie',
    name: 'Bessie Katz', nick: 'Beans', tag: '', call: 'BESS-IE! BESSIE KATZ!',
    age: 11, sex: 'g', home: 'Jewish',
    rep: 'Runs the argument. Has never been on the losing end of one.',
    stats: { power: 3, contact: 3, speed: 2, arm: 2, fielding: 3, nerve: 4 },
    stance: { name: 'wide open, elbow up', note: 'Open stance, back elbow up around her ear, glaring at the pitcher the whole way.' },
    arm: { quirk: 'Talks all the way through the windup and does not stop at release.' },
    say: { picked: 'ABOUT TIME!', passed: 'SEZ WHO?', hit: 'SAYS YOU!', field: 'OUTTA THE WAY!' },
    charm: 'A bottle cap in the left stocking — the one from the day she hit the awning.',
    secret: { label: 'KEEPS THE SCORE', text: 'Keeps the score in her head, out loud, and has never once been wrong. Which is not the same as honest.' },
    quirk: { id: 'on_house', name: 'FROM THE BAG', desc: 'Standing on a base she calls the count, the fielders, and your business, and her side hits sharper for it.' },
    owns: null, captain: false, title: '',
    accent: 'plum',
    art: {
      id: 'bessie', name: 'Bessie Katz', nick: 'Beans', sex: 'g', fam: 'melon',
      skin: 2, hair: 1, accent: 'plum', slot: 'ribbon', hat: 'none', hairStyle: 'pigtails',
      prop: 'jar', pose: 'hipsHands', team: 1, ex: 'taunt', quirk: { tongue: 'L' },
    },
    voice: { pitch: 1.22, rasp: 0.48, sting: 'wood_block' },
    power: 6, speed: 4, armRate: 4, colors: { shirt: 0x7b4a8c, cap: 0x4a3b2e },
  },

  {
    id: 'rose',
    name: 'Rose Abramowitz', nick: 'Rosie', tag: '', call: 'ROIZL! ROSE!',
    age: 12, sex: 'g', home: 'Jewish',
    rep: 'Two years of piano lessons and every hour of it went into her wrists.',
    stats: { power: 2, contact: 4, speed: 2, arm: 3, fielding: 3, nerve: 3 },
    stance: { name: 'the still hands', note: 'Perfectly still, hands high, and then a flick. Nothing else on her moves at all.' },
    arm: { quirk: 'Counts to three out loud before she lets go. Always three. Never four.' },
    say: { picked: 'YOU SAID IT!', passed: 'Applesauce.', hit: 'DUCK SOUP!', field: 'IT IS MINE!' },
    charm: 'Practices the swing on the banister going down all four flights. Every flight.',
    secret: { label: 'FOULS THEM OFF', text: 'Fouls off nine, ten, eleven pitches until the pitcher’s arm quits. She has never mentioned that this is on purpose.' },
    quirk: { id: 'eagle_eye', name: 'TWO STRIKES, SO WHAT', desc: 'With two strikes she gets wood on anything thrown. The pitcher gives up before she does.' },
    owns: null, captain: false, title: '',
    accent: 'slateBlue',
    art: {
      id: 'rose', name: 'Rose Abramowitz', nick: 'Rosie', sex: 'g', fam: 'ribbon',
      skin: 2, hair: 1, accent: 'slateBlue', slot: 'ribbon', hairStyle: 'braids',
      prop: null, pose: 'ready', team: 1, ex: 'grin', dh: -0.02,
    },
    voice: { pitch: 1.26, rasp: 0.16, sting: 'piano' },
    power: 4, speed: 4, armRate: 6, colors: { shirt: 0x4e8ca8, cap: 0x5b4436 },
  },

  {
    id: 'otto',
    name: 'Otto Bauer', nick: 'Melon', tag: '', call: 'OT-TO! OTTOOO!',
    age: 12, sex: 'b', home: 'German',
    rep: 'The cap does not fit and he will not discuss it.',
    stats: { power: 4, contact: 2, speed: 1, arm: 3, fielding: 3, nerve: 3 },
    stance: { name: 'the bucket lean', note: 'Leans away from the plate like the ball owes him money, then steps back in anyway.' },
    arm: { quirk: 'Blows on his fingers before every pitch. In August.' },
    say: { picked: 'ATTABOY!', passed: 'Aw, nuts.', hit: 'OH, YOU KID!', field: 'HEADS UP!' },
    charm: 'Four bars of harmonica between innings. Only four. Nobody has ever heard the fifth.',
    secret: { label: 'PUT ONE OVER THE LINE', text: 'The only kid on the block who has put one clean over the second-floor line, and he says he never saw the pitch.' },
    quirk: { id: 'none', name: 'ONCE, IN SEPTEMBER', desc: 'One ball clean over the second-floor line, and not one since. The block is still waiting on the second.' },
    owns: null, captain: false, title: '',
    accent: 'rust',
    art: {
      id: 'otto', name: 'Otto Bauer', nick: 'Melon', sex: 'b', fam: 'melon',
      skin: 1, hair: 4, accent: 'rust', slot: 'sweater', prop: 'harmonica',
      pose: 'pockets', team: 0, ex: 'grin', quirk: { freckles: 1, browThick: 1.15 },
    },
    voice: { pitch: 0.98, rasp: 0.36, sting: 'tuba' },
    power: 9, speed: 2, armRate: 6, colors: { shirt: 0xd4694a, cap: 0x5e5b44 },
  },

  {
    id: 'stash',
    name: 'Stanislaw Kowalski', nick: 'Stash', tag: '', call: 'STA-SHOO! STA-SHOOOO!',
    age: 12, sex: 'b', home: 'Polish',
    rep: 'The best kid on the block for two innings. His mother owns the third.',
    stats: { power: 3, contact: 4, speed: 3, arm: 2, fielding: 3, nerve: 4 },
    stance: { name: 'in the bucket', note: 'Steps in the bucket every single time and hits it on the nose anyway.' },
    arm: { quirk: 'Checks the third-floor window between every pitch.' },
    say: { picked: 'I GOT TILL SUPPER!', passed: "That's swell, I gotta go anyway.", hit: 'TWO MINUTES! TWO MORE MINUTES!', field: 'HOLD IT! HOLD IT!' },
    charm: 'Never takes the last at-bat of an inning if he can trade out of it. That is when it happens.',
    secret: { label: 'THIRD FLOOR, SECOND WINDOW', text: 'When that window opens the inning is over, and it has never once opened at a good time.' },
    quirk: { id: 'none', name: 'GOOD FOR TWO INNINGS', desc: 'Whatever he has got, the third-floor window takes it back before anybody can put a name on it.' },
    owns: null, captain: false, title: '',
    accent: 'indigo',
    art: {
      id: 'stash', name: 'Stanislaw Kowalski', nick: 'Stash', sex: 'b', fam: 'melon',
      skin: 1, hair: 4, accent: 'indigo', slot: 'suspenders', prop: 'cards',
      pose: 'ready', team: 1, ex: 'squint', dh: 0.04, quirk: { browThick: 1.1, droopy: 'L' },
    },
    voice: { pitch: 1.04, rasp: 0.40, sting: 'accordion' },
    power: 6, speed: 6, armRate: 4, colors: { shirt: 0x3b5ea0, cap: 0x6a5747 },
  },

  {
    id: 'eugene',
    name: 'Eugene Marshall', nick: 'Ears', tag: '', call: 'EU-GENE! EUGENE MARSHALL!',
    age: 11, sex: 'b', home: 'Black',
    rep: 'Has a pigeon. The pigeon has opinions.',
    stats: { power: 2, contact: 3, speed: 3, arm: 3, fielding: 4, nerve: 3 },
    stance: { name: 'the low crouch', note: 'Crouched so low the pitcher throws high to him and hates every second of it.' },
    arm: { quirk: 'Hides the ball behind his hip until the last instant. The pigeon gives it away.' },
    say: { picked: 'BOY OH BOY!', passed: 'Chase yourself.', hit: 'ATTA WAY!', field: 'I GOT IT! I GOT IT!' },
    charm: 'Will not field with a cap on. There is no cap. It will not stay on.',
    secret: { label: 'WRONG BASE, EVERY TIME', text: 'Catches everything on this block and throws it to the wrong base with total confidence.' },
    quirk: { id: 'lookout', name: 'EARS', desc: 'Hears the whistle a block off, so his side scatters early and is playing again before the cop is past the hydrant.' },
    owns: null, captain: false, title: '',
    accent: 'teal',
    art: {
      id: 'eugene', name: 'Eugene Marshall', nick: 'Ears', sex: 'b', fam: 'ears',
      skin: 5, hair: 0, accent: 'teal', slot: 'vest', prop: 'pigeon',
      pose: 'ready', team: 0, ex: 'grin', quirk: { browThick: 1.1 },
    },
    voice: { pitch: 1.12, rasp: 0.24, sting: 'cornet' },
    power: 4, speed: 6, armRate: 6, colors: { shirt: 0x2e6e6e, cap: 0x3c4353 },
  },

  {
    id: 'ethel',
    name: 'Ethel Randolph', nick: 'Speed', tag: '', call: 'ETH-EL! ETHEL LOUISE!',
    age: 12, sex: 'g', home: 'Black',
    rep: 'Named at six for being the slowest on the block. The name stayed. She did not.',
    stats: { power: 3, contact: 4, speed: 4, arm: 3, fielding: 3, nerve: 2 },
    stance: { name: 'dead still', note: 'Nothing on her moves until the hands do, and then all of it does.' },
    arm: { quirk: 'Windmills the arm twice before she sets. Twice. Even in the field.' },
    say: { picked: 'BOY OH BOY!', passed: 'Banana oil.', hit: "THAT'S THE STUFF!", field: 'WAY BACK! WAY BACK!' },
    charm: 'Runs the long way round the manhole. Every time. Even on a walk.',
    secret: { label: 'WILL NOT SLIDE', text: 'Will not slide. Has never once had to.' },
    quirk: { id: 'extra', name: 'NEVER STOPS AT ONE', desc: 'Rounds the base without looking at it and takes the next one, and she has never once had to slide for it.' },
    owns: null, captain: false, title: '',
    accent: 'mustard',
    art: {
      id: 'ethel', name: 'Ethel Randolph', nick: 'Speed', sex: 'g', fam: 'ribbon',
      skin: 5, hair: 0, accent: 'mustard', slot: 'ribbon', hairStyle: 'puff',
      prop: null, pose: 'sprintset', team: 0, ex: 'determined', quirk: { browThick: 1.1 },
    },
    voice: { pitch: 1.20, rasp: 0.20, sting: 'banjo' },
    power: 6, speed: 9, armRate: 6, colors: { shirt: 0xe3a32b, cap: 0x6b6154 },
  },

  {
    id: 'jesus',
    name: 'Jesus Colon', nick: 'Cheech', tag: '', call: 'JE-SUS! ARRIBA!',
    age: 10, sex: 'b', home: 'Puerto Rican',
    rep: 'No shoes since June. Claims it is faster. It is faster.',
    stats: { power: 2, contact: 3, speed: 4, arm: 2, fielding: 3, nerve: 4 },
    stance: { name: 'the waggle', note: 'Stick waggling, feet never still, talking the entire time the pitcher is winding up.' },
    arm: { quirk: 'Bounces the ball off the Belgian block once before every pitch, just to hear it.' },
    say: { picked: 'DALE! DALE!', passed: 'Aw, ya bum.', hit: 'SOME WALLOP!', field: 'MOVE IT! MOVE IT!' },
    charm: 'Spits in his palms, rubs them, then wipes them on the same spot of his knickers.',
    secret: { label: 'GOES ON THE SECOND LOOK', text: 'Steals on the pitcher’s second look, every time, and the pitchers keep taking a second look.' },
    quirk: { id: 'headfirst', name: 'NO SHOES, NO BRAKES', desc: 'Goes in flat out on the close ones at first and beats the throw more often than he has any right to.' },
    owns: null, captain: false, title: '',
    accent: 'tan',
    art: {
      id: 'jesus', name: 'Jesus Colon', nick: 'Cheech', sex: 'b', fam: 'barefoot',
      skin: 4, hair: 0, accent: 'tan', slot: 'suspenders', prop: 'slingshot',
      pose: 'scratch', team: 1, ex: 'grin', quirk: { tongue: 'R' },
    },
    voice: { pitch: 1.28, rasp: 0.26, sting: 'guiro' },
    power: 4, speed: 9, armRate: 4, colors: { shirt: 0xa85e2a, cap: 0x6a5747 },
  },

  {
    id: 'luz',
    name: 'Luz Ortiz', nick: 'Lefty', tag: 'THE BIG ONE', call: 'LUZ! LU-CE-SI-TA!',
    age: 12, sex: 'g', home: 'Puerto Rican',
    rep: 'Plants the crutch, and then the ball is already past you.',
    stats: { power: 2, contact: 3, speed: 1, arm: 4, fielding: 4, nerve: 4 },
    stance: { name: 'the planted crutch', note: 'Front foot down, crutch under the back arm, and the swing is all shoulders.' },
    arm: { quirk: 'The windup every kid on this block has tried to copy. Not one of them has got it.' },
    say: { picked: 'ABOUT TIME.', passed: 'Suit yourself.', hit: 'AND HOW!', field: 'RIGHT HERE! RIGHT HERE!' },
    charm: 'Sets the crutch in the same square of bluestone. If an ash can is on it, the ash can moves.',
    secret: { label: 'EVERY BASE, SAME SQUARE', text: 'Has thrown out a runner at every base on this block, home included, without leaving that one square of bluestone.' },
    quirk: { id: 'southpaw', name: 'THE PLANTED CRUTCH', desc: 'First time through the order, nobody picks the ball up out of that windup.' },
    owns: null, captain: false, title: 'BEST ARM ON THE BLOCK',
    accent: 'periwinkle',
    art: {
      id: 'luz', name: 'Luz Ortiz', nick: 'Lefty', sex: 'g', fam: 'brace',
      skin: 3, hair: 0, accent: 'periwinkle', slot: 'ribbon', hat: 'none', hairStyle: 'braids',
      prop: null, pose: 'crutch', team: 0, ex: 'smug', dh: 0.05,
    },
    voice: { pitch: 1.14, rasp: 0.22, sting: 'cuatro' },
    power: 4, speed: 2, armRate: 10, colors: { shirt: 0x5c6bb0, cap: 0x5b4436 },
  },

  {
    id: 'ling',
    name: 'Chin Yuk-ling', nick: 'Lefty', tag: 'THE OTHER ONE', call: 'LING! AH-LING!',
    age: 10, sex: 'g', home: 'Chinese',
    rep: 'Best pair of hands on the block, and the only kid allowed up on the roof.',
    stats: { power: 1, contact: 3, speed: 3, arm: 3, fielding: 4, nerve: 3 },
    stance: { name: 'crowding the plate', note: 'Crowds the plate until the pitcher backs off the manhole, then crowds it again.' },
    arm: { quirk: 'Wipes the ball on her sleeve first, out of pure habit, and hands it back cleaner than she got it.' },
    say: { picked: 'RIGHT HERE!', passed: 'Suits me.', hit: 'OFF THE WALL!', field: 'PLAY IT OFF THE WALL!' },
    charm: 'Will not start until the line above the street is clear. It is her mother’s line.',
    secret: { label: 'NEVER COMES BACK WITH ONE', text: 'Every ball on a roof is hers to fetch, and she has never once come back down with only the one.' },
    quirk: { id: 'spit_shine', name: 'HANDS IT BACK CLEANER', desc: 'Wipes every ball on her sleeve out of habit, and on her side nothing squirts loose.' },
    owns: null, captain: false, title: '',
    accent: 'bottleGreen',
    art: {
      id: 'ling', name: 'Chin Yuk-ling', nick: 'Lefty', sex: 'g', fam: 'sack',
      skin: 2, hair: 0, accent: 'bottleGreen', slot: 'sweater', hat: 'none', hairStyle: 'bob',
      prop: 'cards', pose: 'sleeves', team: 1, ex: 'neutral', dh: -0.04, scale: 0.94,
      quirk: { eyeSize: 1.08 },
    },
    voice: { pitch: 1.32, rasp: 0.12, sting: 'erhu' },
    power: 2, speed: 6, armRate: 6, colors: { shirt: 0x2f7f63, cap: 0x4a3b2e },
  },

  {
    id: 'maureen',
    name: 'Maureen Sheehan', nick: 'Duchess', tag: '', call: 'MAUREEN! INSIDE, PLEASE.',
    age: 11, sex: 'g', home: 'Irish',
    rep: 'Her father is on the beat. When the cop turns the corner, everybody looks at her.',
    stats: { power: 3, contact: 3, speed: 2, arm: 2, fielding: 4, nerve: 1 },
    stance: { name: 'textbook', note: 'Textbook. She read a book.' },
    arm: { quirk: 'Will not throw until everybody is set. Everybody is never set.' },
    say: { picked: 'Thank you.', passed: 'That is quite all right.', hit: 'NICE GOING!', field: 'TIME! TIME!' },
    charm: 'Real Keds, and she will not play the gutter side of the street in them.',
    secret: { label: 'ONE WHISTLE ENDS IT', text: 'One whistle from the corner and the game is over. She is the only one not scared of him and the only one who will not use it.' },
    quirk: { id: 'boughten', name: 'THE BOUGHTEN BAT', desc: 'A real store-bought bat, brought out for her at-bats only and carried home again after.' },
    owns: null, captain: false, title: '',
    accent: 'plum',
    art: {
      id: 'maureen', name: 'Maureen Sheehan', nick: 'Duchess', sex: 'g', fam: 'bandbox',
      skin: 0, hair: 5, accent: 'plum', slot: 'ribbon', hat: 'none', hairStyle: 'bob',
      prop: null, pose: 'tidy', team: 0, ex: 'smug', dh: 0.04, quirk: { freckles: 1 },
    },
    voice: { pitch: 1.24, rasp: 0.08, sting: 'celesta' },
    power: 6, speed: 4, armRate: 4, colors: { shirt: 0x7b4a8c, cap: 0x3c4353 },
  },

  {
    id: 'tommy',
    name: 'Tommy Fitzgerald', nick: 'Tiny', tag: '', call: 'THOMAS! THOMAS FITZGERALD!',
    age: 13, sex: 'b', home: 'Irish',
    rep: 'Named Tiny at four and has been growing out of it ever since.',
    stats: { power: 4, contact: 1, speed: 2, arm: 4, fielding: 2, nerve: 3 },
    stance: { name: 'the knob and the heels', note: 'One hand down at the knob, one foot out of the box, swinging from the heels at everything thrown.' },
    arm: { quirk: 'Throws so hard the catcher stands all the way up and backs off two steps.' },
    say: { picked: 'ATTABOY!', passed: 'So’s your old man!', hit: 'WAY BACK! WAY BACK!', field: 'LEMME HAVE IT!' },
    charm: 'Never bats in shoes. Says he can feel the block through his feet.',
    secret: { label: 'THE TWO-SEWER, ONCE', text: 'Hit two sewers exactly once, in front of nobody at all, and mentions it about four times an inning.' },
    quirk: { id: 'wallop', name: 'OFF THE HANDLE ANYWAY', desc: 'Gets a piece of it wrong and it still goes somewhere. He swings from the heels at everything thrown.' },
    owns: null, captain: false, title: '',
    accent: 'red',
    art: {
      id: 'tommy', name: 'Tommy Fitzgerald', nick: 'Tiny', sex: 'b', fam: 'barefoot',
      skin: 0, hair: 3, accent: 'red', slot: 'suspenders', prop: 'newspaper',
      pose: 'slouch', team: 1, ex: 'neutral', dh: 0.10, scale: 1.14, quirk: { freckles: 2 },
    },
    voice: { pitch: 0.84, rasp: 0.62, sting: 'bass_drum' },
    power: 9, speed: 4, armRate: 9, colors: { shirt: 0xc8402f, cap: 0x6a5747 },
  },
];

/* ============================================================================
   Lookups
   ========================================================================= */

export const BY_ID = new Map(ROSTER.map((k) => [k.id, k]));
export function getKid(ref) {
  if (!ref && ref !== 0) return ROSTER[0];
  if (typeof ref === 'number') return ROSTER[((ref % ROSTER.length) + ROSTER.length) % ROSTER.length];
  if (typeof ref === 'string') return BY_ID.get(ref) || ROSTER[0];
  return ref;
}

/** The two captains, by acclamation, in the order they are always named. */
export const CAPTAINS = ROSTER.filter((k) => k.captain).map((k) => k.id);

/** Everybody who has to be picked. */
export const POOL = ROSTER.filter((k) => !k.captain).map((k) => k.id);

/**
 * Titles the block hands out. These are facts about the roster, computed once so
 * the announcer and the team-select screen agree on who the mayor is.
 */
export const BLOCK = {
  bestHitter: 'filomena',
  bestArm: 'luz',
  fastest: 'dom',           // and nobody knows it
  loudest: 'bessie',
  owner: 'kathleen',        // owns the ball, therefore owns the afternoon
  stickHolder: 'sal',
  lastPicked: 'dom',
  legend: 'filomena',
};

/** Nicknames the block reuses. A shared name is a free joke (DESIGN-BIBLE §5.5). */
export const SHARED_NICKS = (() => {
  const m = new Map();
  for (const k of ROSTER) {
    const key = k.nick.toLowerCase();
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(k.id);
  }
  return [...m.entries()].filter(([, ids]) => ids.length > 1).map(([nick, ids]) => ({ nick, ids }));
})();

/* ============================================================================
   The play card — how a kid on this block turns into a batter, a fielder
   and an arm inside the rules core (src/game/core.js).
   ========================================================================= */

/**
 * The rules core was ported from a finished stickball engine whose cards ran 1..10
 * (docs/PORT-SPEC.md). Ours are chalk tallies, 1..4, and they are staying that way —
 * a kid is four marks on a curb, not a spreadsheet. This is the only bridge between
 * the two, and it is the one number to move if the soak test drifts off its baseline.
 *
 * It is not linear on purpose: a 4 is meant to be a kid the block talks about, so the
 * top mark is worth more than the step below it. Under this map our sixteen average
 * PWR 5.6 / CON 6.1 / SPD 5.8 / ARM 5.9 / GLV 6.3 against the 5.4 / 6.2 / 5.8 / 5.7 / 6.5
 * of the roster the engine was balanced on, which is why tools/soak.mjs lands on their
 * run-scoring baseline without touching a rule.
 */
export const PLAY_SCALE = [0, 2, 4, 6, 9];

/**
 * The twelve quirks the rules core knows about, and what each one actually does in
 * play. The mechanic ids come from the ported engine and are matched by string in
 * src/game/core.js — renaming one here silently turns it off, so rename the label
 * on the kid instead. Four kids carry `none`, which is a joke, not an oversight:
 * on a real block most kids are just a kid.
 */
export const QUIRKS = {
  three_sewers: { batting: true,  mech: 'A hit off better than 0.8 quality carries +0.22 — a full sewer farther.' },
  wallop:       { batting: true,  mech: 'Contact quality is floored at 0.45. Even the mishits leave the stick.' },
  eagle_eye:    { batting: true,  mech: '+3 EYE with two strikes, which widens every contact window.' },
  on_house:     { batting: true,  mech: '+1 EYE to every teammate at the plate while she is standing on a base.' },
  boughten:     { batting: true,  mech: '+1 WALLOP, permanently, because the lumber is store-bought.' },
  extra:        { running: true,  mech: '40% of the time a hit is stretched one base further.' },
  headfirst:    { running: true,  mech: '+0.05 on the race to first, which is most of a close play.' },
  spinner:      { pitching: true, mech: '+0.08 pitch quality. The hop breaks off the cobbles.' },
  southpaw:     { pitching: true, mech: '+0.12 pitch quality against a batter who has not faced him yet.' },
  rifle:        { pitching: true, mech: '+0.05 pitch quality for his pitcher while he is catching.' },
  spit_shine:   { fielding: true, mech: '+0.08 catch chance for every glove on his side.' },
  lookout:      { street: true,   mech: 'CHEESE IT! comes half as often (0.16 -> 0.08) and clears twice as fast.' },
  none:         { mech: 'Nothing the rules core reads. Most kids are just a kid.' },
};

/** Who carries each mechanic, computed from the roster so the two can never disagree. */
export const QUIRK_HOLDER = (() => {
  const m = {};
  for (const k of ROSTER) if (k.quirk && k.quirk.id !== 'none') m[k.quirk.id] = k.id;
  return m;
})();

/**
 * A kid's card as the rules core wants it: the five axes it reads, on its scale, plus
 * the quirk mechanic id. PWR/CON/SPD/ARM/GLV are named in the engine's shouty style so
 * a reader can diff src/game/core.js against docs/godot-reference/match_core.gd line by
 * line. NERVE is ours and the ported core does not read it yet.
 */
export function playCard(ref) {
  const k = getKid(ref);
  const s = k.stats;
  return {
    id: k.id,
    name: k.name,
    nick: k.nick,
    PWR: PLAY_SCALE[s.power],
    CON: PLAY_SCALE[s.contact],
    SPD: PLAY_SCALE[s.speed],
    ARM: PLAY_SCALE[s.arm],
    GLV: PLAY_SCALE[s.fielding],
    NERVE: PLAY_SCALE[s.nerve],
    quirk: k.quirk ? k.quirk.id : 'none',
    qname: k.quirk ? k.quirk.name : '',
    qdesc: k.quirk ? k.quirk.desc : '',
  };
}

/** Every kid as a play card, keyed by id — the dictionary MatchCore.setup() takes. */
export function playRoster(kids = ROSTER) {
  const out = {};
  for (const k of kids) out[k.id] = playCard(k);
  return out;
}

/** Sum of the six, for a rough "who is good" ordering. */
export function statTotal(kid) {
  const s = getKid(kid).stats;
  let t = 0;
  for (const key of STAT_KEYS) t += s[key];
  return t;
}

/**
 * What a captain thinks a kid is worth. Captains on a street pick in descending
 * order of who can hit (period §1.8), so hitting is weighted hard and nerve barely
 * counts — nobody has ever picked a kid for his nerve.
 */
export function pickValue(kid) {
  const k = getKid(kid);
  const s = k.stats;
  return s.power * 2.4 + s.contact * 2.6 + s.speed * 1.5 + s.arm * 1.2 + s.fielding * 1.0 + s.nerve * 0.4;
}

/**
 * Development guard, called once by the roster's consumers in dev. Returns a list of
 * broken house rules; an empty list is the pass condition. Kept as a function rather
 * than a console.warn at module scope because a console warning is a failed build.
 */
export function auditRoster() {
  const bad = [];
  const seen = new Set();
  for (const k of ROSTER) {
    if (seen.has(k.id)) bad.push(`${k.id}: duplicate id`);
    seen.add(k.id);
    const v = STAT_KEYS.map((s) => k.stats[s]);
    if (v.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_STAT)) bad.push(`${k.id}: stat out of 1..4`);
    if (!v.some((n) => n === 4)) bad.push(`${k.id}: nothing he is good at`);
    if (!v.some((n) => n <= 2)) bad.push(`${k.id}: nothing he is bad at`);
    if (k.age < 8 || k.age > 13) bad.push(`${k.id}: age off the block`);
    for (const f of ['rep', 'charm', 'name', 'nick', 'call']) if (!k[f]) bad.push(`${k.id}: no ${f}`);
    if (!k.secret || !k.secret.text) bad.push(`${k.id}: no secret`);
    if (!k.stance || !k.stance.name) bad.push(`${k.id}: no named stance`);
    if (!k.arm || !k.arm.quirk) bad.push(`${k.id}: no pitching quirk`);
    if (!k.say || !k.say.hit) bad.push(`${k.id}: nothing to yell`);
    if (!k.art || !k.art.fam) bad.push(`${k.id}: no silhouette family`);
  }
  const quirkSeen = new Map();
  for (const k of ROSTER) {
    if (!k.quirk || !k.quirk.id) { bad.push(`${k.id}: no quirk record`); continue; }
    if (!QUIRKS[k.quirk.id]) bad.push(`${k.id}: quirk "${k.quirk.id}" is not a mechanic the rules core reads`);
    if (!k.quirk.name || !k.quirk.desc) bad.push(`${k.id}: a quirk with nothing written on it`);
    if (k.quirk.id === 'none') continue;
    if (quirkSeen.has(k.quirk.id)) bad.push(`${k.id}: quirk "${k.quirk.id}" is already ${quirkSeen.get(k.quirk.id)}'s`);
    quirkSeen.set(k.quirk.id, k.id);
  }
  for (const q of Object.keys(QUIRKS)) {
    if (q !== 'none' && !quirkSeen.has(q)) bad.push(`quirk "${q}" belongs to nobody`);
  }
  const legends = ROSTER.filter((k) => STAT_KEYS.filter((s) => k.stats[s] >= 4).length >= 5);
  if (legends.length !== 1) bad.push(`there must be exactly one legend, found ${legends.length}`);
  const byHit = [...ROSTER].sort((a, b) => (b.stats.power + b.stats.contact) - (a.stats.power + a.stats.contact));
  const byArm = [...ROSTER].sort((a, b) => b.stats.arm - a.stats.arm);
  if (byHit[0].id === byArm[0].id) bad.push('best hitter and best arm must be different kids');
  if (!SHARED_NICKS.length) bad.push('at least one nickname must be shared');
  const fams = new Set(ROSTER.map((k) => k.art.fam));
  if (fams.size < 9) bad.push(`only ${fams.size} silhouette families on the block`);
  return bad;
}

export default ROSTER;
