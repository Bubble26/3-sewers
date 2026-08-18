#!/usr/bin/env python3
"""Live workbench renderer. Reads state.json -> index.html.

The page borrows the game's own discipline: aged-paper and night-street
grounds, ink and sepia, and exactly one saturated colour — the pink
spaldeen — spent on the single loudest thing. Status uses desaturated
period hues so it never competes with the ball.
"""
import json, os, base64, html, io

ROOT = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(f"{ROOT}/state.json"))
E = html.escape


def img_tag(path, w=300):
    """Inline every shot as a JPEG. The workbench is opened over a link, so a
    page that takes ten seconds to paint is a page nobody opens."""
    p = f"{ROOT}/shots/{path}"
    if not os.path.exists(p):
        return f'<div class="missing">missing: {E(path)}</div>'
    from PIL import Image
    im = Image.open(p).convert("RGB")
    if im.width > w * 2:
        im = im.resize((w * 2, round(im.height * w * 2 / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True)
    b = base64.b64encode(buf.getvalue()).decode()
    return f'<img src="data:image/jpeg;base64,{b}" alt="{E(path)}" loading="lazy">'


STATUS = {
    "pass": ("holding", "ok"),
    "work": ("in hand", "work"),
    "fail": ("broken", "bad"),
    "todo": ("untouched", "idle"),
    "new":  ("in hand", "work"),
}


def sub_card(s):
    label, tone = STATUS.get(s.get("status", "todo"), ("untouched", "idle"))
    score = int(s.get("score", 0))
    shots = "".join(
        f'<figure>{img_tag(x["f"], x.get("w", 240))}'
        f'<figcaption>{E(x.get("c", ""))}</figcaption></figure>'
        for x in s.get("shots", []))
    gap = (f'<p class="gap"><span class="gap-k">largest gap</span>'
           f'{E(s["gap"])}</p>') if s.get("gap") else ""
    pips = "".join(
        f'<i class="{"on" if i < score else ""}"></i>' for i in range(10))
    return f"""<article class="sub t-{tone}">
  <header>
    <h3>{E(s['name'])}</h3>
    <span class="state">{label}</span>
  </header>
  <div class="meter" role="img" aria-label="{score} out of 10">
    <div class="pips">{pips}</div><span class="num">{score}<em>/10</em></span>
  </div>
  <p class="barline"><span class="k">bar</span>{E(s.get('bar', ''))}</p>
  <p class="note">{E(s.get('note', ''))}</p>
  {gap}
  {f'<div class="shots">{shots}</div>' if shots else ''}
</article>"""


subs = "".join(sub_card(s) for s in S["subsystems"])
gaps = "".join(
    f'<li class="p{E(g.get("pri","?"))[-1:]}"><span class="pri">{E(g.get("pri","?"))}</span>'
    f'<span>{E(g["t"])}</span></li>' for g in S["gaps"])
bars = "".join(
    f'<tr><th scope="row">{E(b["sys"])}</th><td>{E(b["ref"])}</td>'
    f'<td class="how">{E(b["measure"])}</td></tr>' for b in S["bars"])
log = "".join(
    f'<li><span class="rd">{E(l["t"])}</span><span>{E(l["m"])}</span></li>'
    for l in S["log"][:40])

n_pass = sum(1 for s in S["subsystems"] if s.get("status") == "pass")
n_bad = sum(1 for s in S["subsystems"] if s.get("status") == "fail")
n_all = len(S["subsystems"])

open(f"{ROOT}/index.html", "w").write(f"""<title>Three Sewers Workbench</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="45">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Azeret+Mono:wght@400;600&display=swap">
<style>
:root{{
  --paper:#EDE3CE; --paper2:#E4D8BE; --card:#F5EEDD;
  --ink:#221C16; --ink-soft:#4A3F33; --sepia:#7A6A54; --rule:#CDBE9F;
  --ball:#D9414F;                     /* the spaldeen: the one saturated thing */
  --ok:#4E7263; --work:#A87A2B; --bad:#8E3B34; --idle:#9C8E77;
  --shadow:0 1px 0 rgba(34,28,22,.06), 0 6px 22px -14px rgba(34,28,22,.5);
}}
@media (prefers-color-scheme:dark){{
  :root:not([data-theme="light"]){{
    --paper:#171310; --paper2:#1F1913; --card:#221C16;
    --ink:#EFE4CB; --ink-soft:#C4B69A; --sepia:#9C8B70; --rule:#3A2F25;
    --ball:#E4626F;
    --ok:#7FA890; --work:#D3A34A; --bad:#C4685E; --idle:#7A6E5C;
    --shadow:0 1px 0 rgba(0,0,0,.4), 0 8px 26px -16px #000;
  }}
}}
:root[data-theme="dark"]{{
  --paper:#171310; --paper2:#1F1913; --card:#221C16;
  --ink:#EFE4CB; --ink-soft:#C4B69A; --sepia:#9C8B70; --rule:#3A2F25;
  --ball:#E4626F;
  --ok:#7FA890; --work:#D3A34A; --bad:#C4685E; --idle:#7A6E5C;
  --shadow:0 1px 0 rgba(0,0,0,.4), 0 8px 26px -16px #000;
}}
*{{box-sizing:border-box}}
body{{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:"Newsreader",Georgia,serif; font-size:17px; line-height:1.5;
  -webkit-text-size-adjust:100%;
}}
.wrap{{max-width:1180px; margin:0 auto; padding:28px 20px 80px;
  display:flex; flex-direction:column; gap:34px}}

/* --- chalk scoreboard headline ------------------------------------- */
.top{{border:2px solid var(--ink); background:var(--paper2);
  box-shadow:var(--shadow); padding:22px 24px;
  display:flex; flex-direction:column; gap:14px}}
.eyebrow{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:11px;
  letter-spacing:.20em; text-transform:uppercase; color:var(--sepia);
  display:flex; gap:16px; flex-wrap:wrap}}
h1{{font-family:"Alfa Slab One",Rockwell,serif; font-weight:400; margin:0;
  font-size:clamp(30px,5.4vw,52px); line-height:1; letter-spacing:-.01em;
  text-wrap:balance}}
h1 .dot{{color:var(--ball)}}
.headline{{margin:0; max-width:66ch; font-size:19px; color:var(--ink-soft)}}
.tally{{display:flex; gap:26px; flex-wrap:wrap; padding-top:12px;
  border-top:1px solid var(--rule);
  font-family:"Azeret Mono",ui-monospace,monospace; font-size:12px;
  letter-spacing:.10em; text-transform:uppercase; color:var(--sepia)}}
.tally b{{font-size:22px; color:var(--ink); letter-spacing:0;
  font-variant-numeric:tabular-nums; display:block}}

h2{{font-family:"Alfa Slab One",Rockwell,serif; font-weight:400;
  font-size:15px; letter-spacing:.06em; text-transform:uppercase;
  margin:0 0 14px; color:var(--ink);
  padding-bottom:8px; border-bottom:2px solid var(--ink)}}

/* --- subsystem board ------------------------------------------------ */
.board{{display:grid; gap:16px;
  grid-template-columns:repeat(auto-fill,minmax(330px,1fr))}}
.sub{{background:var(--card); border:1px solid var(--rule);
  border-left:5px solid var(--tone,var(--idle)); box-shadow:var(--shadow);
  padding:16px 18px; display:flex; flex-direction:column; gap:10px}}
.t-ok{{--tone:var(--ok)}} .t-work{{--tone:var(--work)}}
.t-bad{{--tone:var(--bad)}} .t-idle{{--tone:var(--idle)}}
.sub header{{display:flex; align-items:baseline; justify-content:space-between;
  gap:10px}}
.sub h3{{margin:0; font-size:20px; font-weight:600; letter-spacing:-.01em}}
.state{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; color:var(--tone);
  border:1px solid var(--tone); border-radius:2px; padding:2px 7px;
  white-space:nowrap}}
.meter{{display:flex; align-items:center; gap:10px}}
.pips{{display:flex; gap:3px; flex:1}}
.pips i{{flex:1; height:7px; background:var(--rule); border-radius:1px}}
.pips i.on{{background:var(--tone)}}
.num{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:15px;
  font-weight:600; font-variant-numeric:tabular-nums}}
.num em{{font-style:normal; font-size:11px; color:var(--sepia)}}
.barline,.note,.gap{{margin:0; font-size:15px}}
.barline{{color:var(--ink-soft)}}
.k,.gap-k{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; color:var(--sepia);
  margin-right:8px}}
.note{{color:var(--ink-soft)}}
.gap{{background:var(--paper2); border-left:2px solid var(--tone);
  padding:8px 10px; font-size:14px}}
.shots{{display:flex; flex-wrap:wrap; gap:12px; margin-top:4px}}
figure{{margin:0; flex:1 1 240px; min-width:0}}
figure img{{width:100%; height:auto; display:block;
  border:1px solid var(--rule)}}
figcaption{{font-size:12.5px; color:var(--sepia); margin-top:5px;
  line-height:1.35}}
.missing{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:11px;
  color:var(--bad); border:1px dashed var(--bad); padding:8px}}

/* --- gaps: the only place the spaldeen colour is spent -------------- */
.gaps{{list-style:none; margin:0; padding:0;
  display:flex; flex-direction:column; gap:1px; background:var(--rule);
  border:1px solid var(--rule)}}
.gaps li{{display:flex; gap:14px; align-items:baseline;
  background:var(--card); padding:11px 14px}}
.pri{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:11px;
  font-weight:600; letter-spacing:.10em; color:var(--sepia); min-width:26px}}
.gaps li.p0 .pri{{color:var(--ball)}}
.gaps li.p0{{box-shadow:inset 3px 0 0 var(--ball)}}

/* --- quality bars --------------------------------------------------- */
.tbl{{overflow-x:auto; border:1px solid var(--rule); background:var(--card)}}
table{{border-collapse:collapse; width:100%; min-width:640px; font-size:14.5px}}
th,td{{text-align:left; vertical-align:top; padding:11px 14px;
  border-bottom:1px solid var(--rule)}}
thead th{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:10px;
  letter-spacing:.14em; text-transform:uppercase; color:var(--sepia);
  border-bottom:2px solid var(--ink)}}
tbody th{{font-weight:600; white-space:nowrap}}
.how{{color:var(--ink-soft)}}
tbody tr:last-child th,tbody tr:last-child td{{border-bottom:0}}

/* --- log ------------------------------------------------------------ */
.log{{list-style:none; margin:0; padding:0;
  display:flex; flex-direction:column; gap:9px}}
.log li{{display:flex; gap:14px; font-size:15px; color:var(--ink-soft);
  padding-left:2px}}
.rd{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:10px;
  letter-spacing:.12em; color:var(--sepia); padding-top:4px; min-width:22px}}
footer{{font-family:"Azeret Mono",ui-monospace,monospace; font-size:11px;
  letter-spacing:.10em; text-transform:uppercase; color:var(--sepia);
  border-top:1px solid var(--rule); padding-top:16px}}
@media (max-width:560px){{ .board{{grid-template-columns:1fr}} }}
</style>

<div class="wrap">
  <header class="top">
    <div class="eyebrow">
      <span>Round {S['round']}</span><span>run opened {E(S['run_started'])}</span>
      <span>refreshes every 45s</span>
    </div>
    <h1>Three Sewers<span class="dot">.</span></h1>
    <p class="headline">{E(S['headline'])}</p>
    <div class="tally">
      <span>holding<b>{n_pass}<span style="font-size:13px;color:var(--sepia)">/{n_all}</span></b></span>
      <span>broken<b>{n_bad}</b></span>
      <span>open gaps<b>{len(S['gaps'])}</b></span>
    </div>
  </header>

  <section>
    <h2>Subsystems</h2>
    <div class="board">{subs}</div>
  </section>

  <section>
    <h2>Open gaps, worst first</h2>
    <ul class="gaps">{gaps}</ul>
  </section>

  <section>
    <h2>Quality bars &amp; how each is judged</h2>
    <div class="tbl"><table>
      <thead><tr><th scope="col">Subsystem</th><th scope="col">Reference</th>
        <th scope="col">How it is measured</th></tr></thead>
      <tbody>{bars}</tbody>
    </table></div>
  </section>

  <section>
    <h2>Log</h2>
    <ul class="log">{log}</ul>
  </section>

  <footer>Every score here is provisional until an independent critic has
  looked at the actual pixels or measurements. Builders do not grade
  their own work.</footer>
</div>
""")
print("workbench ->", f"{ROOT}/index.html")
