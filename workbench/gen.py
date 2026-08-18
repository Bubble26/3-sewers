#!/usr/bin/env python3
"""Live workbench renderer. Reads state.json -> index.html."""
import json, os, base64, glob, html, datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(f"{ROOT}/state.json"))

def img_tag(path, w=300):
    """Inline every shot as a JPEG. The workbench is opened over a link, so a
    page that takes ten seconds to paint is a page nobody opens."""
    p = f"{ROOT}/shots/{path}"
    if not os.path.exists(p): return f'<div class="missing">missing: {html.escape(path)}</div>'
    from PIL import Image
    import io
    im = Image.open(p).convert("RGB")
    if im.width > w * 2:
        im = im.resize((w * 2, round(im.height * w * 2 / im.width)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=82, optimize=True)
    b = base64.b64encode(buf.getvalue()).decode()
    return f'<img src="data:image/jpeg;base64,{b}" style="width:{w}px">'

STATUS_COLORS = {"pass":"var(--ok)","work":"var(--work)","fail":"var(--bad)","todo":"var(--idle)","new":"var(--work)"}

def sub_card(s):
    col = STATUS_COLORS.get(s.get("status","todo"), "var(--idle)")
    bar = s.get("score", 0)
    shots = "".join(f'<figure>{img_tag(x["f"], x.get("w",240))}<figcaption>{html.escape(x.get("c",""))}</figcaption></figure>' for x in s.get("shots",[]))
    return f"""<article class="sub">
      <header><span class="dot" style="background:{col}"></span>
        <h3>{html.escape(s['name'])}</h3>
        <span class="score">{bar}<span class="of">/10</span></span></header>
      <p class="bar"><b>Bar:</b> {html.escape(s.get('bar',''))}</p>
      <p class="cur">{html.escape(s.get('note',''))}</p>
      {f'<p class="gap"><b>Largest gap:</b> {html.escape(s["gap"])}</p>' if s.get("gap") else ''}
      <div class="shots">{shots}</div>
    </article>"""

subs = "".join(sub_card(s) for s in S["subsystems"])
gaps = "".join(f'<li><span class="pri">{html.escape(g.get("pri","?"))}</span> {html.escape(g["t"])}</li>' for g in S["gaps"])
bars = "".join(f'<tr><td>{html.escape(b["sys"])}</td><td>{html.escape(b["ref"])}</td><td>{html.escape(b["measure"])}</td></tr>' for b in S["bars"])
log = "".join(f'<li><time>{html.escape(l["t"])}</time> {html.escape(l["m"])}</li>' for l in S["log"][:40])

open(f"{ROOT}/index.html","w").write(f"""<!doctype html><html><head><meta charset="utf-8">
<title>Three Sewers — Gauntlet Workbench</title>
<meta http-equiv="refresh" content="45">
<style>
:root{{--bg:#16120f;--panel:#1f1a15;--panel2:#272019;--ink:#efe3c8;--ink2:#a89madjust;--ink2:#a8987f;
--rule:#3a3028;--ok:#7ba05b;--work:#d9a441;--bad:#c0554f;--idle:#5c5145;--pink:#e4626f}}
*{{box-sizing:border-box}}
body{{background:var(--bg);color:var(--ink);font:15px/1.6 Georgia,serif;margin:0;padding:26px 20px 70px}}
.wrap{{max-width:1180px;margin:0 auto}}
h1{{font-size:30px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px}}
h1 .s{{color:var(--pink)}}
.head{{border-bottom:2px solid var(--rule);padding-bottom:14px;margin-bottom:22px;
 display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}}
.meta{{font:12px ui-monospace,Menlo,monospace;color:var(--ink2);text-align:right}}
.headline{{background:var(--panel);border-left:3px solid var(--pink);padding:12px 16px;margin:0 0 24px;font-style:italic}}
h2{{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink2);
 margin:34px 0 10px;border-bottom:1px solid var(--rule);padding-bottom:5px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}}
.sub{{background:var(--panel);border:1px solid var(--rule);border-radius:5px;padding:14px 16px}}
.sub header{{display:flex;align-items:center;gap:9px;margin-bottom:8px}}
.sub h3{{font-size:17px;margin:0;flex:1}}
.dot{{width:10px;height:10px;border-radius:50%;flex:none}}
.score{{font:600 19px ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}}
.of{{font-size:12px;color:var(--ink2)}}
.sub p{{margin:5px 0;font-size:13.5px}}
.bar{{color:var(--ink2)}} .gap{{color:#e0a08a}}
.shots{{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}}
figure{{margin:0}} figure img{{border:1px solid var(--rule);border-radius:3px;display:block}}
figcaption{{font-size:11px;color:var(--ink2);margin-top:3px;max-width:240px}}
.missing{{font:11px monospace;color:var(--bad);padding:8px;border:1px dashed var(--rule)}}
ul{{padding-left:20px}} li{{margin:.3em 0;font-size:14px}}
.pri{{font:11px ui-monospace,monospace;background:var(--panel2);padding:1px 6px;border-radius:3px;color:var(--work)}}
table{{border-collapse:collapse;width:100%;font-size:13.5px}}
th{{text-align:left;font:11px/1.6 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;
 color:var(--ink2);border-bottom:1px solid var(--rule);padding:5px 10px 5px 0}}
td{{border-bottom:1px solid var(--rule);padding:7px 10px 7px 0;vertical-align:top}}
#log li{{font-size:12.5px;color:var(--ink2)}} #log time{{font:11px ui-monospace,monospace;color:var(--work);margin-right:8px}}
</style></head><body><div class="wrap">
<div class="head"><div><h1>Three <span class="s">Sewers</span> — Gauntlet</h1>
<div style="font-size:13px;color:var(--ink2)">live workbench · auto-refresh 45s</div></div>
<div class="meta">ROUND {S['round']}<br>{datetime.datetime.now().strftime('%H:%M:%S')}</div></div>
<p class="headline">{html.escape(S['headline'])}</p>
<h2>Subsystems</h2><div class="grid">{subs}</div>
<h2>Largest remaining gaps</h2><ul>{gaps or '<li>—</li>'}</ul>
<h2>Quality bars (inspectable)</h2><table><tr><th>System</th><th>Reference</th><th>How measured</th></tr>{bars}</table>
<h2>Activity</h2><ul id="log">{log}</ul>
</div></body></html>""")
print("workbench ->", f"{ROOT}/index.html")
