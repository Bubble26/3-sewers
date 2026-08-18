# DESIGN BIBLE — the tie-breaker

**Status: binding.** `BYB-REFERENCE.md` is the standard of *craft*. `PERIOD-REFERENCE.md` is the
standard of *truth*. They disagree in about nine places, and every one of those disagreements has
already cost a builder a day. This document settles all nine, with numbers, and it outranks both
parent documents wherever it speaks. If a brief, a critic, or a later document contradicts a line
in here, this line wins until Ryan changes it.

Nothing in here is "could either". Every entry is "we do X". Where a parent document's number is
superseded, §14 says so explicitly so a critic scoring a frame knows which figure to hold it to.

---

## 0. The one sentence

> **The period decides what is on screen. Backyard decides how bright, how saturated, how big,
> how fast, and how funny it is.**

Period owns the **nouns**: broomstick, manhole, fire escape, ash can, knickers, klaxon, chalk,
Model T, Belgian block, gold leaf, coal haze. Backyard owns the **adjectives and the verbs**:
head-to-body ratio, saturation floor, contact shadow, hitstop, held pose, six mouth shapes, the
joke's setup-and-payoff, the announcer's beat.

A builder who invents a prop has failed the period. A builder who renders a period prop grimly,
smally, slowly, or in a naturalistic light has failed Backyard. Both are failures of the same
severity and both get sent back.

**The corollary, which is the whole thesis:** *sooty* is a fact about the surfaces of 1925 New
York. It is not a fact about the light, the colour, the mood, or the volume. We build a block that
is genuinely filthy and unmistakably cheerful, because the dirt lives in the **texture and the
value** and never in the **saturation, the exposure, or the tone**.

---

## 1. The four laws that settle the nine conflicts

### Law 1 — The Bright Middle
Value runs **dark at the frame edges, light at the play plane.** The sooted upper facade and the
cornices are the darkest material in the frame; the sidewalks are mid; the crown of the roadway
where the game happens is the **brightest ground surface in the frame**. This is a vignette built
out of material rather than a post effect — it is period-true (soot accumulates upward, the road
is scoured by traffic) and it is Backyard-true (the eye is delivered to the action and there are
no dark corners where the action is).

**Checkable:** the median L\* of a 64×64 crop at the crown of the road must exceed the median L\*
of a 64×64 crop of the fourth-floor brick by **7–14 points**. Under 7 and the composition is flat;
over 14 and it reads as a spotlight.

### Law 2 — The Chalk Ceiling and the Ink Floor
**Chalk is our white. Ink is our black. Nothing in the world may be either.**

* **Chalk** `#F6F0E2` (L\* 94.9). Reserved for: chalk marks, the pitch ring, the landing marker,
  the ball's rim crescent, HUD lettering grounds, the ghost runner. **No environment material may
  exceed L\* 80** — not brick, not sky, not laundry, not gold leaf. (Sky tops out at L\* 79.)
* **Ink** `#2A1D1A` (L\* 12.3). Reserved for: character and prop outlines, the ball outline, HUD
  hairlines. **No environment material may fall below L\* 28** — not the areaway, not under the
  stoop, not under the parked Ford, not the deep shade of the El.

Everything the player must read lives outside the band the world is allowed to occupy. This single
rule is why a pink ball and a nine-kid roster stay legible against a brown-and-grey street, and it
is why we can be as sooty as we like.

### Law 3 — Soot is a value shift, never a saturation shift
Dirtying a material **lowers its L\* and leaves its hue and its S alone.** Sooted brick is the same
red at the same saturation, darker. There is **no global grade, no sepia, no desaturation pass, no
LUT, no dirt overlay texture** anywhere in the pipeline. Grime is *drawn* — a dark line under a
sill, a streak below a window, a black upper face on a cornice — at a feature scale of ≥ 6 px at
1600×900. Grime is never *filtered*.

### Law 4 — Every sooty surface is adjacent to a saturated one
**No 128×128 px region of a gameplay frame may contain only materials with S < 0.20.** If a wall is
that sooty it gets a painted ad, an awning under it, laundry in front of it, a pushcart against it,
or a kid standing on it. 1925 New York was over-lettered and over-painted; that is the period fact
that pays our saturation bill.

---

## 2. The master palette

All values are authored colours, not lit results. Hue/S are HSL; L\* is CIE lightness computed from
WCAG relative luminance. These have been computed, not eyeballed — see §2.5.

### 2.1 Pavement — the play plane

| Role | Hex | Hue | S | L\* |
|---|---|---|---|---|
| Asphalt, shade (base roadway) | `#6E5C4C` | 28° | 0.18 | 40.4 |
| Asphalt, sun band | `#8A7157` | 31° | 0.23 | 49.4 |
| Asphalt, dark patch (newer tar) | `#5A4E46` | 24° | 0.12 | 34.1 |
| Asphalt, warm patch (older, oxidised) | `#7E6A52` | 33° | 0.21 | 46.1 |
| Belgian block surfacing through | `#957B60` | 31° | 0.22 | 53.4 |
| Belgian block, wear-polished crown | `#A8917A` | 30° | 0.21 | 61.6 |
| Bluestone sidewalk flag | `#9A9184` | 35° | 0.10 | 60.6 |
| Granite curb | `#8E877A` | 39° | 0.08 | 56.6 |
| Manhole iron, worn high points | `#9A9188` | — | 0.06 | 60 |
| Manhole iron, recesses | `#3B322B` | 32° | 0.15 | 21 → **lift to `#4A4038`, L\* 28** |

**The deliberate deviation, stated openly:** `PERIOD-REFERENCE §10.1` gives asphalt as `#4A474A`
(S 0.03, L\* 30). We push it **+10 L\* and +0.15 S into the warm band**. The justification is in the
period document's own §6.2: the roadway is lit by a strip of sky plus a 20–30% warm bounce off
`#C08863` sunlit brick, through `#B9AE9E` coal haze. That is what warm taupe asphalt *is*. We are
not stylising the asphalt; we are lighting it and then baking the light in, because we do not ship
a physically-based renderer. **A builder who ships `#4A474A` roadway has shipped an unlit texture
and fails Craft.**

### 2.2 Brick and facade

| Role | Hex | Hue | S | L\* |
|---|---|---|---|---|
| Brick, in the sun band | `#C86E4C` | 16° | 0.53 | 56.0 |
| Brick, ambient (the workhorse) | `#A85C42` | 15° | 0.44 | 47.5 |
| Brick, soot field (floors 4–5) | `#8A4A3A` | 12° | 0.41 | 38.9 |
| Brick, deep shade (under cornice, areaway) | `#6B4235` | 14° | 0.34 | 32.4 |
| Mortar | `#B49C86` | 29° | 0.23 | 65.9 |
| Ochre brick (one building in eight) | `#C8924E` | 33° | 0.53 | 64.5 |
| Ochre brick, shade | `#9E7A46` | 35° | 0.39 | 53.6 |
| Painted-out party wall (ghost-sign ground) | `#B8A88E` | 33° | 0.22 | 69 |
| Cornice paint A / B / C | `#7A4A34` · `#4C4A3C` · `#5B3B33` | — | — | 34–40 |
| Window sash | `#2E4034` · `#5A2A24` · `#332F2C` | — | — | 28–32 |
| Fire-escape iron | `#332E2A` · `#6E4231` · `#8A6A54` | — | — | 28–52 |

Every building on the block picks one brick, one cornice paint, one sash colour and one iron
finish, and **no two adjacent buildings may share more than one of the four.** Cornice heights vary
2–8 ft building to building. This is period anti-check #19 enforced as a palette rule.

### 2.3 Sky and air

| Role | Hex | Hue | S | L\* |
|---|---|---|---|---|
| Sky, upper | `#6FA3D6` | 210° | 0.56 | 65.3 |
| Sky, lower | `#A8C6E2` | 209° | 0.50 | 78.6 |
| Coal-haze band, at the street mouth | `#D8CFB8` | 43° | 0.29 | 83.3 |
| Direct sun tint (multiplier target) | `#F5A863` | 28° | 0.88 | 75.0 |
| Sky fill / key on characters | `#8FA6C4` | 214° | 0.31 | 67.4 |
| Warm brick bounce (bottom-band tint) | `#C08863` | 25° | 0.42 | 62 |
| Contact shadow tint | `#3E4658` | 222° | 0.17 | 29.7 |

Sky L\* 65.3 against roadway L\* 40.4 is a **24.9-point gap**, inside BYB's 15–30 requirement. Sky
hue 210° is inside BYB's 190–250° cool band; roadway hue 28° is inside the 20–60° warm band. This
check passes cleanly and no builder needs to negotiate it.

**The haze is a light, not a veil.** Coal haze is applied as an **additive warm scatter that raises
the far end of the street toward the sky value.** Distance gets *brighter*, never darker. Aerial
perspective that darkens is grim; aerial perspective that lightens is cheerful, and it is also
what actually happens when sunlight scatters off particulate. Fog density is tuned so the far
cornice is **+8 to +14 L\* over the near cornice** within 300 ft.

### 2.4 The ball, the readability accent, the ink

| Role | Hex | Hue | S | L\* |
|---|---|---|---|---|
| Ball body, new | `#F2828A` | 356° | 0.81 | 67.0 |
| Ball body, half a season old | `#D4787A` | 359° | 0.52 | 60.6 |
| Ball body, been down the sewer | `#B08472` | 17° | 0.28 | 58.9 |
| Ball seam channel | `#A85A5E` | 356° | 0.32 | 45 |
| Felt remnants clinging in the seam | `#C8C2A8` | 51° | 0.24 | 77 |
| **Ball rim crescent (chalk)** | `#F6F0E2` | 42° | 0.53 | 94.9 |
| **Ball outline (ink)** | `#2A1D1A` | 11° | 0.24 | 12.3 |
| Chalk — every readability mark | `#F6F0E2` | 42° | 0.53 | 94.9 |
| Ink — every outline | `#2A1D1A` | 11° | 0.24 | 12.3 |

### 2.5 How the ball stays readable against a brown-and-grey street

This is the single hardest problem the two references hand us, so it is solved with arithmetic
rather than with taste.

**The finding.** `BYB-REFERENCE §2.4` demands the ball hold **4.5:1** luminance contrast against
whatever is behind it for the whole flight. **That figure is unattainable in a brick street and it
is unattainable in Backyard Baseball too** — the mathematics forbid it. Against a backdrop at
L\* 49 (which is sunlit asphalt, and also ambient brick, and also weathered granite), the *maximum
achievable* contrast from **pure `#FFFFFF` is 4.65:1 and from pure `#000000` is 4.52:1**. Any real,
non-pure colour does worse. A single-colour ball cannot clear 4.5 across a street built of
mid-value materials. Ours cannot, and it does not need to.

**The rule we ship instead — the Two-Sided Ball.**

> The ball is drawn in three parts at every scale: an **ink outline** (`#2A1D1A`), a **chalk rim
> crescent** (`#F6F0E2`) on the upper-left third, and the body colour between them. At every point
> of flight, the **better of the two treatments** must hold **≥ 4.0:1** against the median of an
> 11×11 px annulus just outside the silhouette, sampled at five points along the arc (release,
> quarter, apex, three-quarter, landing).

**Why 4.0 and not some other number:** the worst case for this pair over all possible backdrops is
**3.95:1, at exactly L\* 50**. Every material in our palette does better than that. The measured
best-of-two against every environment colour in §2.1–§2.3 is:

| Backdrop | L\* | chalk rim | ink outline | best |
|---|---|---|---|---|
| Asphalt, shade | 40.4 | **5.60** | 2.56 | 5.60 |
| Asphalt, sun band | 49.4 | **4.03** | 3.55 | **4.03 ← worst in palette** |
| Asphalt, warm patch | 46.1 | **4.54** | 3.16 | 4.54 |
| Belgian block | 53.4 | 3.50 | **4.10** | 4.10 |
| Bluestone flag | 60.6 | 2.73 | **5.24** | 5.24 |
| Granite curb | 56.6 | 3.13 | **4.57** | 4.57 |
| Brick, sun band | 56.0 | 3.19 | **4.49** | 4.49 |
| Brick, ambient | 47.5 | **4.32** | 3.32 | 4.32 |
| Brick, soot field | 38.9 | **5.92** | 2.42 | 5.92 |
| Brick, deep shade | 32.4 | **7.53** | 1.91 | 7.53 |
| Mortar | 65.9 | 2.30 | **6.24** | 6.24 |
| Ochre brick | 64.5 | 2.41 | **5.96** | 5.96 |
| Sky, upper | 65.3 | 2.34 | **6.12** | 6.12 |
| Sky, lower | 78.6 | 1.56 | **9.19** | 9.19 |
| Coal-haze band | 83.3 | 1.37 | **10.50** | 10.50 |
| Contact shadow | 29.7 | **8.32** | 1.72 | 8.32 |
| Shirt ecru | 88.1 | 1.19 | **12.00** | 12.00 |

Note the shape of that table: **the two treatments hand off to each other.** Below L\* 50 the chalk
rim carries the ball; above L\* 50 the ink outline does. There is no backdrop in the game where
both fail, and that is the entire design. Note also the worked failure: the ball's *body* colour
alone holds **1.06:1 against the sky**. A ball drawn without both treatments is invisible on a pop
fly, and that is not a tuning problem, it is a spec violation.

**The five supporting reads**, all mandatory, none optional:

1. **The reserved band.** No environment material may occupy hue **335°–10°** *and* L\* **58–78**
   simultaneously. That rectangle of colour space belongs to the ball. (Brick sits at hue 12–16°;
   team red sits at L\* 47. Both are legal. A new material that lands inside is rejected at the
   palette gate, not fixed later in a shader.)
2. **The chalk landing marker**, a ring ≥ 14 px across with a 1.5 px ink outline, present from the
   moment the ball leaves the bat. It is a gameplay mechanic, not decoration.
3. **A scale floor**: the ball never renders under **6 px** across, at any distance.
4. **A trail** on hard-hit balls only — 6 frames, chalk-cream, fading to nothing, never a glow.
5. **Contact shadow** on the ground under the ball at all times, per §2.6.

**The same logic applies to every readability mark in the game.** *Every* chalk-cream UI element —
the pitch ring, the landing marker, the chalk foul line, the count tallies, the ghost runner —
carries a **1.5 px ink outline**, so each one is a two-sided read and none of them can be lost
against a light sidewalk or a dark shadow. One rule, no exceptions, no per-element tuning.

### 2.6 Contact shadows

Mandatory under every kid, every base, every prop, every vehicle, the ball, and every spectator.
Soft ellipse, **opacity 0.28–0.42**, blur radius 8–14% of the long axis, long axis 0.9–1.2× the
subject's shoulder width for a standing kid, shrinking with height off the ground. Tint is the
period's own `#3E4658` blue-violet — which is simultaneously the complement of our warm ground
(BYB's rule) and the colour of skylight fill in a canyon (the period's physics). **The two
references agree here exactly; there is no shadow anywhere in this game that is grey or black.**

### 2.7 Skin

Six tones, all warm, all high-value, all cartoon rather than naturalistic, each with one shade step
(−12 L\*, hue +4° warm) and one blush (`#E08878` at 20%). The block is Italian, Eastern European
Jewish, Irish, German, Black Harlem, Puerto Rican and Chinese, so the spread is not decoration —
it is the period fact.

| # | Hex | L\* | Note |
|---|---|---|---|
| 1 | `#F8D6B6` | 87.7 | palest; the freckle carrier |
| 2 | `#EFC199` | 81.2 | |
| 3 | `#DFA377` | 71.7 | |
| 4 | `#C07E52` | 58.7 | |
| 5 | `#96603A` | 45.8 | |
| 6 | `#6A4128` | 31.8 | |

No tone may be used on more than **six** of the thirty kids. Tone is never correlated with a stat,
a nickname, a team, or a joke.

### 2.8 Clothing, team colours, and where the saturation goes

**The conflict:** BYB requires every kid to be a saturated colour accent at 1–3% of frame area.
The period requires ecru collarless shirts and everyone's clothes a size wrong.

**The resolution: the shirt is period; the accent moves up one garment.** Shirts are ecru
(`#E8DCC4` / `#DDCFB4` / `#D2C3A6` / `#EFE6D2` — four values, no hues). **Every kid carries exactly
one saturated garment** — a knitted wool sweater, a vest, a cap, a set of suspenders, or a hair
ribbon — covering **6–12% of the kid's silhouette area**. Home-dyed wool in 1925 came out of the
dye lot whatever colour the dye lot gave, so this is period-legal and it is where our chroma lives.

Twelve dyed-wool hues, enough that no two adjacent fielders share one:

`#C8402F` red · `#E3A32B` mustard · `#2F7F63` bottle green · `#3B5EA0` indigo ·
`#7B4A8C` plum · `#D4694A` rust · `#4E8CA8` slate blue · `#8FA23C` olive ·
`#B03A5E` claret · `#2E6E6E` teal · `#A85E2A` tan · `#5C6BB0` periwinkle

**Team marker.** One accessory, **≤ 15% of silhouette area**, per BYB's un-kitted 1997 rule: a
**strip of dyed flannel** tied round the upper arm or round the cap band. Four team colours:
red `#C8402F`, mustard `#E3A32B`, bottle green `#2F7F63`, indigo `#3B5EA0`. There are **no jerseys,
no numbers on backs, no sponsor, no matching anything.** If a stranger can tell which team a kid is
on before they can tell which kid it is, we have built a uniform and failed both documents at once
(BYB §1.4; period anti-check #39).

---

## 3. Light: the decision, and the arithmetic behind it

### 3.1 The conflict, stated honestly
`PERIOD-REFERENCE §6.1` proves with trigonometry that a 60 ft × 60 ft canyon puts the roadway in
**full shade from about 2:50 pm onward**, and in only a 16 ft ribbon of sun even at solar noon.
`BYB-REFERENCE §2.5` requires flat bright midday light, ambient ≥ 55% of key, and **no 64×64 region
below L\* 25**. Taken together they are incompatible: a period-honest canyon at 4:50 pm is a
blue-shade street, and a blue-shade street is a mood, and Backyard Baseball has zero tolerance for
mood.

### 3.2 What we do
Three decisions, all specific, all defensible from the period document's own numbers.

**Decision 1 — the clock moves to 3:50 pm EDT, Tuesday 22 September 1925.**
From `PERIOD §6.1`: **sun altitude 33°, azimuth 237°.** The date, the DST, and the news of the week
are unchanged. We do not use the period document's 4:50 "money hour" because 22° of altitude cannot
put light on a roadway through any legal geometry.

**Decision 2 — the venue is the west end of the block, and the corner building is a one-storey
taxpayer.** A **16 ft** one-storey commercial taxpayer occupies the corner lot on the **south** side
where our cross street meets the avenue, with a 50 ft return along our street. Taxpayers — cheap
one- and two-storey commercial blocks on land held for later development — are ubiquitous, correct
and unremarkable in 1925 New York. The mid-block eight lots keep their unbroken 60 ft party-wall-to-
party-wall front, so **period authenticity check #31 still passes**; the taxpayer is the ninth lot,
at the corner, on the avenue.

**The arithmetic, so nobody has to re-derive it.** The Manhattan grid is rotated 29° east of north,
so our cross street runs 119°/299° and the north facade's normal is 209°. With the sun at azimuth
237°, that is **28° off the facade normal**. A ray therefore travels
`cos(28°) / tan(33°) = 0.883 / 0.649 = **1.36 ft horizontally per foot it drops**`.

| Obstruction | Shadow reach across the 60 ft street |
|---|---|
| Normal 60 ft tenement, south side | 60 / 1.36 = 44 ft of drop → shadow line **16 ft up the north facade**; roadway fully shaded |
| **Our 16 ft taxpayer** | 16 × 1.36 = **21.8 ft** → sun on the roadway from 21.8 ft out to the north facade |

The roadway runs 14 ft to 46 ft from the south facade; the crown — where the sewer castings are and
where home plate is — sits at **30 ft**. **30 > 21.8, so home plate is in direct sun.** The sunlit
patch is a parallelogram roughly 50 ft along the street by 38 ft across it, skewed about **12 ft
east** by the sun's off-axis angle. Home plate is the casting **40 ft east of the corner**; the
batter faces **east, up the block, away from the avenue**; second base is the next casting 95 ft
east. The camera looks east down the canyon with the sun behind its right shoulder — which is
exactly BYB's "one sun, high, slightly behind the camera."

**Decision 3 — the sun band is a colour event, not an exposure event.**
Direct sun multiplies toward `#F5A863`; the value gain is **capped at 1.45:1** over the shaded
plane (sunlit asphalt L\* 49.4 vs shaded L\* 40.4 = 1.39:1 in luminance), comfortably inside BYB's
1.6:1. Ambient fill never drops below **60%** of key. **The reason our sun band reads as sunlight is
its hue and its edge, not its brightness.** A builder who blows out the sun band to sell the effect
has broken the flat-midday rule and gets a Craft fail.

### 3.3 What this buys, compositionally
The batter and the contact happen in warm gold. The ball flies **east into cool shade**, where the
chalk rim carries it (chalk on shaded asphalt = 5.60:1). The sunlit band up the north facade — the
period's signature — is still there, above the cornice line of the south side, with the water
tanks, chimney pots, laundry and pigeons burning warm in it. **We get the period's light and
Backyard's exposure in the same frame** because we chose a geometry in which they coexist, rather
than compromising either one.

### 3.4 The floor and the ceiling, restated as engine constraints
* No 64×64 px region of a gameplay frame below **L\* 26**. Areaways, under-stoop recesses, under
  parked cars and the deep shade of the El are **lifted to L\* 28 minimum**, by raising ambient —
  never by adding a light.
* Ratio of brightest to darkest 64×64 region stays **under 5:1**.
* No bloom, no vignette, no chromatic aberration, no depth of field, no film grain, no colour LUT,
  no tone-mapping curve that a 1997 sprite artist could not have painted by hand.

---

## 4. The shading model

**We ship a two-band toon ramp with a third bounce band, hand-authored textures, and outlines.**
No PBR, no normal maps, no specular except on three named materials, no ambient occlusion.

### 4.1 The ramp
Three bands, and the third one is where the period's physics lives:

1. **Lit band** — the authored base colour.
2. **Shade band** — the base at **0.72× luminance**, hue rotated **+6° cool**. Terminator is hard,
   with a **2–3 px soft edge at 1600×900** and no more. (0.72 keeps us inside the 1.6:1 lit-to-shade
   rule.)
3. **Bounce band** — a narrow strip on **upward-facing surfaces near the ground and on the
   underside of forms**, tinted toward `#C08863` at 25% and **+6 L\***. This is the period
   document's warm brick bounce turned into a ramp step: the tops of caps and shoulders catch a
   faint warm rim from the sunlit facade above, and the undersides of chins and brims catch a warm
   kick from the roadway. It costs one extra ramp stop and it is the single cheapest thing that
   makes our street read as a street canyon rather than as a diorama.

Ramp banding is **per-material and hand-authored**, never computed per pixel from a light vector.
A kid's face uses the same three bands whichever way they are facing.

### 4.2 Outlines
* **Characters and gameplay-critical props:** **2 px at 1600×900** at mid-field depth, scaling with
  on-screen height, clamped to 1–4 px. Outline colour is a **darkened, saturated version of the fill
  it borders** — same hue ±8°, L\* reduced 40 points — and is **never a uniform grey**.
* **The ball is the exception:** ink `#2A1D1A`, always, per §2.5.
* **Background architecture:** outline weight **≤ 60%** of the character weight, or none at all on
  distant facades. Test: downsample the frame to 25% and back up; the kids must still separate from
  the set.
* **No ambient occlusion, no contact hardening, no screen-space edge effects.** Grounding comes from
  the contact ellipse and from overlap.

### 4.3 Textures
* Painted, hand-authored, generated procedurally in canvas at build time. Brick is painted as
  **courses with the soot gradient baked in vertically** — never a tiling photo, never noise.
* **Feature scale ≥ 6 px at 1600×900.** Any texture that turns to grey mush when downsampled to
  480 px wide is deleted, not tuned.
* **Specular exists on exactly three materials:** window glass, gold leaf, and wet asphalt. Nowhere
  else. Iron is matte. Brick is matte. Rubber is matte.
* **Grime is drawn as shapes**, at that same ≥ 6 px scale: the dark line under a sill, the streak
  below a window, the black upper face of a cornice, the oil halo at the base of an El column, the
  polished silver crown of a Belgian block. Never a multiply layer over the whole frame.

### 4.4 How sooty gets to be cheerful — the five soot laws
This is the question the whole project turns on, so the answer is a checklist, not a feeling.

1. **Soot goes up, the game happens down.** Soot density is a function of height: 0% at the curb,
   ramping to 100% at the cornice. The play plane is the cleanest part of the world. (Law 1.)
2. **Soot only takes value, never chroma.** (Law 3.)
3. **Haze lightens with distance, never darkens.** (§2.3.)
4. **Every sooty region has a saturated neighbour within 128 px.** (Law 4.)
5. **Dirt is a character trait, not a condition.** Every kid's knees, elbows, cuffs and one cheek
   carry drawn smudges from a vocabulary of **three shapes** — cheek streak, knee dust, black palm —
   authored and placed like blush, in `#7A5A46` at 35%. They read as *this kid has been playing all
   afternoon*, which is joyful. They never read as *this kid is poor*, which is not our game.

**And the one veto:** if a critic describes a frame with the word "grim", "bleak", "muddy",
"washed out" or "sepia", the frame fails regardless of its checklist score. That is the failure this
document exists to prevent.

---

## 5. Character design

### 5.1 Proportion — adopted from BYB without amendment
Head height = crown to chin, excluding hair, cap and brim.

* **3.0–3.5 head-heights** standing; head is **29–33% of standing height**.
* Roster spans **≥ 1.0 head-height** end to end; **no more than three kids in any 0.2 bucket.**
* Torso ≈ 1 head-height shoulder to hip. Legs 1.2–1.5. Arms to mid-thigh.
* **Shoulders no wider than the head.** Neck 0–0.15 head-heights.
* Hands are mitts, **55–70% of head width**. Shoes **0.7–0.9 head-heights** long.
* **No muscle definition anywhere. Limbs are tubes.**

### 5.2 How period clothing gets Backyard-ified
The rule: **every garment gets exactly one exaggeration, and the exaggeration is always volume or
hem — never the proportion of the body underneath.**

| Garment | The exaggeration | Why it works |
|---|---|---|
| **Flat cap** | Scaled to **1.15–1.4× the head's plan area**, sitting as a separate solid shape with a hard brim edge | The cap replaces hair-mass as our primary silhouette organ; it is the period's most identifying garment and it is already a big simple shape |
| **Knickers** | A **balloon** ending in a hard horizontal buckle line at the knee. Width at the seat ≈ 1.3× hip width | The buckle-at-the-knee break is unmistakable at 96 px and it splits the leg into two readable shapes |
| **Long stockings** | A soft **accordion sag** above the boot, three folds, asymmetric between left and right leg | Free asymmetry, free character, free period |
| **Suspenders** | Two bold **3 px straps in a saturated colour**, and on at least four kids one strap is off the shoulder | Reads as line-work, carries chroma, breaks the torso silhouette |
| **Shirt** | Sleeves rolled to a **hard cuff roll**, collar open, shirttail out on one side | Ill-fitting, non-uniform — BYB §1.4 exactly |
| **Sweater / vest** | Shapeless, hem below the hip, elbows gone through | This is where the kid's colour lives |
| **Ankle boots** | Oversized per §5.1, tongue out, one lace knotted where it broke | Big extremities make a run cycle funny |

**Forbidden absolutely:** printed graphics of any kind, curved-brim baseball caps, t-shirts, jeans
on a child, zippers (1937 for a trouser fly), gloves, helmets, and anything matching.

### 5.3 Faces
Adopted from BYB verbatim: eyes **12–16% of head width** each, gap ≈ one eye width, sitting at or
just below the head's horizontal midline. Eyebrows are **separate floating shapes**, brow length
1.0–1.4× eye width, four named positions minimum. Noses are a bump, a dot or a comma. Ears optional
and usually under the cap.

**Mouths: six shapes, no more** — flat line, open lower-arc grin, open circle, wide toothy grin,
downturned arc, gritted zigzag. If a critic cannot classify every visible mouth into one of the six,
the rig is too naturalistic.

**Asymmetry is character.** Build in mismatched eyelids, one raised brow, a tongue out of one
corner, deliberately, per kid, on a named side.

### 5.4 The nine silhouette families
We need **nine** distinct silhouette families and we need exactly nine, because nine is the number
of fielders on screen and BYB's blackout test asks a critic to name **6 of 9** at 96 px. The thirty
kids each belong to one family and modify it; a family is a *shape*, a kid is a shape plus a
behaviour.

1. **The Melon** — huge round head at the 33% ceiling, small cap perched on top like a lid, 3.1
   heads. *(Our Melonhead. The head-size joke is in the game itself.)*
2. **The Fireplug** — 2.8 heads, short and wide, barrel torso, zero neck, cap jammed down to the
   eyebrows. Sits deliberately below the 3.0 floor. *(Our Pablo slot: the exception that proves the
   band, and the best hitter on the block.)*
3. **The Beanpole** — 3.9 heads, all leg, knickers riding high, four inches of bare shin between
   buckle and stocking. *(Height and hemline: two cues, one read.)*
4. **The Sack** — a small kid entirely inside an adult's wool sweater. Sleeves past the hands, hem
   at the knee. The silhouette is a **bell** with a cap on it and two boots under it.
5. **The Ears** — average build, enormous ears, and **no cap** — the cap won't stay on over them,
   which is the joke and also why his silhouette is the only bare head in the field.
6. **The Bandbox** — the one kid with money: knife-creased knickers, real Keds, a bow tie he will
   not take off. **The only perfectly symmetrical, perfectly tidy silhouette on the field**, and
   that is precisely what makes him funny standing next to the other eight.
7. **The Ribbon** — a girl playing in a dropped-waist dress and long stockings; hem is a hard
   horizontal at mid-calf, and a hair ribbon breaks the outline above the head. *(Playing ball in a
   dress is the joke and the character, and a girl who plays and is good at it is a period fact.)*
8. **The Barefoot** — no shoes at all, cuffs rolled, cap two sizes too big. His feet are the largest
   objects in his outline and every run cycle is about them.
9. **The Brace** — a boy with a **caliper leg brace and a wooden crutch**, and he is **the best arm
   on the block.** His outline is a different shape entirely from the other eight: three ground
   contacts instead of two, and the crutch swings. He pitches standing, plants the crutch, and his
   windup is the most-imitated motion on the street. **Decision: brace and crutch, not a wheelchair
   —** a 1925 tenement has no ramp and a wheelchair in 1925 is a wicker parlour chair; polio braces
   are the period-true answer, they change the silhouette more, and they move. He is never pitied,
   never explained, and never the subject of a joke. *(Our Kenny slot, and the same lesson: the
   outline changes, the competence does not.)*

**Prop hooks that break the outline** — at least six on the field at any time, one per kid, drawn
from: a pigeon riding a shoulder, a bent coat hanger through the belt, a fan of cigarette cards in
a back pocket, a harmonica, a pair of ice tongs, a mouth organ, a slingshot handle, a rolled
newspaper, a wooden top on a string, a jar with something in it.

**The blackout test is run for real**, exactly as BYB specifies: threshold a fielding frame to solid
black at 96 px and name the kids. **Below 6 of 9, Character cannot score above 4.**

### 5.5 The roster
**30 kids, 15 girls and 15 boys**, spanning at least four of the block's communities (§period 5.3),
all playing on the same street. Four stat axes — **Hitting / Running / Fielding / Arm** — on a
**4-point scale drawn as chalk tally marks** on the player card. Every kid has at least one 4 and at
least one 1 or 2. **Nobody is bad at everything; nobody is good at everything** except one
deliberate legend who caps at 4/4/4/3. The best hitter and the best arm are different kids.

Every kid ships with a **nickname**, from the period's own cruel-and-permanent vocabulary — Red,
Skinny, Fats, Butch, Lefty, Specs, Ears, Curly, Whitey, Sonny, Half-Pint, Beans, Peanuts, Hooks,
Tiny (who is enormous). **One nickname is shared by two kids**, because a shared name is a free
joke. The status title **"two-sewer man"** is earned in play and rendered over the kid's head.

Every kid must be describable in **one clause naming a shape and one clause naming a behaviour**.
If the only available clause is a colour, the kid is not designed yet.

---

## 6. Typography

### 6.1 The tie-breaker sentence
**French Clarendon — the fat condensed Egyptian slab of the period's wall ads — is simultaneously
the most period-true letterform on a 1925 New York block and the most Backyard-shaped letterform
available.** Chunky, high x-height, heavy square slabs, all caps, hand-painted with a wobble. There
is no conflict to resolve here; there is only a face to pick, and we have picked it.

### 6.2 The two faces, and only two
1. **CURB CHALK** — our display and UI face. A hand-lettered **condensed fat Egyptian / French
   Clarendon**, all caps, drawn procedurally with per-glyph jitter. Two renderings of the same
   skeleton: **chalk** (soft, broken, half-scuffed — used on the curb, the stoop flank, the asphalt)
   and **painted slab** (hard, shaded in two extra colours, with a drop shadow — used on titles,
   signs and cards). **Everything numeric in the game is set in this face.**
2. **STOOP SCRIPT** — a brush script, used for exactly three things: the game's logo, team names on
   cards, and shop signs in the world. **Never for numbers, never for state.**

### 6.3 The faces that exist in the world but are banned from the UI
This is the decisive ruling that keeps the block period-dense without making the interface
illegible. **Copperplate Gothic** (the doctor's gold-leaf window), **Cheltenham** (the newspaper,
the handbills), **condensed Gothic sans** (price cards, civic lettering), **Yiddish, Italian and
Chinese hand-lettering** — all of these appear **on props, in the world, at world scale, all the
time, in quantity.** None of them may render a single pixel of HUD. They are thin, genteel and
small; our HUD is chunky, loud and hand-made.

**Geometric sans is banned everywhere** — anachronism *and* style violation, a two-for-one failure.
**No default system font anywhere, ever.** Fonts are embedded base64 or drawn procedurally; there is
no network at runtime.

### 6.4 How it stays readable
* **Jitter: ±1.5° rotation, ±3% scale, ±2% baseline offset per glyph. Seeded and stable per string.**
  Jitter that re-rolls per frame reads as a rendering bug, not as a hand. This is the most common way
  hand-lettering gets shipped broken.
* **Every glyph carrying state is ≥ 24 px tall at 1600×900** and holds **≥ 4.5:1** against the
  material it is painted on. Chalk `#F6F0E2` on shaded asphalt is 5.60:1; on brick soot 5.92:1; on
  bluestone it is 2.73:1, **which is why every chalk mark carries a 1.5 px ink outline** (§2.5).
* **Two type sizes on screen at once, three at the absolute maximum.**
* **Text always sits on a physical ground** — a chalked patch on the curb, a slate, a torn card, a
  taped label, a painted plank. Never on a translucent panel. Never floating.
* **The count must survive downsampling to 480 px wide.** Test it by downsampling, not by squinting.

---

## 7. Audio: how a 1920s score and a Backyard announcer coexist

### 7.1 The governing rule
> **The world's music is 1925. The game's music is now.**

Anything that belongs to the block — the radio in the third-floor window, the hurdy-gurdy at the
corner, the piano being practised badly upstairs, the church bells — is **band-limited 200 Hz–4 kHz,
mid-heavy, with a horn-speaker honk and a little surface noise**, because that is what a 1925
battery receiver sounds like and because thin distant music is the period's own texture.
Anything that **scores the player's own action** — a walk-up sting, a home-run trot, a card flip, a
menu confirm — is **clean, close, bright, and full-band**, because that is Backyard's job. The
filter is the boundary between the world and the game, and the player hears it without ever being
told about it.

Repertoire in the world is hard-limited to **on or before September 1925**: *Yes! We Have No
Bananas*, *Charleston*, *Rhapsody in Blue*, *It Had to Be You*, *Sweet Georgia Brown*, *Five Foot
Two*, *Manhattan*, *Show Me the Way to Go Home*. No swing, no crooner, no electrically-recorded
warmth. **One radio, one window, thin and far** — never wall-to-wall ragtime piano.

### 7.2 The booth is on the block
There is no PA system in 1925 and there is no broadcast of a stickball game, so **our announcers are
two people who are physically present and audible**, which is better than a booth in every way: the
kids can yell back at them, and they can be interrupted.

* **DOT** *(the Sunny Day slot)* — a girl on a third-floor fire escape with a rolled newspaper for a
  megaphone, calling the game because she is not allowed down. Bright, fast, technically correct,
  relentlessly enthusiastic. She keeps the line score in chalk on her windowsill. **The straight
  man. She never acknowledges the joke.**
* **THE GOOCH** *(the Vinnie the Gooch slot — the translation table says keep him, and he is already
  period-correct)* — an iceman on his break, sitting on the tailgate of the wagon, still holding the
  tongs. Brooklyn, deadpan, refers to himself in the third person and it is never explained.
  Undercuts his own bits immediately. Mellow where Dot is hot. **He is the one who is funny.**

**The six writing rules, inherited exactly:** call the play straight then be strange, one beat
later; the non sequitur is about food, weather or personal cowardice, never about baseball; he
undercuts his own bit; third person, unexplained, forever; the straight man never blinks; and the
banter is load-bearing inside the fiction — Dot and the Gooch are neighbourhood figures the kids
talk about, not a layer on top of the game.

**Line inventory, minimum, or the booth repeats inside one game:** 12 strike / 10 ball / 12 out /
10 base-hit / 6 double / 4 triple / 8 home-run (i.e. sewer-shot) / 6 great-play / 6 comic-error /
4 collision / 8 between-innings / 6 lopsided / 6 close-late, plus **one unique reference line per
kid.** Ship a generic fallback and never let it be the only thing a critic hears.

### 7.3 Per-character stings — the highest-leverage audio idea we have
**Every kid gets a 3–6 second sting in a distinct instrumentation**, fired in exactly three places:
**the card, the walk-up, and the trot after a sewer shot.** Each must be nameable by instrument
alone in a blind listen. The instrument bank: klezmer clarinet, tinny ragtime piano, Neapolitan
mandolin, lone cornet, jaw harp, hurdy-gurdy, harmonica, banjo, accordion, tin whistle, washboard,
spoons, jug, kazoo, one-man-band bass drum and cymbal, stride-piano lick.

### 7.4 Effects: the cartoon is the exaggeration of the real object
We keep Backyard's cartoon-library vocabulary — boings, doinks, slide whistles, timpani hits,
ratchets, whip cracks, rubber squeaks, cartoon takes — **and every one of them is welded to a
specific, named period object**, never to a generic event class.

| Object | The real sound | The cartoon exaggeration |
|---|---|---|
| Broomstick on rubber ball | dry hollow **TOCK** | three tiers: dull thock / sharp crack / crack + low thump |
| Fire-escape iron | a ringing clang | pitched, and it **rings down the ladder rung by rung** |
| Ash-can lid | clang | + the classic decaying wobble-to-flat |
| Manhole cover | hollow boom | + a low timpani doink |
| Model T fender | tin tonk | + a spring boing |
| Storefront awning | canvas whump | + a slide whistle on the rebound |
| Plate glass | a flat, terrifying **boom** that does *not* break | + one full beat of total silence |
| Sewer grate | plink | + a descending slide whistle, and gone |
| Klaxon | **ah-OO-gah** | it is already a cartoon; do not touch it |

**Banned:** synthesised whooshes, cinematic braams, sub-bass impacts, notification blips, modern
sirens, tyre screech. Every clickable element makes a **mechanical or comic** sound: a wooden clack,
a boing, a rattle of bottle caps. **Zero synthesised UI blips.**

### 7.5 The mix
* Kid chatter is its **own bus** with its own volume control, firing **every 2–5 seconds** during
  live play, mixed 8–12 dB under the announcers, ducking to −18 dB while a line plays. Chatter is
  drawn from the period dialogue bank (`PERIOD §1.9`) — *"Chuck it here!"*, *"Swing, ya bum!"*,
  *"Ghost man on second!"*, *"Off the fender!"*, *"Sez who?"*, *"Attaboy!"*, *"Some wallop!"*
* Ambience is **4–6 looping layers at different periods** per venue, plus **at least one sporadic
  layer firing every 20–60 s** so the loop never becomes audible. The El, a horse cart, a radio, the
  pigeons, a river horn, kids on another block, a shopkeeper shouting.
* **During a pitch, the loudest thing on the mix is the kids.** Music is silent or a −20 dB bed.
  Music returns for the walk-up sting, the sewer shot, and the end of the inning.
* **No gap over 3 seconds without a voice event** during live play.
* At least two kids speak something other than English on the field — untranslated, unsubtitled,
  and never a punchline about them.
* **Dialect is a performance, never a spelling.** Accents live entirely in the voice acting. No
  on-screen text is ever written phonetically. No "dese", no "dose", no apostrophes standing in for
  a dropped consonant, in any language.

---

## 8. The comedy register

### 8.1 What our jokes are made of
Four ingredients, and everything we write is one or more of them.

1. **Property.** Whose ball, whose stick, whose stoop, whose fire escape, whose mother. The block's
   ownership hierarchy is absolute and emotional: whoever owns the ball has power, whoever owns the
   stick has status, whoever can hit two sewers is the mayor. **"Then take your ball and go home" is
   a mechanic, and sometimes he does.**
2. **Authority evaded, never confronted.** The cop, the janitor, the street sweeper, the grandmother
   at the second-floor window. Kids scatter, the adult never actually catches anyone, and the adult
   is never a villain — he is a weather system with a hat.
3. **The physics of a rubber ball in a stone canyon.** Caroms off fenders, walls, awnings, newel
   posts, ash cans and fire escapes. The ball that goes somewhere impossible and comes back. The
   ball that comes back *later*.
4. **Food.** The Gooch's non sequiturs, the pushcart, the egg cream, the chestnut cart, and one
   stolen apple that is never eaten — it just travels from kid to kid all game.

Plus the engine that runs on all four: **the argument.** Every dispute is settled by volume, then
by seniority, then by who owns the ball, and it is the funniest thing in the game because it has a
setup, a beat, and a loser.

### 8.2 The mechanical test
For every gag we ship, write down **the setup frame, the payoff frame, and the seconds between
them.** If you cannot name two frames, you have built a decoration, and decorations do not get
funnier on the tenth viewing. **A gag the player can cause on purpose is worth ten gags that just
play.** Minimum per game: one announcer non sequitur per half-inning, one physical gag per inning,
one environmental gag per venue that the player can trigger deliberately.

### 8.3 What our jokes are never made of
Nobody's ethnicity, accent, language, religion, poverty, body, or brace. The block is polyglot and
poor and that is a **fact of the setting, permanently, never a punchline, not once.** Weakness is
written as personality, never as pity, and the text never apologises for anyone.

Also never: Prohibition, speakeasies, gangsters, adult vice, or violence. And never **pathos** —
no Dickensian urchin, no "poor but happy", no hungry child, no orphan. This is a Tuesday afternoon
and these kids are having the best two hours of their week.

---

## 9. The twelve signature moments

The finished game must be able to produce all twelve. These are the beats a player tells a friend
about. Each is named, each has a setup and a payoff, each is skippable after 1.2 s, and each has at
least three variants if it can fire more than five times per game.

1. **CAR!** — a klaxon two blocks off, then the shout. Every kid drags a base out of the road, the
   batter steps to the curb holding the stick vertical, the Model T crawls through at eight miles an
   hour, somebody slaps the fender as it passes, the driver shakes a fist, and **the play is a
   do-over**. Timer, warning, scatter, resume. This is the signature beat of street stickball and it
   is worth half the period work on its own.
2. **The Sewer Shot** — a ball hit clean past the second casting on the fly. The pigeons come off
   the cornice in a sheet, the hitter's instrument sting plays as he trots, the Gooch measures it
   **out loud, in sewers**, and a chalk mark with the kid's initial goes on the curb. He is a
   **two-sewer man** for the rest of the game, and the label renders over his head.
3. **Down the Sewer** — the ball goes through the catch-basin grate. Everything stops. Five kids on
   their knees at the gutter, one arm in to the shoulder, an argument about whose fault it was, and
   somebody produces a bent coat hanger with gum on the end. A real minigame with a real timer and a
   real fail state — **and the ball comes back filthy and stays filthy for the rest of the game.**
4. **The Fire Escape Rattle** — a foul off the second-floor balcony. The ball drops through the bar
   grating, hits the drop ladder, and **rattles down rung by rung**, each rung a distinct pitched
   clang, before dropping into the areaway. The ball is live the whole way down and a fielder is
   already underneath it.
5. **The Window That Doesn't Break** — a line drive hits a pane flat-on. It **flexes and booms** and
   does not break. Total silence, every kid frozen mid-stride, for a full beat. Then a woman's face
   appears at the glass and the game resumes at double speed.
6. **Cheese It** — the cop turns the corner. Sticks vanish behind backs, the batter starts an
   innocent conversation with the shortstop, and one kid is left holding the ball with nowhere on
   earth to put it. The cop walks the whole length of the block. Thirty seconds. The instant he
   turns the far corner the game resumes **mid-sentence**.
7. **The Ash Can Lid** — a hot grounder into the cans at the curb. The lid spins off and wobbles
   flat with the full decaying wobble, and the second baseman **picks it up and fields the carom
   with it.** Not legal. Nobody objects. *(Comic-error variant: the lid rolls away down the gutter
   and the fielder chases the lid instead of the ball.)*
8. **Ghost Man on Second** — with too few kids, a runner is left as a ghost: a **chalk outline of a
   kid** standing on the casting, translucent, with its own small idle fidget. It advances exactly
   as far as the batter and never scores on a judgment call without a fight. The argument about
   whether the ghost scored is scripted, voiced, and settled by volume, then seniority, then who
   owns the ball.
9. **The Iceman's Wagon** — the horse-drawn ice wagon parks in short right field for a whole half
   inning. It is now a wall. Balls off the box are live and drop dead; a ball into the sawdust is
   gone; the iceman throws chips to the kids between pitches; and when he finally pulls out **the
   field gets bigger and the whole outfield has to re-set.** A venue that changes shape mid-game.
10. **FRAAAAN-KIEEE!** — a mother's two-syllable call from a fourth-floor window, held long and
    dropping. Your best hitter's shoulders drop. He hands over the stick and goes upstairs, and he
    is **replaced by his little brother**, who has been sitting on the stoop the entire game waiting
    for exactly this, whose card is terrible, and whose idle animation is now vibrating with joy.
    A real roster mechanic, and it is funny and sad in the same two seconds.
11. **The Hand-Over-Hand** — the pre-game ritual, every game, fully animated. Two captains, fist
    over fist up the broom handle, alternating, the block chanting the count. If there is not enough
    stick left, the last hand must grip the tip and **swing the stick around his head three times
    without dropping it.** The loser's face is a whole performance. *(This is BYB's playground draft
    ritual, translated exactly: the interface is the ceremony of being picked.)*
12. **The Lights Come On** — the ending. Windows go warm `#FFB460` one at a time up the facade while
    the street goes blue, and **the ball genuinely gets harder to see** against the asphalt. The
    game makes you play one final at-bat where the chalk lines, the chalk pitch ring and the ball's
    chalk rim are the only things still fully readable — the Chalk Ceiling doing its job as a
    dramatic device — and then everybody's mother wins and the block empties.

---

## 10. Venues

Every venue answers BYB's question: **whose is this, and what do they do here when nobody's playing
ball?** Five surfaces, separable by ground hue alone in a 64×64 crop, and each with **at least three
named props that change play**.

| Venue | Surface | Whose it is | Three props that change play |
|---|---|---|---|
| **Ninety-Fifth Street** | patched asphalt over Belgian block | the Gucciardo brothers' ice-and-coal is the corner store; the Gooch works there | the ash cans at the curb; the second-floor fire escape; the parked Ford (first base, and it kicks left) |
| **Under the El** | Belgian block, permanent brown twilight | nobody's, which is why they play there | steel columns standing in fair territory; a train every 2–4 minutes that erases sound and strobes the light; the pawnbroker's awning |
| **The Lot** | packed dirt where a building came down | the landlord's, and he is in Florida | the exposed party wall (a three-layer ghost-sign gallery); the wooden hoarding pasted with bills; the cellar hole nobody filled |
| **The Schoolyard** | swept cement | P.S. 108's, out of hours | the iron palisade fence; the janitor; a chalked fast-pitch strike zone on the flattest wall, 20 in × 30 in, bottom edge 18 in up |
| **The Pier** | wooden deck, river end | the longshoremen's, and they bet on you | the bollards; the open water in right (ball gone forever); the foghorn |

The ladder's top, earned and not chosen: **the ballpark you can see from the roof** — the
aspiration, at a distance, never entered.

**One night venue, unlocked, never offered:** the block under the new electric streetlights. Its
sewer-shot payoff is **per-character** and it costs almost nothing: the pigeon flock comes off the
coop and **forms the hitter's silhouette** against the lit windows before scattering.

**Boundaries are irregular and asymmetric in every venue** — different heights, different materials,
different distances — and **at least one boundary object per venue produces a unique sound and a
unique outcome** on contact.

---

## 11. HUD — the translation table

Every HUD element is a **depicted physical object with a nameable material**. Point at it and name
what it is made of; if the honest answer is "a rectangle", it fails.

| Backyard Baseball (1997) | Ours |
|---|---|
| The juice-box stamina meter | **An egg cream in a glass on the stoop step.** The foam head collapses first — that is when the pitcher's accuracy starts to waver — then the level drops. Empty means go to the pen. |
| The *More Juice* power-up | **The candy-store man sends down another one**, on a tray, from the basement shop |
| The scorebug | **Chalk tallies on the granite curb**, half scuffed away, rewritten each inning |
| Balls / strikes / outs | **Three chalked patches on the curb flank**, tally marks, ≥ 24 px |
| Base occupancy diamond | **A chalk diamond scratched on the flank of the stoop**, its four corners drawn as the actual objects — casting, hydrant, lamppost, casting — filled in with chalk when occupied |
| The grey pitch-location circle | **A chalk ring**, ≥ 40 px at 1600×900, ≥ 3:1, with a 1.5 px ink outline, visible to batter and pitcher alike |
| The ball's landing marker | **A chalk ring**, ≥ 14 px, ink-outlined, present from contact |
| Four ratings drawn as baseballs, 1–4 | **Four chalk tally marks**, 1–4, on a torn card |
| Player cards in a trophy case | **Cigarette cards in a rubber band**, in a cigar box under the stoop |
| The Clubhouse | **The candy store** — a place you click around in, with **at least one hidden interaction** that rewards clicking something that is not a button, and it confirms itself with a sound |

**Constraints, all inherited and all checkable:** total persistent HUD area **≤ 12% of frame**, in
**≤ 3 corner clusters**, each inside a **4% safe margin**, nothing overlapping the batter, the
pitcher, the ball or the landing marker. **Zero HUD pixels may be a neutral grey with S < 0.10.**
No axis-aligned rectangle with four equal corners. Every element sits at ±1–4° from frame axes.
No progress bars, no hairlines under 1.5 px, no UI-kit icons, no default fonts.

**Every numeric quantity is a thing, and every thing has a visible behavioural consequence when it
empties.** That is the whole lesson of the juice box and it is not negotiable.

---

## 12. Animation and feel — inherited without amendment

`BYB-REFERENCE §5` and `§7.1` transfer wholesale. Restated only where the period changes a prop:

* **12 fps feel on a 60 fps render.** Poses held, transitions quick, no interpolated mush. Every
  action contains **≥ 3 distinct, freezable, screenshot-worthy poses**.
* **Hitstop 4–6 frames on solid contact.** Ball squashes to **1.35–1.6×** along the velocity axis for
  2–4 frames at contact and at every hard carom — and in a stone canyon there are a *lot* of hard
  caroms, which is free Feel.
* **Anticipation before everything. Follow-through and overlap on everything.** Every kid carries at
  least one secondary element that lags the body 2–4 frames: a cap brim, a shirttail, a suspender
  strap, a stocking fold, a hair ribbon, the crutch.
* **Three idle fidgets per kid, character-specific, on a randomised timer.** Across a 10-second
  static capture, no two kids in the same pose and ≥ 3 visibly moving. Period fidgets: tapping the
  stick twice on the manhole, spitting in the palms and rubbing them, rubbing the ball on a thigh,
  hitching the suspender back onto the shoulder, pulling a stocking up, checking the coat hanger.
* **Batting stances are traceable to a named real stance** — a 1925 newsreel, a photograph, a named
  ballplayer — and the brief says which. A generic batting pose is not a stance.
* **Four comic-failure animations minimum** (bobble, collision, through-the-legs, the ball that
  lands between two kids who both stopped), each with its own audio call — and, copying the 1997
  options menu, **a settings toggle that turns comic errors off**.
* **Pacing:** at-bat 20–40 s, half-inning 90–150 s, full game 12–20 min. **≤ 3 s of dead time**
  before *something* happens. Walk-ups ≤ 2.0 s, two variants each, interruptible from frame 1.
* **Camera:** three-quarter, **20–35° above horizontal**, FOV 35–55°, changing by situation and
  never for drama. The **north cornice line is our horizon** and it sits in the **upper 30–45%** of
  the frame. Four readable depth bands, one foreground element overlapping the play plane without
  hiding the ball. Batter and pitcher **18–26% of frame height**; no fielder under 8%.

---

## 13. Aliveness

**≥ 5 things doing something the player did not cause, in every gameplay frame**, each caught
mid-action and asymmetric, verified by comparing two frames 0.06 s apart. In our idiom:

laundry moving on a fire escape · a shutter banging · a curtain lifting · pigeons crossing the sun
band and flashing white as they bank · a stray dog on the foul line · smoke from a chimney-pot
cluster · steam off the ice wagon · a woman leaning out a third-floor window on a folded towel ·
the pigeon man on the roof waving his bamboo pole · a horse shifting its weight and swishing its
tail · the barber pole turning · an El train at the mouth of the street · a kid on a stoop who is
not in the game, flipping cigarette cards against the wall.

**Spectators are individuals, not a texture:** 6–15 of them, ≥ 3 distinct silhouettes, ≥ 2 animating
at any moment, sitting in **clusters** because stoops project 4–6 ft into the sidewalk and break it
into alcoves. Crowd has a **reaction state machine** with at least four states — idle, lean-in,
celebration, groan — and **at least one synchronised group gag** where everybody leans, ducks, or
stands up at once.

**And one deliberate dead spot per venue:** one stretch of curb with nothing on it, one blank party
wall, one unlit window. A block that is interesting at every point is a diorama, not a street.

---

## 14. Amendments to BYB-REFERENCE §9 — what a critic scores us against

The single-frame test stands, with these six numbered checks superseded. A critic scoring one of our
frames uses **this** column. Everything not listed here is unchanged.

| BYB check | Original | **Superseded by** | Why |
|---|---|---|---|
| **8** — saturation | three largest colour areas at S ≥ 0.35 | **The two largest *vertical* areas (brick, sky) at S ≥ 0.30; the roadway at S 0.16–0.26; and ≥ 6 accent patches at S ≥ 0.45 totalling ≥ 4% of frame area** | A stone street cannot reach S 0.35 on its ground plane without turning purple. We pay the bill in awnings, signage, produce, dyed wool and the ball. |
| **9** — hue count | 7–12 distinct hues, fail below 6 or above 15 | **9–14 distinct hues; hard fail below 8 or above 15** | We spend saturation in more, smaller places, so we need more hues to clear the same bar. |
| **10** — sky vs ground | sky 25–40% of frame area | **Above-horizon material 25–40% of frame area; open sky alone 8–18%** | A 1:1 canyon cannot show 25% open sky at a 20–35° camera pitch. Cornices, water tanks, chimney pots, laundry and pigeons count — and they are what makes our upper third *better* than an empty blue field. The L\* and hue requirements are unchanged and we pass them cleanly (24.9-point gap, hues 210° / 28°). |
| **13** — the ball | ≥ 4.5:1 against its backdrop | **The Two-Sided Ball: best-of-two (chalk rim / ink outline) ≥ 4.0:1, measured against an 11×11 annulus at five points along the arc** | 4.5:1 is mathematically unattainable against a backdrop at L\* 49 — the theoretical maximum from pure white is 4.65 and from pure black 4.52. See §2.5 for the derivation and the full measured table. |
| **12** — shadows | opacity 0.25–0.45, tinted | **opacity 0.28–0.42, tinted `#3E4658`** | Both parents agree; we just name the colour. |
| **— light** | no 64×64 region below L\* 25 | **no 64×64 region below L\* 26; brightest:darkest under 5:1** | Slightly stricter, because our world is genuinely dirtier and needs the guard rail. |

**Four checks are added, specific to us. All four are answerable from a single PNG.**

| # | Check | Feeds axis |
|---|---|---|
| **A1** | **The Chalk Ceiling and the Ink Floor hold.** No environment material above L\* 80 or below L\* 28; chalk-cream appears only on readability marks; ink appears only on outlines. | Readability |
| **A2** | **Soot took value, not chroma.** Sooted brick has the same hue and S as clean brick, only lower L\*. No global grade, no sepia, no desaturation, no dirt overlay. | Craft |
| **A3** | **The street is over-lettered.** ≥ 3 pieces of hand-lettered signage large enough to read the words, ≥ 2 striped or coloured awnings, ≥ 1 painted advertisement on brick, ≥ 1 ghost sign, ≥ 1 gold-leaf window. | Period truth |
| **A4** | **The Bright Middle holds.** Median L\* at the crown of the road exceeds median L\* of the fourth-floor brick by 7–14 points. | Craft |

**And the veto, alongside BYB's "no kid at rest":** if the honest one-word description of the frame
is *grim*, *bleak*, *muddy*, *washed out* or *sepia*, stop scoring and report that. It is the only
failure mode this project is genuinely at risk of, and no checklist score redeems it.

---

## 15. What we will NOT do

**Rendering and colour**
1. No sepia, no desaturation, no global colour grade, no LUT, no tone-mapping curve.
2. No bloom, vignette, chromatic aberration, depth of field, film grain, or motion-blur post.
3. No ambient occlusion, no contact hardening, no screen-space edge effects.
4. No PBR, no normal maps, no roughness maps. No specular anywhere except window glass, gold leaf
   and wet asphalt.
5. No grime overlay, no dirt-as-tone, no "aged" filter. Dirt is drawn, at ≥ 6 px feature scale.
6. No dark corners. Nothing below L\* 28, ever, anywhere.
7. No dramatic key light, no rim-lighting cinematography, no night as a default. One night venue,
   unlocked.
8. No physically-accurate sun. Our light is authored, and §3 says exactly how and why.

**Period**
9. No stamped Spalding High-Bounce ball, and the word "Spaldeen" never appears as on-screen text or
   in a spoken line. The ball is a stripped tennis core or a plain unbranded rubber ball.
10. No gloves, no bases, no mound, no batting helmets, no foul poles, no backstop, no scoreboard, no
    aluminium, no baseball bat silhouette.
11. No organised stickball: no matching shirts, no sponsor across the chest, no trophy, no adult
    keeping score, no league, no tournament bracket handed down by a grown-up. Leagues and uniforms
    are the post-1945 revival.
12. No adults supervising, coaching, or refereeing. There is no umpire; arguments are settled by
    volume, then seniority, then who owns the ball.
13. No gangster kitsch, no Prohibition content, no speakeasy, no fedora pulled low, no tommy gun, no
    anyone called "Bugsy".
14. No Model A or any 1930s car; no coloured Model Ts in quantity; no wire wheels as default.
15. No chain-link fence, no plastic of any kind, no modern road markings, no parking meters, no
    neon, no roll-down security gate, no rooftop antenna.
16. No overhead trolley wire or telephone poles on a Manhattan street; no IND subway entrance.
17. No laundry cat's cradle strung across the street above the game.
18. No rounded river cobblestones; no green leafy street trees, lawns, gardens or driveways.
19. No wrong skyline. No Chrysler, no Empire State, no 40 Wall, no GW Bridge. The view down the
    block ends in the El.
20. No uniform procedural block: heights vary 2–8 ft, and no two adjacent buildings share more than
    one of {brick, cornice paint, sash colour, iron finish}.
21. No `DEPARTMENT OF SANITATION`, no `THE BIG PARADE`, no `BEN-HUR`, no San Gennaro banner, no
    zipper, no "now you're cooking", no domed police helmet, no "four-sewer man".

**Interface and type**
22. No default system font, no geometric sans, no UI-kit icon, no progress bar, no grey rounded
    rectangle, no hairline under 1.5 px, no drop shadow at 0.1 opacity.
23. No Copperplate Gothic or Cheltenham in the UI — they live in the world only.
24. No more than two typefaces in the entire game. No per-frame jitter.
25. No HUD element that is a graphic primitive rather than a depicted physical object.

**Audio**
26. No synthesised UI blips, no cinematic braams, no sub-bass impacts, no modern siren, no tyre
    screech, no PA system.
27. No wall-to-wall ragtime piano. One radio, one window, thin and far.
28. No music from after September 1925 in the world layer.

**Writing and tone**
29. No joke about anyone's ethnicity, accent, language, religion, poverty, body, or brace. Ever.
30. No pathos: no Dickensian urchin, no "poor but happy", no hunger, no orphan, no pity.
31. No dialect spelling in on-screen text, in any language. Accent lives in the performance.
32. No announcer who sounds like a modern sports broadcast. No line inventory smaller than §7.2.

**Scope**
33. No second city, no licensed players, no real team names, no season simulation, no card economy,
    no online play, no monetisation surface. If it is not in this document or the two references, it
    is not in the build.

---

## 16. The quick tie-breakers

Pin these above the desk. Each one settles an argument in a sentence.

* **Period owns the nouns. Backyard owns the adjectives, the verbs and the jokes.**
* **Soot takes value, never chroma.**
* **Chalk is our white. Ink is our black. Nothing in the world may be either.**
* **Dark at the edges, bright in the middle — built out of material, never out of post.**
* **The haze lightens with distance.**
* **The ball is drawn three times: outline, body, rim. Best-of-two ≥ 4.0:1, always.**
* **Every chalk mark carries an ink outline.**
* **The shirt is period; the colour moves up to the sweater.**
* **One team accessory, ≤ 15% of the silhouette. If you can read the team before you can read the
  kid, we built a uniform.**
* **The cap is the hair.**
* **French Clarendon is both the most 1925 and the most Backyard letterform there is. Use it.**
* **The world's music is 1925. The game's music is now.**
* **The announcers are on the block, and the kids can yell back.**
* **The cartoon sound is the exaggeration of the real object's sound, never a substitute for it.**
* **Every gag has a named setup frame and a named payoff frame, or it is a decoration.**
* **If the honest one-word description is "grim", we have failed, whatever the checklist says.**
