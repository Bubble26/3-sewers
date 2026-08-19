/**
 * announcer.js — THE VOICE OF THE GAME.
 * ============================================================================
 * There is no PA system in 1925 and nobody broadcasts a stickball game, so our
 * announcers are two people who are physically present and audible on this block
 * (DESIGN-BIBLE §7.2). That is better than a booth in every way: the kids can
 * yell back at them, and they can be interrupted.
 *
 *   DOT      third floor front, fire escape, afternoon paper rolled into a
 *            megaphone, calling the game because she is not allowed down. Fast,
 *            bright, technically correct, relentlessly enthusiastic. She keeps
 *            the line score in chalk on her own windowsill. THE STRAIGHT MAN.
 *            She never acknowledges the joke. Not once, not ever.
 *
 *   THE GOOCH  an iceman on his break, on the tailgate of the wagon, tongs still
 *            in his hand. Brooklyn, deadpan, mellow where Dot is hot. Refers to
 *            himself in the third person and it is never explained. Undercuts
 *            his own bit immediately. HE IS THE ONE WHO IS FUNNY.
 *
 * The six writing rules (§7.2), which every line in this file obeys:
 *   1. Call the play STRAIGHT, then be strange ONE BEAT LATER.
 *   2. The non sequitur is about food, weather or personal cowardice. Never
 *      about baseball.
 *   3. He undercuts his own bit immediately.
 *   4. Third person, unexplained, forever.
 *   5. The straight man never blinks.
 *   6. The banter is load-bearing inside the fiction — Dot and the Gooch are
 *      neighbourhood figures the kids talk about, not a layer on top.
 *
 * And the two bans that shape every word (§8.3, §7.5): no joke is ever made of
 * anybody's ethnicity, accent, language, religion, poverty, body or brace; and
 * DIALECT IS A PERFORMANCE, NEVER A SPELLING — the accents live in the pitch,
 * rate and contour of the voice below, and not one line is written phonetically.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS IN HERE
 * ---------------------------------------------------------------------------
 *   BANK          the writing. ~430 lines, bagged so nothing repeats until its
 *                 category is exhausted, which no three-inning game can do.
 *   CHATTER       kid noise — infield encouragement, taunts, calling for the
 *                 ball, the argument about whether it was foul, and Junior, who
 *                 narrates his own at-bat in the third person.
 *   Mouth         one speaker: a queue of BEATS with real holds, so a call has
 *                 cadence — a build, a pause, and a punchline that lands late.
 *   Director      listens to the sim, chooses lines, escalates while a ball is
 *                 climbing, holds a silent beat before a close call, runs the
 *                 gags and drops a non sequitur when the street goes quiet.
 *   voicing       speechSynthesis where it exists, tuned per character; and a
 *                 synthesised vocal texture underneath it that works with no
 *                 audio device, no voices installed, and no network — which is
 *                 the only reason this is testable headlessly.
 *
 * The paper every line is printed on lives in src/ui/bubbles.js.
 * ============================================================================
 */
import { registerSystem, app as APP } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { T } from '../core/tuning.js';
import { ROSTER, BY_ID } from '../chars/roster.js';
import { ACCENTS } from '../render/palette.js';
import { bubbles } from '../ui/bubbles.js';
import {
  registerCue, formantVoice, VOWELS, burst, gain, chain, lp, hp, pk, shaper, clamp,
} from './sfx.js';

/* ============================================================================
   1. THE WRITING
   ---------------------------------------------------------------------------
   Tokens, filled at speak time:
     {B} the batter    {P} the pitcher   {F} whoever just made the play
     {S} strike, in words   {N} ball, in words   {O} outs, in words
   ========================================================================= */

const DOT = {
  /* --- who is up ------------------------------------------------------- */
  walkup: [
    '{B} steps in.',
    'Up next: {B}. Hands high, feet together.',
    '{B} to the plate, and the plate is a manhole cover.',
    'Here comes {B}. Everybody move up. Move UP.',
    '{B} is in. {P} has the ball and an idea about it.',
    'That is {B} digging in, on Belgian block, which does not dig.',
    '{B} steps in and the whole outfield takes one step back. One.',
    'Batting: {B}. And I want it on the record that I called this.',
    '{B} now. I have {him} down for nothing so far, and I keep an honest sill.',
    '{B} up, and the on-deck kid has already asked to go next.',
  ],

  /* --- the count ------------------------------------------------------- */
  strike_looking: [
    'Strike {S}, and the stick never moved.',
    'Called! Straight over the manhole.',
    'Right through the middle of the afternoon. Strike {S}.',
    '{He} looked at it. {He} is allowed to look at it. Strike {S}.',
    'Over the plate, over the cover, over {him}. Strike {S}.',
    'Took that one. Strike {S}, and I am chalking it.',
    'That is a strike on this block, and it would be a strike on any block.',
    'Strike {S}! {He} is still looking at where it was.',
    'Down the middle, {S}. {P} is enjoying this far too much.',
    '{He} watched it go by like a trolley {he} did not want.',
    'Strike {S}. Clean as a whistle and twice as loud.',
    'That is a strike and I do not care who is arguing about it.',
  ],
  strike_swinging: [
    'Swung and missed! Strike {S}.',
    '{He} went after it. It was not there. Strike {S}.',
    'Whiffed {him}! That is {S}.',
    'All the way around, and nothing on the end of it.',
    'Strike {S}, and {he} swung hard enough for two.',
    'Missed it by a foot and a half, and I measured.',
    'That swing had ambition. No accuracy. But ambition.',
    'Cut at it! Cut at it and got air. Strike {S}.',
    '{He} swung so hard {his} cap came off. The cap is fine.',
    'Strike {S}! {He} is telling everybody {he} had it timed.',
    'Nothing but wind, and the wind is off the river.',
    'Strike {S}. {P} did that on purpose and I have proof.',
  ],
  foul: [
    'Foul! Off the wall on the fly, and that is a strike here.',
    'Fouled it back. Off the fire escape, and it is coming down.',
    'Off the brick, and the brick wins. Foul.',
    'Straight up. Straight up, and everybody looks up.',
    'Foul ball. And the argument starts in three, two —',
    'That is foul by the rules of this street, which are the rules.',
    'Tipped it. Barely. The stick heard about it.',
    'Off the awning, and the awning is not happy.',
    '{He} got a piece. A very small piece.',
    'Foul, and Beans is already explaining why it was not.',
  ],
  ball: [
    'Ball {N}. Nowhere near the cover.',
    'That one went to the curb. Ball {N}.',
    'Wide. Ball {N}, and the catcher had to travel.',
    'Outside. {P} is aiming at something the rest of us cannot see.',
    'Ball {N}. That was thrown at the ash cans.',
    'High. Ball {N}. High enough for a second-floor window.',
    'In the dirt, which on this street is tar. Ball {N}.',
    'Ball {N}, and I want it noted that I called it before the catcher did.',
    'Off the plate by a foot. Ball {N}.',
    '{P} missed the manhole by the width of a manhole. Ball {N}.',
    'Ball {N}. Nobody swings at that, on this block or any other.',
    'Way inside. {He} stepped back and {he} was right to.',
  ],
  walk: [
    'Ball four! {B} takes {his} base, and the base is a chalk mark.',
    'That is a walk. {B} strolls down there taking {his} time about it.',
    'Four wide ones. {P} has lost the manhole entirely.',
    '{P} walks {him}. A free base, on a street where nothing is free.',
    'Ball four, and {B} did not swing once, which is a kind of genius.',
    'Walked. {P} is looking at that hand like it belongs to somebody else.',
  ],
  strikeout: [
    'Struck {him} out! Sit down, {B}.',
    'That is three. {B} is out, and the stick goes back to whoever owns it.',
    'Strike three! {P} has {him}, and knows it.',
    '{He} is out swinging. {He} is out, and {he} is explaining.',
    'Three strikes. That is out here, that is out anywhere.',
    'Got {him}! {P} does not smile. {P} never smiles.',
    'Strike three, and {B} is talking to the stick. The stick has no comment.',
    'Down on strikes. {He} will want that one back and {he} cannot have it.',
  ],

  /* --- outs and hits ---------------------------------------------------- */
  out: [
    'Caught it! {O} away.',
    '{F} takes it. Bare hands, no fuss. Out.',
    'Right at somebody. That is the worst luck on this street. Out.',
    'Squeezed it! {F} had that in both hands and one prayer.',
    'Two hands, no glove, and out {he} goes.',
    'Off the block, one hop, and {F} throws {him} out.',
    '{F} takes it on the fly and now wants everybody to know.',
    'That is out. And {B} is going to argue about it anyway.',
    'Fielded clean. {F} does not even look at the runner.',
    'Caught. And caught with the hands, which is the only way there is.',
    'Out! The block has one less runner and one more argument.',
    '{He} is out, and the ash can goes back where it was.',
  ],
  hit: [
    'Base hit! Right past everybody.',
    '{He} got it! Through the gap and up the street.',
    'Solid! That is a clean one and it is rolling for the corner.',
    'Base hit for {B}. {He} is safe and {he} is loud about it.',
    'Through the infield, which is four kids and a fire hydrant.',
    'That is a hit. That is a hit anywhere they play this.',
    'Off the block, past the ash cans, up the gutter. {He} is on.',
    '{He} put it where nobody was standing, which is the whole trick.',
    'Line drive! Nobody moved. Nobody could.',
    'That found the seam. Base hit.',
    'One hop off the tar and away it goes. Safe.',
    'Right up the middle. {P} did not even turn round.',
    'Base hit — and I am chalking that on my sill, in my own hand.',
    '{He} is on! And whoever wanted {him} last is very quiet now.',
  ],
  double: [
    'Two bases! Off the fender and away!',
    'Off the wall, and the carom beat everybody. {He} is standing on second.',
    'That is a double, and second base is a coal chute cover.',
    'Way past the outfield. {He} pulls up at second, easy.',
    'Off the truck and it went sideways. {He} has two.',
    'Rattled it off the ironwork! Two bases, and the ironwork is fine.',
    'Into the gutter and running. {He} is into second standing up.',
    'Two bases. The right fielder knew that fender kicks left. {He} forgot.',
  ],
  triple: [
    'Three bases! {He} is not stopping!',
    'All the way to the corner and {he} is still going. Triple!',
    'That is three. Three, and {he} is out of breath and delighted.',
    'Under the parked car and out the other side. {He} has three!',
    'Way, way up the block. {He} pulls into third and everybody yells at {him}.',
    'Three bases. Somebody go and get that ball. Somebody.',
  ],
  sewer: [
    'SEWER SHOT! Past the second casting, on the fly!',
    'That is TWO SEWERS! I saw it, and {his} mark goes on the curb!',
    'Gone! Over everything! {B} is a two-sewer man!',
    'That is out of here! Chalk it! Chalk {his} initial on the curb!',
    'GOODBYE! Goodbye down the block and goodbye out of this game!',
    'Two sewers for {B}. I keep the sill, and the sill says two!',
    '{He} got all of it! ALL of it! Somebody is going up on a roof!',
    'Past the second manhole on the fly, which here is the whole story!',
    'That ball is a block away and it is not coming back today!',
    '{He} hit that into next Thursday and I am marking it down as Thursday!',
  ],
  run: [
    'That is a run! Chalk it up. I am chalking it up.',
    '{He} scores! Across the plate, and the plate is a manhole {he} stamped on.',
    '{He} scores standing! And Beans is already saying the number out loud.',
    'One in. I have it, and my sill is not wrong.',
    'Home {he} comes. Somebody move the stick.',
    'That is a run, and they heard about it two streets over.',
    'In {he} comes, and the whole stoop is on its feet.',
    'A run scores, and I am out of chalk, and I am using it anyway.',
  ],

  /* --- the plays that get told about ------------------------------------ */
  great: [
    'What a catch! {F} had no business with that!',
    'Off the wall, off the hands, and {F} still has it!',
    '{F} went into the gutter for that. Into the gutter. On purpose!',
    'Bare hands, one hop, and the throw gets there from where {he} was standing!',
    'That is the play of the afternoon and there are innings left!',
    '{F} caught that with {his} back to it. {His} back to it!',
    '{He} went under the truck and came out with the ball!',
    'That is the best pair of hands on this block and everybody just found out!',
  ],
  error: [
    'Off the hands! Straight off the hands and into the ash cans!',
    '{He} had it. {He} had it, and then it had {him}.',
    'Dropped it! And {he} is looking at {his} hands like they lied to {him}.',
    'Right through {him}. Right through, and it is still rolling.',
    '{He} called for it. Twice. Then {he} did not catch it.',
    'Two of them went for it and neither one of them got it.',
    'Off the knee and out to the curb, and now everybody is running.',
    '{He} kicked it. Not on purpose. {He} kicked it a long way, though.',
  ],
  collision: [
    'They ran into each other! Both of them are on the ground!',
    'Pile up! Everybody get up. Everybody get UP.',
    'Two of them, one ball, one very small piece of street.',
    'Down they go, the ball is loose, and nobody is looking at it!',
    'Heads together. They are fine. The ball is not.',
    'That is what happens when everybody yells MINE at once.',
  ],

  /* --- the shape of the game -------------------------------------------- */
  between: [
    'That is the side. Everybody in, everybody out, somebody find the ball.',
    'Three out. Change over, and no, we are not stopping for that.',
    'Side retired. I am marking the sill: one line, one inning.',
    'That is the half. Somebody\'s mother is at a window and it is not mine.',
    'Inning over. The stick changes hands and the argument comes with it.',
    'Three away. Move the ash can back. That is second.',
    'End of the half, and Lefty is up on the roof again. She will be down.',
    'That side is done. There is a cart coming and we are letting it through.',
    'Three out. Nobody go home. Nobody has permission to go home.',
    'That is the inning. And I am still not allowed down.',
  ],
  lopsided: [
    'It is getting away from them, and I am obliged to say so.',
    'That is a lead you could park a wagon in.',
    'One side is having a lovely afternoon. The other side is having a Tuesday.',
    'It is not close, and pretending otherwise is not calling a game.',
    'They are so far ahead the little ones are batting again.',
    'If it stays like this, somebody is going to take the ball home.',
    'That is a very big lead on a very small street.',
    'I have chalked so many lines my sill has run out of sill.',
  ],
  close: [
    'One run in it, last inning, and nobody on this block is breathing.',
    'It is tied. It is tied and the light is going.',
    'Two out, the tying run on, and somebody\'s mother is at the window.',
    'One run. One inning. Do not let anybody call you in now.',
    'This is the part where the arguing gets serious.',
    'Close game, late, and that pink ball is getting hard to see.',
    'Nobody is going in for supper until this is settled.',
    'One run in it — and every kid out there just got very quiet.',
  ],

  /* --- the pause before a close call ------------------------------------ */
  close_call: [
    'Safe! {He} is SAFE and I saw the whole thing!',
    'OUT! Out by a step and a half!',
    '{He} is out. {He} is out, and here comes everybody.',
    'SAFE! And I will chalk that on the curb for anybody who wants to look.',
    'Got {him}! By nothing. By absolutely nothing.',
    'That is out and I am not taking questions.',
  ],

  /* --- the ball is climbing ---------------------------------------------- */
  climb: [
    ['That is UP —', '— that is way up —', '— that is going for the corner —'],
    ['He got that one —', '— and it is climbing —', '— and the pigeons are off the cornice —'],
    ['Up in the air —', '— nobody is under it —', '— somebody GET under it —'],
    ['That is hit —', '— and it is still going —', '— and it is over the wagon —'],
    ['Way back —', '— way BACK —', '— that is past the first casting —'],
  ],
  climb_down: [
    '— and it comes down about four feet from where it started.',
    '— and it lands in the ash cans. Everything lands in the ash cans.',
    '— and it is caught. Well. That was a lot of noise for nothing.',
    '— and it drops in the gutter and rolls back to {him}. The street gave it back.',
  ],

  /* --- Dot's own business ------------------------------------------------ */
  sill: [
    'Hold it. Hold everything. I have to chalk this.',
    'One moment. My sill is full and I am starting a second column.',
    'I keep the line score up here in chalk and it has never once been wrong.',
  ],
  not_allowed: [
    'I am not discussing why I am up here.',
    'I can see everything from here, which is the point, and I did not do it.',
  ],
};

const GOOCH = {
  after_strike: [
    'The Gooch would have swung at that. The Gooch would have missed it.',
    'In there like the rent. Right on time, and nobody wanted it.',
    'That is a good pitch. The Gooch does not say that often. The Gooch has now said it.',
    '{He} never moved. The Gooch respects a man who does not move. The Gooch does not move.',
    'Ooh. That one had a little something on it. Or the wind did.',
    'That is one. There are two more where that came from. Allegedly.',
    'The Gooch has seen better. The Gooch has also seen worse, and worse was Tuesday.',
    'Right over the iron. You could set a watch by it, if you had a watch.',
    'That is what they call a hummer. The Gooch calls it a Tuesday.',
    '{He} is going to tell you {he} was taking all the way. {He} was not taking all the way.',
  ],
  after_ball: [
    'That was thrown at nobody in particular.',
    'The Gooch has a cousin who throws like that. The Gooch avoids him.',
    'Wide. But wide with feeling.',
    'You could get an egg cream from where that landed.',
    'That pitch went over to the curb to think about things.',
    'Some of them are strikes and some of them are travel.',
    'That one had the right idea and the wrong street.',
    'The Gooch is not going to criticize. The Gooch just did.',
  ],
  after_out: [
    'Caught. The Gooch could not have caught that. The Gooch does not catch things.',
    'Bare hands. In September. In January that is a different conversation.',
    '{He} is out, and {he} is going to be out about it for a while.',
    'That is one gone. Two more and the Gooch gets his tailgate back.',
    'Two hands. Nobody does that any more, except everybody here.',
    'Out. And here comes the arguing, right on schedule, like the El.',
    'The Gooch likes that. The Gooch is easy to please and hard to impress.',
    'Good hands. The Gooch has hands like a pair of tongs. That is not praise.',
    '{He} is out. {His} mother will hear about it before {he} gets upstairs.',
    'That is the third one. The Gooch is going to go and stand somewhere else.',
  ],
  after_hit: [
    'Base hit. The Gooch is going to allow it.',
    'That is a hit, and the Gooch will have one of those, thank you.',
    '{He} hit that like it owed {him} money.',
    'Through the middle. There was nobody in the middle. There is a lesson there.',
    'The Gooch is loving that.',
    'Sweet. Sweet like a hot sweet potato off a cart. The Gooch likes those. Everybody does.',
    '{He} put it in the one place nobody was. Genius, or Tuesday.',
    'Somebody is going to have to go and get that.',
    'A clean hit. The Gooch does not use the word clean lightly. On account of the wagon.',
    'Look at {him} go. The Gooch has not moved like that since the war, and the Gooch was not in the war.',
  ],
  after_sewer: [
    'Two sewers. The Gooch measured. The Gooch measures ice, but the principle holds.',
    'That is gone. That is somebody\'s window\'s problem now.',
    'The Gooch saw that whole thing and the Gooch is going to need a minute.',
    'A block and a half. The Gooch is estimating. The Gooch estimates for a living.',
    'Nobody is getting that back before dark, and the Gooch is not looking for it.',
    'Two sewers here. On the next street over that is nothing. The Gooch has been over there.',
    'That went clean over the wagon. The wagon has been through a lot today.',
    'You know what that was. That was a wallop. The Gooch enjoys a wallop.',
  ],
  after_error: [
    'Off the hands. It happens. It happens to the Gooch daily.',
    '{He} had it, and then the ball had opinions.',
    'Dropped. The Gooch would like the record to show that he said nothing.',
    'The Gooch has dropped a hundred pounds of ice on his own foot. The Gooch will not say one word.',
    'Right through {him}. Like the Gooch through a screen door.',
    '{He} is going to blame the sun. There is no sun on that side of the street.',
    'That is going to come up at supper.',
    'The ball did that on purpose. The Gooch is being generous. It did not.',
  ],
  after_great: [
    'The Gooch would not have gone into that gutter for money. The Gooch has been offered money.',
    'That was very good. The Gooch is annoyed about how good that was.',
    'Look at that. The Gooch is going to think about that at four in the morning.',
    'The Gooch has never dived for anything except cover.',
    'Bare hands off the brick. The Gooch is going to need to sit down, and the Gooch is sitting down.',
    'That is the best thing that has happened on this street since the bakery opened.',
  ],
  after_collision: [
    'Pile up! Everybody jump on!',
    'Two kids, one ball. The arithmetic was never going to work.',
    'The Gooch has never run into anybody. The Gooch has never run.',
    'They are fine. The street is fine. The ball is at the curb, laughing.',
  ],
  between: [
    'Three out. The Gooch is going to go and check on the ice.',
    'Change over. The Gooch has not moved and does not intend to.',
    'Half an inning. That is about nine pounds of ice, if anybody is counting. Nobody is.',
    'The Gooch is going to eat something now. The Gooch is not going to say what.',
    'That is the side. The Gooch would like to point out that the shade is going.',
    'Inning over. Somebody go and tell the horse.',
    'Break. The Gooch is going to sit here and be cold at people.',
    'Everybody swap. The Gooch stays where he is, which is the whole idea of a break.',
    'That is three. The Gooch is going to have a think about the weather.',
    'Time. The Gooch is enjoying this more than he lets on. That is not difficult.',
  ],
  /* Food, weather, personal cowardice. Never baseball. (§7.2 rule 2) */
  nonseq: [
    'The Gooch had an egg cream at eleven o\'clock and has thought about nothing else since.',
    'It is going to rain Thursday. The Gooch has a knee, and the knee is never wrong.',
    'There is a man on Second Avenue selling chestnuts. In September. In SEPTEMBER.',
    'The Gooch does not go up on roofs. The Gooch has never explained this and is not going to.',
    'A hot sweet potato off a cart. That is what is good. That is all the Gooch has to say.',
    'Somebody on three is frying peppers and it is not helping anybody down here.',
    'The wind is off the river. The Gooch can smell the river. The Gooch would rather not.',
    'The Gooch is afraid of that dog. Everybody is afraid of that dog. The dog knows.',
    'It was ninety-one degrees on Sunday. Ask the Gooch how the Gooch knows. Go on.',
    'There is a bakery on that corner and at four o\'clock it is unbearable.',
    'The Gooch does not care for heights, ladders, roofs, or fire escapes. Or stairs.',
    'You can get a whole pickle for a penny two blocks from here. A whole one.',
    'It will be cold early this year. The Gooch looks forward to it professionally and dreads it personally.',
    'The Gooch does not eat clams. The Gooch has reasons and the reasons are private.',
    'That cloud has been sitting there since two o\'clock doing nothing. The Gooch respects that.',
    'A cup of coffee and a jelly doughnut. The Gooch is not asking much out of life.',
    'The Gooch would not go down that alley for a dollar. The Gooch has been offered less.',
    'The horse has had a better day than the Gooch, and the horse has done more work.',
    'The Gooch likes candy. Everybody likes candy. This is not a controversial position.',
    'It smells like rain. It always smells like rain to the Gooch. The Gooch is wrong most of the time.',
    'There is a woman on the second floor who makes a soup. The Gooch has never had the soup. The Gooch thinks about the soup.',
    'The Gooch was chased by a goose as a boy. That is the whole story. There is no more of it.',
    'Ice does not keep. That is the trouble with ice. That is the entire trouble with ice.',
    'If it thunders, the Gooch is going indoors, and nobody is to make anything of it.',
    'The Gooch had a plum this morning. The Gooch would like everyone to know it was a good plum.',
    'Cold coming off that wagon and the Gooch is still warm. Explain that to the Gooch.',
  ],
};

/* --- the running gags. Setup frame, payoff frame, and the seconds between
       them, exactly as §8.2 requires. Each one escalates across the game. --- */
const GAGS = {
  /** The stolen apple that travels from kid to kid all game and is never eaten. */
  apple: [
    'Somebody out there has an apple. Nobody has bitten the apple.',
    'The apple is with the catcher now. Still nobody has bitten it.',
    'That apple has changed hands four times and it is not even bruised.',
    'The apple is on the stoop, having a better afternoon than most of us.',
    'The apple has now been on both teams.',
    'Somebody finally bit the apple. It was the horse.',
  ],
  /** Forty pounds of ice, and the Gooch is watching it go. */
  ice: [
    'Fifty pounds on that wagon when the Gooch sat down.',
    'Forty-four pounds. The Gooch is watching his own money run into the gutter.',
    'Thirty-nine pounds and one puddle.',
    'The Gooch is now, technically, in the water business.',
    'There is no ice. There is a wagon and a rumour.',
  ],
  /** Eleven days and nobody will say what she did. She never acknowledges it. */
  grounded: [
    'Eleven days she has been up on that fire escape. Nobody will say what she did.',
    'Twelve days. The Gooch has a theory. The Gooch is keeping the theory.',
    'The Gooch asked her mother about it. The Gooch is not asking again.',
    'Whatever she did, she did it thoroughly. That is all the Gooch will say.',
  ],
};

/* The canonical two-hander, once a game, played absolutely straight (§7.2). */
const TWO_HANDERS = [
  [['dot', 'Say hello, Gooch.'], ['gooch', 'Hello, Gooch.']],
  [['dot', 'How is the ice.'], ['gooch', 'The ice is a memory.'], ['dot', 'Ball two.']],
  [['gooch', 'Beans says it is four to three.'], ['dot', 'Beans is never wrong.'], ['gooch', 'That is not the same as honest.']],
  [['gooch', 'Eleven days up there and nobody will say what she did.'], ['dot', 'Strike one.']],
];

/* --- one unique reference line per kid, per announcer (§7.2 line inventory).
       Every one of them is read straight off that kid's roster entry: the rep,
       the charm, the secret. The announcers know their names AND their deals. */
const KID_LINES = {
  sal: {
    dot: 'Socks Marino. He owns the stick, so he bats first, and he will explain to you why that is fair.',
    gooch: 'Nine rubs on the ball before he throws it. Nine. The Gooch counted once and never recovered.',
  },
  kathleen: {
    dot: 'Legs Doyle. She owns the ball, which means she owns the score, the argument, and the hour we stop.',
    gooch: 'She says out loud what she is about to throw, and then throws it. The Gooch finds that unsporting and effective.',
  },
  filomena: {
    dot: 'Fanny Greco. Nine years old, four foot nothing, and nobody has ever picked her second.',
    gooch: 'The Gooch has watched this one all summer. The Gooch has notes. The notes say: do not.',
  },
  dom: {
    dot: 'Junior Marino. He comes with the stick, whether you wanted him or not.',
    gooch: 'Nobody has ever tagged that kid out. Nobody has ever put him on, either. The Gooch is just saying.',
  },
  irving: {
    dot: 'Skinny Lefkowitz. Six feet of elbows, and two of them are usually in your way.',
    gooch: 'Let it reach him on one hop and he throws out anybody in New York. On the fly he is a coat rack.',
  },
  bessie: {
    dot: 'Beans Katz. She runs the argument, and she has never once been on the losing end of one.',
    gooch: 'She keeps the score in her head, out loud, and she is never wrong. Never wrong is not the same as honest.',
  },
  rose: {
    dot: 'Rosie Abramowitz. Two years of piano lessons, and every hour of it went into her wrists.',
    gooch: 'She will foul off eleven pitches until your arm quits. The Gooch does not believe that is an accident.',
  },
  otto: {
    dot: 'Melon Bauer. The cap does not fit and he will not discuss it.',
    gooch: 'Four bars of harmonica between innings. Only four. The Gooch has waited years for the fifth.',
  },
  stash: {
    dot: 'Stash Kowalski. Best kid on this block for two innings. His mother owns the third.',
    gooch: 'Third floor, second window. When that opens, this is over. The Gooch keeps an eye on it.',
  },
  eugene: {
    dot: 'Ears Marshall. Best hands out there, and the pigeon comes with him.',
    gooch: 'He catches everything and throws it to the wrong base with total confidence. The Gooch admires the confidence.',
  },
  ethel: {
    dot: 'Speed Randolph. They named her Speed at six for being the slowest on the block. The name stayed. She did not.',
    gooch: 'Nobody here will explain that name, and the Gooch has stopped asking.',
  },
  jesus: {
    dot: 'Cheech Colon. No shoes since June. He says it is faster. It is faster.',
    gooch: 'He goes on your second look. So do not take a second look. Everybody takes a second look.',
  },
  luz: {
    dot: 'Lefty Ortiz. Best arm on this block, and she has thrown out a runner at every base on it.',
    gooch: 'There are two Lefties here. This is the big one. That is all the Gooch is prepared to say about that.',
  },
  ling: {
    dot: 'Lefty Chin. Best pair of hands here, and the only one allowed up on the roof.',
    gooch: 'Every ball on a roof is hers to fetch, and she has never once come back down with only the one.',
  },
  maureen: {
    dot: 'Duchess Sheehan. Textbook stance. She read a book.',
    gooch: 'Her father is on the beat. When the cop turns that corner everybody looks at her. She looks back.',
  },
  tommy: {
    dot: 'Tiny Fitzgerald. Named Tiny at four and growing out of it ever since.',
    gooch: 'He hit two sewers once, in front of nobody at all, and mentions it four times an inning. This is one.',
  },
  /* the seven kids who are on the street but not on the card — the announcers
     know them too, and say only what anybody watching can see */
  rocco: {
    dot: 'Rocky Panzera behind the plate, arms folded, waiting for somebody to be wrong.',
    gooch: 'That kid has caught bare-handed all summer and has not mentioned it once. The Gooch respects that.',
  },
  butch: {
    dot: 'Butch Boyd. He has had that deck of cards in his pocket since June.',
    gooch: 'He is playing this game and another game at the same time and he is winning both.',
  },
  herman: {
    dot: 'Stretch Muller out there, taking up most of the left side of the street.',
    gooch: 'The Gooch has seen that kid reach a second-floor line without a ladder. The Gooch cannot use a ladder.',
  },
  sidney: {
    dot: 'Half-Pint Adler in short right, and short right is where they put you.',
    gooch: 'Everything gets hit at that kid. Everything. The Gooch would like somebody to look into it.',
  },
  connie: {
    dot: 'Connie Ruffo, who has been holding that jar all afternoon and will not say what is in it.',
    gooch: 'The Gooch asked what was in the jar. The Gooch was told. The Gooch is sorry he asked.',
  },
  peggy: {
    dot: 'Peanuts Nolan. Loudest kid on this street and I am shouting through a newspaper.',
    gooch: 'You can hear that one from the avenue. The Gooch has heard that one from the avenue.',
  },
  gertie: {
    dot: 'Gertie Vogel. She has not said a word all game and has not missed a thing.',
    gooch: 'The quiet one. The Gooch is quiet too. The Gooch is quiet at people.',
  },
};

/* ============================================================================
   2. KID CHATTER
   ---------------------------------------------------------------------------
   Its own bus, its own bank, firing every 2-5 seconds under the announcers
   (§7.5). Every line is period vernacular from PERIOD-REFERENCE §1.9 or written
   to sit next to it. Nothing in here is spelled phonetically.
   ========================================================================= */

const CHATTER = {
  /* infield noise: encouragement to your own pitcher */
  infield: [
    'Chuck it here!', 'Right here! Right here!', 'Put it over!', 'Little easy now.',
    'No batter! No batter!', 'Nothing on {him}!', '{He} cannot hit it!', 'One more like that!',
    'Come on, pitch it!', 'Two down! Two down!', 'Hummer! That is a hummer!',
    'Take your time. Take all day.', 'Right in there!', 'Attaboy!',
    '{He} is scared of it!', 'Two more and we are out of here!',
  ],
  /* needling the batter */
  taunt: [
    'Swing, ya bum!', 'Choke up!', 'You could not hit the ash can!',
    'Hold the stick the other way!', 'Move in! Everybody move IN!',
    'Way in! {He} cannot reach the curb!', 'Easy out! Easy out!',
    '{He} always swings at the first one. Watch.', '{He} shuts {his} eyes! I saw {him} shut {his} eyes!',
    'Whiffed {him}!', 'Do not hurt yourself.', 'Your mother is at the window!',
    'That is a fine stance. That is a beautiful stance. Now hit something.',
    '{He} is going to whiff. I called it. I called it out loud.',
  ],
  /* the batter answers, because on this street the batter always answers */
  back: [
    'Sez who!', 'Says you!', 'So\'s your old man!', 'Applesauce!', 'Banana oil!',
    'Chase yourself.', 'Beat it.', 'Just throw it.', 'Ah, ya bum.',
    'I am going to hit this over your head.', 'Watch the second sewer. Watch it.',
    'Keep talking. Keep talking.',
  ],
  /* somebody calling for the ball, which is half of all stickball noise */
  call: [
    'I got it! I got it!', 'It\'s mine! Mine!', 'Let me have it!', 'Mine! Mine! MINE!',
    'Right here! Right here!', 'Play it off the wall!', 'Off the fender!',
    'Way back! Way back!', 'Heads up!', 'Out of the way!', 'Hold it! HOLD IT!',
    'I got it — I have NOT got it!', 'Under the truck! It went under the truck!',
    'Take it! Take it! TAKE IT!',
  ],
  /* approval, straight off the period bank */
  cheer: [
    'Attaboy!', 'And how!', 'You said it!', 'Some wallop!', 'Oh, you kid!',
    'Hot socks!', 'That\'s the stuff!', 'Nice going!', 'Boy oh boy!', 'Duck soup!',
    'Atta way!', 'Swell!', 'Two sewers, easy!', '{He} is a two-sewer man!',
  ],
  groan: [
    'Aw, nuts.', 'Ah, ya bum.', 'No fair!', 'Oh, come ON.', 'That is the third time.',
    'I almost had it!', 'Applesauce.', 'That was mine. That was MINE.',
  ],
  ghost: [
    'Ghost man on second!', 'Ghost man on second, and he is fast!',
    'There is no ghost man. You made him up.', 'Ghost man scores!',
    'The ghost man does not score on that and you know it.',
    'Two ghost men now. That is too many ghost men.',
  ],
  stoppage: [
    'CAR!', 'CAR! CAR!', 'HEADS UP!', 'CHEESE IT!', 'SEWER!', 'TIME!', 'DO OVER!',
    'HOLD IT!', 'MOVE IT!', 'OUT OF THE WAY!',
  ],
};

/**
 * The argument about whether it was foul. Every one is a setup, a beat, and a
 * loser — §8.1 says the argument is the engine the whole comedy runs on, and it
 * is settled by volume, then seniority, then by who owns the ball.
 */
const ARGUMENTS = [
  ['It was foul!', 'It was over!', 'It was foul. I have the ball.'],
  ['That hit the wall on the fly!', 'It hit the sign!', 'The sign is ON the wall.', 'Do over.'],
  ['You\'re blind!', 'Sez who!', 'Everybody!', 'Do over.'],
  ['That is a ground rule double!', 'Says who!', 'Says the rules!', 'Whose rules!', 'Mine. I brought the ball.'],
  ['Off the stoop and out is live!', 'Dead ball!', 'It is live on Mulberry!', 'We are not on Mulberry.'],
  ['Foul!', 'Fair!', 'FOUL!', 'FAIR!', 'TIME. Everybody. TIME.'],
  ['He was out by a mile!', 'He was safe by a mile!', 'It cannot be both a mile.', 'Do over.'],
  ['You stepped off!', 'I never!', 'I saw you step off!', 'You were looking at a pigeon!'],
];

/**
 * Junior. Eight years old, narrating his own at-bat in the third person, out
 * loud, because nobody else is going to. He is the last kid picked and he is
 * having the best afternoon of anybody on this street (§8.3: never pathos).
 */
const NARRATOR = [
  '{ME} steps in.',
  '{ME} is looking for the fast one.',
  'Here is the pitch to {ME}.',
  '{HE} fouled that off. {HE} meant to do that.',
  'The crowd is going wild. The crowd is me.',
  'Strike one. That was a bad call.',
  'Ball two! {ME} has a good eye!',
  '{HE} digs in. {HE} digs in a lot.',
  '{ME} has a plan. The plan is to swing.',
  '{ME} has never been tagged out. Nobody knows that.',
  '{HE} is going to hit this one two sewers.',
  'That is a ball. I am taking my base.',
  '{ME} is the fastest kid on this block. It is a fact and nobody has looked into it.',
  'And the little kid comes through. The little kid always comes through.',
  '{ME} is not going in for supper. {ME} has not been called.',
];

/* Tiny mentions his one two-sewer shot about four times an inning. This is one. */
const TINY_GAG = [
  'I hit two sewers once.',
  'I hit two sewers once. Ask anybody.',
  'Ask Junior. Junior saw it.',
  'Junior was two.',
  'I HIT TWO SEWERS ONCE.',
];

/* ============================================================================
   3. Bags — nothing repeats until its bank is spent
   ========================================================================= */

class Bag {
  constructor(items, rnd) {
    this.items = items.slice();
    this.rnd = rnd;
    this.i = 1e9;
    this.last = null;
    this.deck = [];
  }
  shuffle() {
    this.deck = this.items.slice();
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = this.rnd.int(0, i);
      const t = this.deck[i]; this.deck[i] = this.deck[j]; this.deck[j] = t;
    }
    // a reshuffle must never put the card we just played back on top
    if (this.deck.length > 1 && this.deck[0] === this.last) {
      const t = this.deck[0]; this.deck[0] = this.deck[1]; this.deck[1] = t;
    }
    this.i = 0;
  }
  take() {
    if (!this.items.length) return '';
    if (this.i >= this.deck.length) this.shuffle();
    const v = this.deck[this.i++];
    this.last = v;
    return v;
  }
}

class Library {
  constructor(seed = 1925) {
    this.rnd = new RNG(seed);
    this.bags = new Map();
  }
  reset(seed = 1925) { this.rnd.reset(seed); this.bags.clear(); }
  pick(key, items) {
    let b = this.bags.get(key);
    if (!b) { b = new Bag(items, this.rnd); this.bags.set(key, b); }
    return b.take();
  }
  /** Every bank in the file, counted. Used by the audit below. */
  static inventory() {
    const n = (o) => Object.entries(o).reduce((a, [, v]) => a + (Array.isArray(v) ? v.length : 0), 0);
    return {
      dot: n(DOT) + DOT.climb.length * 2,
      gooch: n(GOOCH),
      gags: n(GAGS) + TWO_HANDERS.length,
      kid: Object.keys(KID_LINES).length * 2,
      chatter: n(CHATTER) + NARRATOR.length + TINY_GAG.length + ARGUMENTS.length,
    };
  }
}

/* ============================================================================
   4. Voicing
   ---------------------------------------------------------------------------
   Two layers, and the game is never silent-mouthed:
     1. speechSynthesis, where the browser actually has voices installed, tuned
        for pitch, rate and character.
     2. ALWAYS: the card, plus a synthesised vocal texture built out of formant
        filters in the game's own audio graph. It is not speech and it is not
        pretending to be — it is the rhythm and contour of the line, which is
        exactly what a cartoon announcer sounds like from three floors up. It
        needs no voices, no audio device and no network, which is the only
        reason any of this is testable headlessly.
   ========================================================================= */

const VOICES = {
  dot: {
    f0: 318, fScale: 1.17, syl: 0.132, wordGap: 0.062, rasp: 0.05, type: 'sawtooth',
    tts: { pitch: 1.55, rate: 1.22, volume: 0.85 }, ttsHint: /female|zira|samantha|karen|girl/i,
    lift: 1.055,           // she goes UP inside a phrase
  },
  gooch: {
    f0: 116, fScale: 0.93, syl: 0.183, wordGap: 0.128, rasp: 0.26, type: 'sawtooth',
    tts: { pitch: 0.55, rate: 0.86, volume: 0.9 }, ttsHint: /male|david|alex|fred|daniel/i,
    lift: 0.982,           // he goes down, always, even on a question
  },
  kid: {
    f0: 292, fScale: 1.12, syl: 0.118, wordGap: 0.052, rasp: 0.14, type: 'sawtooth',
    tts: { pitch: 1.7, rate: 1.3, volume: 0.75 }, ttsHint: /female|child|zira/i,
    lift: 1.04,
  },
};

const VOWEL_MAP = [
  ['ee', 'i'], ['ea', 'i'], ['oo', 'u'], ['ou', 'aw'], ['ow', 'aw'], ['ai', 'e'],
  ['ay', 'e'], ['oa', 'o'], ['oi', 'o'], ['ie', 'i'], ['au', 'aw'], ['aw', 'aw'],
  ['a', 'ae'], ['e', 'e'], ['i', 'ih'], ['o', 'o'], ['u', 'uh'], ['y', 'ih'],
];

/** Split a written line into voiced syllables. Rhythm only — never a spelling. */
export function sylls(text, cap = 24) {
  const out = [];
  const words = String(text).toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of words) {
    const parts = w.match(/[aeiouy]+|[^aeiouy]+/g) || [];
    const syl = [];
    let onset = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (/^[aeiouy]/.test(p)) {
        // a lone trailing 'e' after a vowel we already voiced is silent
        if (p === 'e' && i === parts.length - 1 && syl.length) { continue; }
        let v = 'uh';
        for (const [pat, key] of VOWEL_MAP) if (p.includes(pat)) { v = key; break; }
        syl.push({ v, onset: onset[onset.length - 1] || '', len: p.length });
        onset = '';
      } else {
        // the first consonant of a run belongs to the syllable after it
        if (syl.length && p.length > 1) syl[syl.length - 1].coda = p[0];
        onset = p;
      }
    }
    if (!syl.length) syl.push({ v: 'uh', onset: w[0] || '', len: 1 });
    out.push(syl);
    if (out.reduce((a, s) => a + s.length, 0) >= cap) break;
  }
  return out;
}

/** How long this line takes to say, in this voice. Drives the bubble hold. */
export function speakSeconds(text, who = 'dot') {
  const V = VOICES[who] || VOICES.dot;
  const words = sylls(text, 999);
  let n = 0;
  for (const w of words) n += w.length;
  return n * V.syl + words.length * V.wordGap + 0.16;
}

/**
 * The vocal texture. One formant blip per syllable, contoured as a phrase, with
 * a real consonant burst on the front of the hard ones. Identical live and
 * offline — this is the same function app.audio.renderOffline() builds.
 */
export function mouth(ctx, dest, t0, o = {}) {
  const V = VOICES[o.voice] || VOICES.dot;
  const words = sylls(o.text || 'the gooch has nothing to add', o.cap ?? 22);
  const base = (o.f0 ?? V.f0) * (o.pitch ?? 1);
  const g0 = o.g ?? 0.19;
  const rate = o.rate ?? 1;
  const rasp = o.rasp ?? V.rasp;
  let t = t0;
  let total = 0;
  for (const w of words) total += w.length;
  let k = 0;
  for (let wi = 0; wi < words.length; wi++) {
    const w = words[wi];
    for (let si = 0; si < w.length; si++) {
      const s = w[si];
      const last = wi === words.length - 1 && si === w.length - 1;
      const stress = si === 0 ? 1 : 0.82;
      const dur = (last ? V.syl * 2.5 : V.syl * (0.85 + s.len * 0.14)) / rate;
      // the phrase contour: up through the line for Dot, down for the Gooch,
      // and everybody drops on the final syllable
      const arc = Math.pow(V.lift, (k / Math.max(1, total)) * 7);
      const f = base * arc * (si === 0 ? 1.03 : 0.985);
      const F = VOWELS[s.v] || VOWELS.a;
      const on = s.onset;
      if ('tkpdgbc'.includes(on)) burst(ctx, dest, t, { f: 2400, q: 1.1, g: g0 * 0.34, a: 0.0004, d: 0.011 });
      else if ('sfzhxv'.includes(on)) burst(ctx, dest, t, { f: 4800, q: 0.8, g: g0 * 0.24, a: 0.004, d: 0.040 });
      else if ('mnl'.includes(on)) burst(ctx, dest, t, { f: 420, q: 1.4, g: g0 * 0.18, a: 0.010, d: 0.045 });
      const pitchPts = last
        ? [[0, f], [dur * 0.28, f * 1.02], [dur, f * 0.79]]
        : [[0, f * 0.975], [dur * 0.35, f], [dur, f * (si === w.length - 1 ? 0.955 : 1.005)]];
      formantVoice(ctx, dest, t + ('tkpdgbc'.includes(on) ? 0.011 : 0), {
        dur, g: g0 * stress * (last ? 1.08 : 1), a: 0.016, hold: dur * 0.42, d: dur * 0.55,
        shapeA: 'lin', pitch: pitchPts,
        formants: F, fScale: V.fScale * (o.fScale ?? 1), bw: [90, 125, 200], fGains: [1, 0.58, 0.2],
        rasp: rasp * g0, type: V.type,
      });
      t += dur * 0.92;
      k++;
    }
    t += V.wordGap / rate;
  }
  return t - t0;
}

/* --- the three cues, which is how a critic can hear any of this offline ---- */

registerCue('dot_line', {
  bus: 'voice', gain: 2.2, dur: 2.0, send: 0.34,
  note: 'DOT, three floors up, through a rolled newspaper. Bright, fast, and rising.',
  build(ctx, out, t0, o) {
    // she is up a fire escape and across a street: no bass, a horn-shaped honk
    // from the rolled paper, and plenty of canyon
    const cone = gain(ctx, 1);
    chain(cone, hp(ctx, 250, 0.7), pk(ctx, 1750, 1.1, 6), lp(ctx, 3600, 0.8), out);
    mouth(ctx, cone, t0, { voice: 'dot', text: o.text || 'strike two and the stick never moved', g: 0.50 });
  },
});

registerCue('gooch_line', {
  bus: 'voice', gain: 1.3, dur: 2.6, send: 0.16,
  note: 'THE GOOCH, on the tailgate, eight feet away. Low, slow, and falling.',
  build(ctx, out, t0, o) {
    const chest = gain(ctx, 1);
    chain(chest, pk(ctx, 620, 0.9, 5), lp(ctx, 2500, 0.8), shaper(ctx, 1.6), out);
    mouth(ctx, chest, t0, { voice: 'gooch', text: o.text || 'the gooch would have swung at that', g: 0.55 });
  },
});

registerCue('kid_yell', {
  bus: 'chatter', gain: 2.6, dur: 1.1, send: 0.28,
  note: 'One kid, one shout, across sixty feet of street. Pitched off kid.voice.',
  build(ctx, out, t0, o) {
    const air = gain(ctx, 1);
    chain(air, hp(ctx, 300, 0.7), pk(ctx, 2100, 1.0, 4), lp(ctx, 4200, 0.8), out);
    mouth(ctx, air, t0, {
      voice: 'kid', text: o.text || 'swing ya bum', pitch: o.vpitch ?? 1,
      rasp: o.vrasp ?? 0.14, g: 0.55, cap: 10,
    });
  },
});

registerCue('announce_two_hander', {
  bus: 'voice', gain: 1.6, dur: 6.4, send: 0.28,
  note: '§7.2 proof: Dot calls it straight, and the Gooch is strange exactly one beat later.',
  build(ctx, out, t0, o) {
    const a = 'Strike two, and the stick never moved.';
    const b = 'The Gooch would have swung at that. The Gooch would have missed it.';
    const cone = gain(ctx, 1);
    chain(cone, hp(ctx, 250, 0.7), pk(ctx, 1750, 1.1, 6), lp(ctx, 3600, 0.8), out);
    const chest = gain(ctx, 0.95);
    chain(chest, pk(ctx, 620, 0.9, 5), lp(ctx, 2500, 0.8), out);
    const d = mouth(ctx, cone, t0, { voice: 'dot', text: a, g: 0.50 });
    mouth(ctx, chest, t0 + d + 0.62, { voice: 'gooch', text: b, g: 0.55 });
  },
});

/* --- speechSynthesis, where it exists ------------------------------------- */

const TTS = {
  ok: null,
  voices: [],
  probe() {
    if (this.ok !== null) return this.ok;
    const s = globalThis.speechSynthesis;
    if (!s || typeof globalThis.SpeechSynthesisUtterance !== 'function') { this.ok = false; return false; }
    try { this.voices = s.getVoices() || []; } catch { this.voices = []; }
    // headless Chromium has the object and no voices at all, which is exactly
    // the case the synthesised texture exists to cover
    this.ok = this.voices.length > 0;
    return this.ok;
  },
  pick(who) {
    const hint = (VOICES[who] || VOICES.dot).ttsHint;
    return this.voices.find((v) => hint.test(v.name)) || this.voices.find((v) => /en/i.test(v.lang)) || this.voices[0] || null;
  },
  speak(who, text) {
    if (!this.probe()) return false;
    try {
      const s = globalThis.speechSynthesis;
      const u = new globalThis.SpeechSynthesisUtterance(text);
      const V = VOICES[who] || VOICES.dot;
      u.pitch = V.tts.pitch; u.rate = V.tts.rate; u.volume = V.tts.volume;
      const v = this.pick(who);
      if (v) u.voice = v;
      s.speak(u);
      return true;
    } catch { return false; }
  },
  stop() { try { globalThis.speechSynthesis?.cancel(); } catch { /* nothing to cancel */ } },
};

/* ============================================================================
   5. A mouth — one speaker, a queue of beats, and real cadence
   ========================================================================= */

class Mouth {
  constructor(who) {
    this.who = who;
    this.q = [];
    this.wait = 0;
    this.card = null;
    this.busy = false;
  }

  /** beats: [{ text, hold, kind, grow, silent, kid, body }] */
  say(beats, o = {}) {
    if (!beats || !beats.length) return;
    if (o.queue && this.busy) { this.q.push(...beats); return; }
    this.q = beats.slice();
    this.wait = 0;
    this.step();
  }

  interrupt(beats, o = {}) { this.q.length = 0; this.card = null; this.say(beats, o); }

  step() {
    const b = this.q.shift();
    if (!b) { this.busy = false; this.card = null; return; }
    this.busy = true;
    const hold = b.hold ?? Math.max(0.95, speakSeconds(b.text, this.who) + 0.5);
    this.wait = hold;
    const kind = b.kind || (b.silent ? 'beat' : 'talk');
    const text = b.silent ? '. . .' : b.text;
    const opts = {
      who: this.who === 'kid' ? 'kid' : this.who,
      text, hold: hold + 0.30, kind, grow: b.grow ?? 1,
      body: b.body || null, accent: b.accent,
    };
    if (this.card && !b.fresh && this.who !== 'kid') {
      this.card.setText(text, { kind, hold: hold + 0.30, grow: b.grow ?? 1 });
    } else {
      this.card = bubbles.say(opts);
    }
    if (!b.silent) voice(this.who, b);
  }

  update(dt) {
    if (!this.busy) return;
    this.wait -= dt;
    if (this.wait <= 0) this.step();
  }
}

function voice(who, beat) {
  const audio = APP.audio;
  const text = beat.text || '';
  if (!text) return;
  if (who === 'kid') {
    const v = beat.kidVoice || {};
    audio?.play?.('kid_yell', {
      text, vpitch: v.pitch ?? 1, vrasp: v.rasp ?? 0.14,
      pos: beat.pos, gain: 0.9, gate: 0.05,
    });
    return;
  }
  audio?.play?.(who === 'dot' ? 'dot_line' : 'gooch_line', {
    text, gain: 1, gate: 0.05,
    dist: who === 'dot' ? 26 : 9, pan: who === 'dot' ? -0.34 : 0.30,
  });
  TTS.speak(who, text);
}

/* ============================================================================
   6. The director
   ========================================================================= */

const ORD = ['none', 'one', 'two', 'three', 'four'];
const nick = (k) => (k ? (k.nick || k.name || 'that kid') : 'that kid');

function kidFromBody(body) {
  const id = body?.spec?.id;
  if (!id) return null;
  const r = BY_ID.get(id);
  if (r) return r;
  const s = body.spec;
  return { id, name: s.name || id, nick: s.nick || s.name || id, accent: s.accent || 'red', voice: { pitch: 1.05, rasp: 0.18 }, say: {} };
}

class Announcer {
  constructor() {
    this.dot = new Mouth('dot');
    this.gooch = new Mouth('gooch');
    this.kid = new Mouth('kid');
    this.lib = new Library(1925);
    this.rnd = new RNG(19250903);
    this.timers = [];
    this.quiet = 0;              // seconds since anybody said anything
    this.chatterIn = 2.4;
    this.gag = { apple: 0, ice: 0, grounded: 0, tiny: 0, twoHander: 0, arg: 0 };
    this.climb = null;
    this.lastKid = null;
    this.halves = 0;
    this.introduced = new Set();
    this.clock = 0;
    this.lastCallAt = -99;
  }

  reset(seed = 1925) {
    this.dot.interrupt([]); this.gooch.interrupt([]); this.kid.interrupt([]);
    this.dot.busy = this.gooch.busy = this.kid.busy = false;
    this.lib.reset(seed);
    this.rnd.reset((seed * 2654435761) >>> 0);
    this.timers.length = 0;
    this.quiet = 0; this.chatterIn = 2.2;
    this.gag = { apple: 0, ice: 0, grounded: 0, tiny: 0, twoHander: 0, arg: 0 };
    this.climb = null;
    this.halves = 0;
    this.introduced = new Set();
    this.clock = 0;
    this.lastCallAt = -99;
    TTS.stop();
  }

  /* --- cast ------------------------------------------------------------- */
  get players() { return APP.get ? APP.get('players') : null; }
  get batter() {
    const p = this.players;
    return kidFromBody(p?.batter) || ROSTER[(APP.sim?.state?.batterIdx ?? 0) % ROSTER.length];
  }
  get pitcher() { return kidFromBody(this.players?.pitcher) || BY_ID.get('kathleen'); }
  fielderBody() {
    const f = this.players?.fielders;
    if (!f || !f.length) return null;
    return f[this.rnd.int(2, f.length - 1)];
  }
  /** Anybody on the street who is not the batter, for chatter. */
  chatterBody(kind) {
    const p = this.players;
    if (!p) return null;
    if (kind === 'back') return p.batter;
    if (kind === 'narrate') {
      const n = [p.onDeck, p.stoopKid, p.catcher].filter(Boolean).find((k) => bubbles.visible(APP, k));
      return n || p.onDeck || p.stoopKid;
    }
    const all = [p.catcher, ...(p.fielders || []), p.onDeck, p.stoopKid].filter(Boolean);
    if (!all.length) return null;
    // only kids you can actually see get to talk (§ readability: one glance,
    // and you know who said it)
    // and a kid too far up the street to read does not get a card the size of
    // his whole body — chatter goes to whoever is actually near the play
    const near = all.filter((k) => bubbles.visible(APP, k, 11));
    const seen = near.length ? near : all.filter((k) => bubbles.visible(APP, k));
    const pool = seen.length ? seen : all;
    let pick = pool[this.rnd.int(0, pool.length - 1)];
    if (pick === this.lastKid && pool.length > 1) pick = pool[this.rnd.int(0, pool.length - 1)];
    this.lastKid = pick;
    return pick;
  }

  /* --- token fill --------------------------------------------------------
   * Half this block is girls, so there is no such thing as a default 'he' in
   * this file. Every pronoun in the bank is a token and every token is resolved
   * off the kid the line is actually about — the batter, or, for the fielding
   * banks, whoever just touched the ball.
   */
  fill(text, subj = 'batter') {
    if (!text || text.indexOf('{') < 0) return text;
    const s = APP.sim?.state || {};
    const b = this.batter, p = this.pitcher;
    const f = kidFromBody(this._lastFielder) || b;
    const who = subj === 'fielder' ? f : subj === 'pitcher' ? p : b;
    const g = who && (who.sex === 'g' || who.art?.sex === 'g' || who.spec?.sex === 'g');
    return text
      .replace(/\{B\}/g, nick(b))
      .replace(/\{P\}/g, nick(p))
      .replace(/\{F\}/g, nick(f))
      .replace(/\{S\}/g, ORD[clamp(s.strikes || 1, 1, 3)])
      .replace(/\{N\}/g, ORD[clamp(s.balls || 1, 1, 4)])
      .replace(/\{O\}/g, ORD[clamp(s.outs || 1, 1, 3)])
      .replace(/\{He\}/g, g ? 'She' : 'He')
      .replace(/\{he\}/g, g ? 'she' : 'he')
      .replace(/\{him\}/g, g ? 'her' : 'him')
      .replace(/\{His\}/g, g ? 'Her' : 'His')
      .replace(/\{his\}/g, g ? 'her' : 'his');
  }

  line(key, bank, subj) { return this.fill(this.lib.pick(key, bank), subj); }

  /** The self-narrating kid uses his own name, whoever he turns out to be. */
  fillSelf(text, kid) {
    if (!text || text.indexOf('{') < 0) return text;
    const he = (kid && (kid.sex === 'g' || kid.art?.sex === 'g' || kid.spec?.sex === 'g')) ? 'she' : 'he';
    const cap = he === 'she' ? 'She' : 'He';
    return text
      .replace(/\{ME\}/g, kid?.name || nick(kid))
      .replace(/\{MY\}/g, nick(kid))
      .replace(/\{HE\}/g, cap)
      .replace(/\{he\}/g, he);
  }

  /* --- the two-hander: straight, then strange one beat later ------------- */
  call(key, bank, goochKey, goochBank, o = {}) {
    const text = this.line(key, bank, o.subj);
    this.dot.interrupt([{ text, kind: o.kind || 'talk', grow: o.grow ?? 1 }]);
    this.quiet = 0;
    if (goochBank && this.rnd.chance(o.chance ?? 0.62)) {
      const gap = speakSeconds(text, 'dot') + (o.beat ?? 0.42);
      this.after(gap, () => {
        this.gooch.interrupt([{ text: this.line(goochKey, goochBank, o.subj) }]);
        this.quiet = 0;
      });
    }
  }

  /** A silent beat, then the call. The pause is the whole joke on a close play. */
  closeCall(text) {
    this.dot.interrupt([
      { silent: true, hold: 0.78, kind: 'beat' },
      { text, kind: 'shout', grow: 1.06 },
    ]);
    this.quiet = 0;
  }

  after(sec, fn) { this.timers.push({ t: sec, fn }); }

  /* --- kid chatter -------------------------------------------------------- */
  chatter(kindOrText, o = {}) {
    const isKey = typeof kindOrText === 'string' && CHATTER[kindOrText];
    const body = o.body || this.chatterBody(isKey ? kindOrText : o.kind);
    const kid = kidFromBody(body);
    const text = this.fillSelf(this.fill(isKey ? this.lib.pick('ch:' + kindOrText, CHATTER[kindOrText]) : kindOrText), kid);
    const beat = {
      text, kind: o.kind === 'shout' || /!$/.test(text) ? 'shout' : 'talk',
      body, accent: ACCENTS[kid?.accent] ?? undefined,
      kidVoice: kid?.voice, pos: body?.group?.position,
      hold: o.hold ?? Math.max(1.15, speakSeconds(text, 'kid') + 0.85),
    };
    bubbles.say({
      who: 'kid', text: beat.text, kind: beat.kind, hold: beat.hold + 0.2,
      body, accent: beat.accent,
    });
    voice('kid', beat);
    this.quiet = Math.min(this.quiet, 1.2);
    // §8.2: a gag the player can cause on purpose. Two kids call for the same
    // ball inside a second and a bit, and they run into each other. The setup
    // frame is the second MINE, the payoff is the pile-up, and it is about a
    // second apart.
    if (isKey && kindOrText === 'call') {
      if (this.clock - this.lastCallAt < 1.25 && this.rnd.chance(0.55)) {
        this.lastCallAt = -99;
        this.after(0.5, () => {
          this.dot.interrupt([{ text: this.line('dot:collision', DOT.collision, 'fielder'), kind: 'shout' }]);
          this.after(1.9, () => this.gooch.interrupt([{ text: this.line('gooch:collision', GOOCH.after_collision) }]));
        });
      } else this.lastCallAt = this.clock;
    }
    return beat;
  }

  /** The argument, played out over several seconds by different mouths. */
  argue() {
    const script = ARGUMENTS[this.gag.arg++ % ARGUMENTS.length];
    const p = this.players;
    const pool = [p?.catcher, ...(p?.fielders || []), p?.onDeck, p?.batter].filter(Boolean);
    let t = 0.25;
    script.forEach((lineText, i) => {
      const body = pool.length ? pool[(i * 3 + this.gag.arg) % pool.length] : null;
      this.after(t, () => this.chatter(lineText, { body, kind: i >= script.length - 1 ? 'talk' : 'shout' }));
      t += Math.max(0.85, speakSeconds(lineText, 'kid') + 0.55);
    });
  }

  /* --- the running gags -------------------------------------------------- */
  runGag() {
    const which = this.rnd.next();
    if (which < 0.34 && this.gag.apple < GAGS.apple.length) {
      this.gooch.interrupt([{ text: GAGS.apple[this.gag.apple++] }]);
    } else if (which < 0.66 && this.gag.ice < GAGS.ice.length) {
      this.gooch.interrupt([{ text: GAGS.ice[this.gag.ice++] }]);
    } else if (this.gag.grounded < GAGS.grounded.length) {
      // the straight man never blinks: he brings it up, she calls the game
      const g = GAGS.grounded[this.gag.grounded++];
      this.gooch.interrupt([{ text: g }]);
      this.after(speakSeconds(g, 'gooch') + 0.35, () => {
        this.dot.interrupt([{ text: this.line('dot:notallowed', DOT.not_allowed) }]);
      });
    } else {
      this.gooch.interrupt([{ text: this.line('gooch:nonseq', GOOCH.nonseq) }]);
    }
    this.quiet = 0;
  }

  twoHander() {
    const script = TWO_HANDERS[this.gag.twoHander++ % TWO_HANDERS.length];
    let t = 0;
    for (const [who, text] of script) {
      this.after(t, () => { this[who].interrupt([{ text }]); this.quiet = 0; });
      t += speakSeconds(text, who) + 0.34;
    }
  }

  /** One unique reference line per kid, the first time each steps in (§7.2). */
  introduce(kid) {
    if (!kid) return false;
    const set = KID_LINES[kid.id];
    if (!set || this.introduced.has(kid.id)) return false;
    this.introduced.add(kid.id);
    this.dot.interrupt([{ text: set.dot }]);
    this.after(speakSeconds(set.dot, 'dot') + 0.44, () => {
      this.gooch.interrupt([{ text: set.gooch }]);
      this.quiet = 0;
    });
    this.quiet = 0;
    return true;
  }

  /* --- the ball is climbing ---------------------------------------------- */
  startClimb(hit) {
    const ladder = this.lib.pick('dot:climb', DOT.climb);
    this.climb = { ladder, step: 0, t: 0, peak: 0, resolved: false, hit };
    this.dot.interrupt([{ text: ladder[0], kind: 'talk', grow: 1, hold: 9 }]);
    this.quiet = 0;
  }

  stepClimb(dt) {
    const c = this.climb;
    if (!c) return;
    c.t += dt;
    const ball = APP.sim?.ball;
    const y = ball ? ball.pos.y : 0;
    c.peak = Math.max(c.peak, y);
    const wantStep = c.t > 0.42 * (c.step + 1) && y > 6;
    if (wantStep && c.step < c.ladder.length - 1) {
      c.step++;
      this.dot.card?.setText(c.ladder[c.step], { kind: c.step >= 2 ? 'shout' : 'talk', hold: 9, grow: 1 + c.step * 0.13 });
      voice('dot', { text: c.ladder[c.step] });
    }
    // if it never got anywhere, deflate it — a build that does not pay is a gag
    if (!c.resolved && c.t > 1.5 && (!ball || (!ball.inFlight && !ball.live))) this.endClimb(null);
    if (c.t > 4.2) this.endClimb(null);
  }

  endClimb(result) {
    const c = this.climb;
    if (!c) return;
    this.climb = null;
    if (result) return;
    if (c.peak < 14) {
      this.dot.interrupt([{ text: this.line('dot:climbdown', DOT.climb_down), kind: 'talk' }]);
      this.after(1.1, () => this.gooch.interrupt([{ text: this.line('gooch:nonseq', GOOCH.nonseq) }]));
    }
  }

  /* --- tick --------------------------------------------------------------- */
  update(dt) {
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); try { t.fn(); } catch (e) { console.error('announcer timer', e); } }
    }
    this.dot.update(dt); this.gooch.update(dt); this.kid.update(dt);
    if (this.climb) this.stepClimb(dt);

    const live = APP.sim && APP.sim.state.phase !== 'idle' && APP.sim.state.phase !== 'over';
    if (!live) return;
    this.quiet += dt;
    this.chatterIn -= dt;

    // §7.5: chatter every 2-5 seconds during live play, under the announcers
    if (this.chatterIn <= 0) {
      this.chatterIn = this.rnd.range(2.0, 5.0);
      const phase = APP.sim.state.phase;
      const r = this.rnd.next();
      if (this.gag.tiny < TINY_GAG.length && r < 0.10) {
        this.chatter(TINY_GAG[this.gag.tiny++], { body: this.chatterBody() });
      } else if (r < 0.24) {
        this.chatter(this.lib.pick('narrate', NARRATOR), { body: this.chatterBody('narrate') });
      } else if (phase === 'in_play') {
        this.chatter('call');
      } else if (r < 0.58) {
        this.chatter('infield');
      } else if (r < 0.86) {
        this.chatter('taunt');
        if (this.rnd.chance(0.45)) this.after(0.95, () => this.chatter('back', { body: this.players?.batter }));
      } else {
        this.chatter('ghost');
      }
    }

    // §7.5: no gap over three seconds without a voice event
    if (this.quiet > 3.2 && !this.dot.busy && !this.gooch.busy) {
      if (this.rnd.chance(0.42)) this.runGag();
      else this.gooch.interrupt([{ text: this.line('gooch:nonseq', GOOCH.nonseq) }]);
      this.quiet = 0;
    }
  }

  /* --- wiring ------------------------------------------------------------- */
  wire() {
    const S = () => APP.sim.state;

    bus.on('atbat:begin', () => {
      const s = S();
      if (s.balls === 0 && s.strikes === 0) {
        const b = this.batter;
        if (!this.introduce(b)) {
          this.call('dot:walkup', DOT.walkup, null, null, { chance: 0 });
          if (this.rnd.chance(0.28)) {
            this.after(speakSeconds('x x x x', 'dot') + 0.5, () => this.gooch.interrupt([{ text: this.line('gooch:nonseq', GOOCH.nonseq) }]));
          }
        }
        if (this.gag.twoHander === 0 && this.rnd.chance(0.34)) { this.gag.twoHander = 1; this.after(2.6, () => this.twoHander()); }
      }
    });

    bus.on('strike', (p) => {
      if (p.kind === 'foul') return this.call('dot:foul', DOT.foul, 'gooch:strike', GOOCH.after_strike, { chance: 0.4 });
      if (S().strikes >= T.game.strikes) return;   // the strikeout call comes from 'out'
      if (p.kind === 'swinging') this.call('dot:strikeSw', DOT.strike_swinging, 'gooch:strike', GOOCH.after_strike);
      else this.call('dot:strikeLk', DOT.strike_looking, 'gooch:strike', GOOCH.after_strike);
    });

    bus.on('ball', () => this.call('dot:ball', DOT.ball, 'gooch:ball', GOOCH.after_ball, { chance: 0.5 }));
    bus.on('walk', () => this.call('dot:walk', DOT.walk, 'gooch:ball', GOOCH.after_ball, { chance: 0.55 }));

    bus.on('bat:contact', (hit) => {
      const power = hit?.power ?? 0, angle = hit?.angleDeg ?? 0;
      if (power > 74 && angle > 16) this.startClimb(hit);
      else if (this.rnd.chance(0.35)) this.chatter('cheer');
    });

    bus.on('out', (p) => {
      this._lastFielder = this.fielderBody();
      if (p.kind === 'strikeout') {
        this.call('dot:so', DOT.strikeout, 'gooch:out', GOOCH.after_out, { chance: 0.7 });
        this.after(0.9, () => this.chatter('cheer'));
        return;
      }
      this.endClimb(true);
      // a play at a base is a close call: hold the beat, then say it
      if (this.rnd.chance(0.4)) {
        this.closeCall(this.line('dot:closecall', DOT.close_call));
        this.after(2.1, () => this.gooch.interrupt([{ text: this.line('gooch:out', GOOCH.after_out) }]));
        this.after(2.6, () => this.argue());
      } else {
        this.call('dot:out', DOT.out, 'gooch:out', GOOCH.after_out, { chance: 0.6 });
        this.after(1.0, () => this.chatter(this.rnd.chance(0.5) ? 'cheer' : 'groan'));
      }
    });

    bus.on('hit', (p) => {
      this._lastFielder = this.fielderBody();
      this.endClimb(true);
      const bases = p?.bases ?? 1;
      if (p?.kind === 'walk') return;
      if (bases >= 4) {
        this.dot.interrupt([{ text: this.line('dot:sewer', DOT.sewer), kind: 'shout', grow: 1.14 }]);
        this.after(2.3, () => this.gooch.interrupt([{ text: this.line('gooch:sewer', GOOCH.after_sewer) }]));
        this.after(0.7, () => this.chatter('cheer'));
        this.after(1.6, () => this.chatter('cheer'));
      } else if (bases === 3) {
        this.call('dot:triple', DOT.triple, 'gooch:hit', GOOCH.after_hit, { chance: 0.6, kind: 'shout' });
      } else if (bases === 2) {
        this.call('dot:double', DOT.double, 'gooch:hit', GOOCH.after_hit, { chance: 0.6 });
      } else {
        this.call('dot:hit', DOT.hit, 'gooch:hit', GOOCH.after_hit, { chance: 0.55 });
        this.after(1.1, () => this.chatter('cheer'));
      }
      this.quiet = 0;
    });

    bus.on('run', () => {
      this.after(0.35, () => { this.dot.interrupt([{ text: this.line('dot:run', DOT.run), kind: 'shout' }]); this.quiet = 0; });
      // she keeps the line score in chalk on her own sill, and she will stop a
      // call dead to go and write on it
      if (this.rnd.chance(0.3)) this.after(2.5, () => this.dot.interrupt([{ text: this.line('dot:sill', DOT.sill) }]));
    });

    bus.on('field:catch', (p) => {
      this._lastFielder = this.fielderBody();
      if (p?.clean === false) {
        this.call('dot:error', DOT.error, 'gooch:error', GOOCH.after_error, { chance: 0.8, subj: 'fielder' });
        this.after(1.2, () => this.chatter('groan'));
      } else if (this.rnd.chance(0.30)) {
        this.call('dot:great', DOT.great, 'gooch:great', GOOCH.after_great, { chance: 0.7, subj: 'fielder' });
      }
    });

    bus.on('half:end', () => {
      this.halves++;
      this.endClimb(true);
      const s = S();
      const diff = Math.abs(s.score.home - s.score.away);
      const late = s.inning >= T.game.innings;
      let key = 'dot:between', bank = DOT.between;
      if (late && diff <= 1) { key = 'dot:close'; bank = DOT.close; }
      else if (diff >= 5) { key = 'dot:lopsided'; bank = DOT.lopsided; }
      this.dot.interrupt([{ text: this.line(key, bank) }]);
      this.quiet = 0;
      // §8.2: at least one announcer non sequitur per half-inning. Guaranteed.
      this.after(2.4, () => this.runGag());
      this.after(5.0, () => this.gooch.interrupt([{ text: this.line('gooch:between', GOOCH.between) }]));
      if (this.rnd.chance(0.34)) this.after(8.2, () => this.twoHander());
    });

    bus.on('game:over', () => {
      this.dot.interrupt([{ text: 'That is the ball game, and I called every pitch of it from up here.', kind: 'shout' }]);
      this.after(2.8, () => this.gooch.interrupt([{ text: 'The Gooch has to go. The ice went a while ago.' }]));
    });

    /* --- the block interrupts, and the announcers are interruptible ------- */
    bus.on('ball:sewer', () => {
      this.dot.interrupt([{ text: 'SEWER! It went down the sewer! Everybody at the grate!', kind: 'shout' }]);
      this.after(0.4, () => this.chatter('SEWER!', { kind: 'shout' }));
      this.after(1.5, () => this.gooch.interrupt([{ text: 'The Gooch has a coat hanger on the wagon. The Gooch is not fetching it.' }]));
    });
    bus.on('ball:window', (p) => {
      if (p?.broke) {
        this.dot.interrupt([{ text: 'THE WINDOW! Everybody run! I am not even down there and I am running!', kind: 'shout' }]);
        this.after(0.5, () => this.chatter('CHEESE IT!', { kind: 'shout' }));
      } else {
        this.dot.interrupt([{ text: 'Off the glass — and it held! It flexed and it held!', kind: 'shout' }]);
        this.after(1.4, () => this.gooch.interrupt([{ text: 'The Gooch stopped breathing. The Gooch would like that on the record.' }]));
      }
    });
    bus.on('ball:roof', () => {
      this.dot.interrupt([{ text: 'That is on the roof. That is a home run and a lost ball, both at once.' }]);
      this.after(1.9, () => this.gooch.interrupt([{ text: 'Somebody is going up. It is not going to be the Gooch.' }]));
    });
    bus.on('ball:fire_escape', () => {
      if (this.rnd.chance(0.35)) this.chatter('IT IS ON THE SECOND FLOOR!', { kind: 'shout' });
    });
    bus.on('ball:ashcan', () => { if (this.rnd.chance(0.35)) this.chatter('Off the cans!', {}); });
    bus.on('ball:fender', () => { if (this.rnd.chance(0.45)) this.chatter('Off the fender!', {}); });
    bus.on('pitcher:rattled', () => { if (this.rnd.chance(0.5)) this.chatter('infield'); });
  }
}

/** The whole bank, exported so a critic (or a test) can read every line of it. */
export const BANK = { DOT, GOOCH, CHATTER, KID_LINES, GAGS, NARRATOR, ARGUMENTS, TWO_HANDERS, TINY_GAG };

export const announcer = new Announcer();
announcer.bank = BANK;

/* ============================================================================
   7. The system
   ========================================================================= */

export default registerSystem({
  name: 'announcer',
  order: 210,               // after the sim and the HUD, before the camera director

  init(app) {
    app.announcer = announcer;
    announcer.wire();
    bubbles.demo = (name) => stage(name);
  },

  update(dt) { announcer.update(dt); },

  onScenario(name) {
    announcer.reset(1925);
    bubbles.sheet = null;
  },
});

/* ============================================================================
   8. Scenarios — where a critic reads the writing
   ========================================================================= */

/** Stage a moment by hand, so the frame a critic sees is composed, not random. */
function stage(name) {
  const p = APP.get ? APP.get('players') : null;
  announcer.reset(1925);
  if (name === 'bubbles') {
    // the architecture of the whole piece in one frame: she calls it straight,
    // he is strange one beat later, and the kids are talking underneath both
    announcer.dot.say([{ text: 'Strike two, and the stick never moved. He watched it go by like a trolley he did not want.' }]);
    announcer.gooch.say([{ text: 'The Gooch would have swung at that. The Gooch would have missed it.' }]);
    announcer.chatter('{He} shuts {his} eyes! I saw {him}!', { body: p?.catcher, kind: 'shout' });
    announcer.chatter('Sez who!', { body: p?.batter, kind: 'shout' });
    const small = announcer.chatterBody('narrate') || p?.onDeck;
    announcer.chatter('{ME} has a plan. The plan is to swing.', { body: small });
  } else if (name === 'chatter') {
    announcer.chatter('Chuck it here!', { body: p?.catcher, kind: 'shout' });
    announcer.chatter('Swing, ya bum!', { body: p?.onDeck, kind: 'shout' });
    announcer.chatter('I hit two sewers once. Ask anybody.', { body: p?.batter });
    announcer.gooch.say([{ text: 'There is a man on Second Avenue selling chestnuts. In September. In SEPTEMBER.' }]);
  }
}

/**
 * THE BUILD. §7.2 asks for escalation as a ball climbs, and a still cannot show
 * a build, so this scenario freezes one at its top: the ball is up, the card has
 * grown two steps, and it has stepped sideways to stay off the ball.
 */
registerScenario('announcer_climb', {
  seed: 4242,
  setup: () => {
    APP.sim.reset(4242);
    APP.clock.advance(0.9);
    bubbles.clear();
    announcer.reset(4242);
    // aimed deliberately into the top-left, which is exactly where Dot's card
    // wants to sit — so the still shows the card stepping out of the ball's way
    APP.sim.ball.pos.set(2, 4, T.street.plateZ + 2);
    APP.sim.ball.vel.set(9, 34, 52);
    APP.sim.ball.inFlight = true; APP.sim.ball.live = true;
    APP.sim.state.phase = 'in_play'; APP.sim.playT = 0;
    announcer.startClimb({ power: 108, angleDeg: 34 });
    announcer.chatter('Way back! Way back!', { body: APP.get('players')?.catcher, kind: 'shout' });
  },
  settle: 1.05,
});

/**
 * The call sheet. Not a debug dump — it is what is actually pinned to the inside
 * of Dot's window: the afternoon paper, torn into columns, with the lines she
 * has ready. A critic can read forty of them at once and judge the writing,
 * which is the whole deliverable of this piece.
 */
registerScenario('announcer_sheet', {
  seed: 1925,
  setup: () => {
    APP.sim.reset(1925);
    APP.clock.advance(0.4);
    bubbles.clear();
    const L = new Library(4242);
    // the sheet is read, not heard, so the tokens get filled with the names of
    // whoever is actually standing out there right now
    const sample = (t) => t
      .replace(/\{B\}/g, nick(announcer.batter))
      .replace(/\{P\}/g, nick(announcer.pitcher))
      .replace(/\{F\}/g, 'Ears')
      .replace(/\{S\}/g, 'two').replace(/\{N\}/g, 'three').replace(/\{O\}/g, 'one');
    let key = 0;
    const col = (bank, n) => { const k = 'sheet' + (key++); return Array.from({ length: n }, () => sample(L.pick(k, bank))); };
    bubbles.sheet = {
      title: 'HALF PAST THREE',
      sub: 'Dot, third floor front  ·  The Gooch, on the wagon',
      columns: [
        { head: 'DOT CALLS IT STRAIGHT', lines: [
          ...col(DOT.strike_looking, 2), ...col(DOT.strike_swinging, 2), ...col(DOT.ball, 1),
          ...col(DOT.hit, 2), ...col(DOT.sewer, 2), ...col(DOT.out, 2), ...col(DOT.great, 1),
          ...col(DOT.error, 1), ...col(DOT.foul, 1), ...col(DOT.between, 1),
          ...col(DOT.close, 1), ...col(DOT.lopsided, 1),
        ] },
        { head: 'THE GOOCH, ONE BEAT LATER', lines: [
          ...col(GOOCH.after_strike, 2), ...col(GOOCH.after_hit, 1), ...col(GOOCH.after_out, 1),
          ...col(GOOCH.nonseq, 5), ...col(GOOCH.after_error, 1), ...col(GOOCH.after_sewer, 1),
          ...col(GOOCH.between, 1), GAGS.ice[1], GAGS.apple[2], GAGS.grounded[1],
        ] },
        { head: 'ONE APIECE, AND THE BLOCK', lines: [
          KID_LINES.ethel.dot, KID_LINES.tommy.gooch, KID_LINES.luz.gooch,
          KID_LINES.dom.gooch, KID_LINES.bessie.gooch, KID_LINES.jesus.dot,
          ...col(CHATTER.taunt, 2), ...col(CHATTER.call, 2), ...col(CHATTER.back, 2),
          ...NARRATOR.slice(8, 11), ...col(CHATTER.ghost, 1), TINY_GAG[1],
          ...ARGUMENTS[3],
        ] },
      ],
      count: Library.inventory(),
      kids: Object.keys(KID_LINES).length,
    };
  },
  settle: 0.05,
});
