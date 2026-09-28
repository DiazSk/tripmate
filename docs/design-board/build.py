#!/usr/bin/env python3
"""
Rebuild docs/design-board/index.html from the screenshots beside it.

One self-contained file: every screenshot and both brand faces are base64'd in, so the board
can be mailed or dropped in Slack with nothing to unzip and no assets to lose.

To refresh a screen: capture it with
    xcrun simctl io <udid> screenshot --type=png docs/design-board/shots/<name>.png
resize it with
    sips -Z 880 shots/<name>.png --out shots/web/<name>.png
and re-run this. Scenes on the sign-in screen crossfade on a timer, so take two frames a couple
of seconds apart and keep one only if they are byte-identical - otherwise you capture a
half-finished dissolve with two captions on screen at once.
"""
import base64, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB  = ROOT / "docs/design-board/shots/web"
OUT  = ROOT / "docs/design-board/index.html"

def b64(p: pathlib.Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()

FONTS = {"Melodrama": ROOT/"mobile/assets/fonts/Melodrama-Regular.ttf",
         "Tabular":   ROOT/"mobile/assets/fonts/Tabular-Medium.ttf"}

# Facts, read off the build rather than remembered: `sips -g pixelWidth`, `simctl list devices`,
# mobile/package.json, and mobile/src/constants/theme.ts. A spec block that drifts from the app
# is worse than no spec block.
FACTS = [
    ("Screens", "14"),
    ("Captured", "27 Sep 2026"),
    ("Device", "iPhone 17 \u00b7 iOS 27"),
    ("Viewport", "402 \u00d7 874 pt"),
    ("Capture", "1206 \u00d7 2622 px @3\u00d7"),
    ("Client", "Expo 57 \u00b7 RN 0.86"),
]

PALETTE = [
    ("#28B981", "Kiln Jade",   "Action, and only action \u2014 never a label, never a figure."),
    ("#E9B44C", "Kiln Gold",   "Money, and only money. A figure is information, not an invitation."),
    ("#E4553F", "Ember Coral", "Over-plan and failure. Spent only on what cannot happen."),
    ("#1C1A18", "The one slate", "Every panel, pill, badge and sheet \u2014 this colour at some alpha."),
    ("#121110", "Ground",      "The single warm near-black the whole app sits on."),
    ("#F7F5F2", "Paper",       "Body text, and text over any dark surface."),
]

TYPE = [
    ("Melodrama", "Display serif, one weight", "Mastheads, destinations, the statement on each screen."),
    ("System sans", "The platform's own face", "All body and UI text \u2014 which is what buys Dynamic Type and Android font scaling. A custom face here would freeze it."),
    ("Tabular", "Figures", "Money, counts and dates, so columns of numbers line up."),
]

SECTIONS = [
  ("Arrival", "What somebody meets before they have a trip.", [
    ("00-signin.png","Sign in — the first screen","What the app opens on. Full-bleed scene photography with the serif carrying one claim at a time; the picture and the line rotate across four scenes. The gate is deliberately soft — “Keep planning without an account” leaves at no cost, because planning, generating and saving all work signed out and the work follows you onto an account later."),
    ("01-home.png","Home","A serif statement, one jade action, then the next trip as a photograph. The method section below is the honesty — it says what the planner actually does rather than promising magic."),
    ("02-trips.png","Trips","Not \u201cMemories\u201d: the wall held a trip that happened and a trip that has not, and a future trip is not a memory. Kept trips only, split Upcoming / Past \u2014 and a trip counts as upcoming until the day after it ends, because somebody standing there on the final afternoon has not acquired a memory yet."),
    ("03-profile.png","Profile","Deliberately native. The design system hands settings surfaces back to the platform — the one place Kiln steps aside, taking iOS list conventions with the palette unchanged."),
  ]),
  ("Planning", "Four steps. Only the first gates anything.", [
    ("04-plan-basics.png","Where and when","The only required step. Budget carries a per-person / whole-party basis, because the plan prices everything as a party total."),
    ("04b-destination-search.png","Finding the place","Live geocoding as you type, disambiguated by region — there is more than one Kyoto. A miss never blocks generating."),
    ("05-plan-group.png","Who is going","The preset is a shortcut into the counters below it, not a second question: picking one fills them in and they stay editable. They used to be unrelated, so nothing stopped \u201cSolo\u201d standing over three adults. Party down to infants, because it changes the pace rather than just a headcount."),
    ("06-plan-preferences.png","What you're after","<b>How full a day</b> and <b>what to see</b> are two questions now. They were one \u2014 packed / relaxed / offbeat / mixed \u2014 which made a packed off-the-beaten-path trip unsayable, and quietly set a three-stop day for anyone who answered \u201coffbeat\u201d. Interests tap once to pick, again to star. Dietary and access needs are hard constraints, not preferences."),
    ("07-plan-review.png","The brief, before a word is written","Every answer back in one list, each with its own way in. The last two rows print even when they are empty: diet and access are the hard constraints, and a row that vanishes when unset is a row nobody can notice is missing. Generation is the expensive step \u2014 this is the cheap place to catch a misunderstanding."),
  ]),
  ("The trip", "One plan, two faces, and the checks that run over it.", [
    ("09-trip-day.png","A day","A day is a page, paged horizontally. Stops are rows against rules, never cards. The strip carries dates rather than bare ordinals \u2014 nobody remembers what Day 3 is while standing in it \u2014 and sits on its own row, because choosing a day is navigation while List/Map and Ask/+ act on the day you landed on. The budget figure says <b>Projected</b>, since it is a forecast until a real spend is entered."),
    ("11-trip-map.png","The same day, mapped","Numbered discs carry the day's own hue \u2014 the one sanctioned crossing between the interface palette and the map's. The pill says what the map cannot draw: a route is visibly a shape and invisibly a cost, and how much of a day is spent moving is the half somebody is deciding on. Time, never distance \u2014 nothing here knows whether the reader thinks in miles."),
    ("12-trip-conflict.png","A conflict, and the ways out","The leg does not fit, so the arriving stop takes a coral wash and says so in its own words. <b>Fix this</b> no longer spends a model call on arithmetic: a hop short of minutes has exactly two answers, and both are computed, named with the clock time they produce, and applied on one tap. Neither is offered if it would tighten another leg, and nothing booked ever moves."),
    ("13-trip-stop-detail.png","A stop, opened","Why it was chosen, one practical line, and the three things you can do — including marking it booked, which forbids the planner from ever moving it."),
    ("10-plan-health.png","Plan health, opened","The figure decomposes. Seven dimensions, each with the findings that cost it its points, in the traveller’s own words. It is arithmetic rather than a judgement — a flat penalty per finding, averaged over what could be measured — and a dimension nothing could check says <b>Not checked</b> rather than claiming a pass nobody ran."),
    ("10b-spend-breakdown.png","Where the day’s money went","Largest first, zero-value categories dropped rather than printed at zero. The shares are apportioned by largest remainder so the column sums to exactly 100 — three 33s that add to 99 would undo the one thing this surface is arguing."),
  ]),
  ("Changing it", "Two ways in, both conversational.", [
    ("14-trip-chat.png","Ask for a change","Plain language, and it inherits the planner's own reasoning from generation rather than re-reading its output. <b>Changing</b> states the scope before you ask \u2014 one day or the whole trip \u2014 and the applier enforces whichever you pick, so an edit that strays comes back refused rather than discovered later. Nothing lands until a computed diff of the two plans has been approved."),
    ("15-trip-add-place.png","Add a stop","Live search around the day you are reading, and it now says where a result would land before you open it. Each slot carries what inserting there would cost in travel \u2014 the extra journey, not the journey \u2014 so the same caf\u00e9 reads differently on a morning than on an evening. Nothing already in the plan moves, and an add can be taken back."),
  ]),
]

def card(fn, title, note):
    p = WEB / fn
    if not p.exists():
        print(f"  ! missing {fn}")
        return ""
    return (f'<figure class="card"><div class="phone">'
            f'<img loading="lazy" alt="{title}" src="data:image/png;base64,{b64(p)}"></div>'
            f'<figcaption><h3>{title}</h3><p>{note}</p></figcaption></figure>')

def main():
    face = "\n".join(
        f"@font-face{{font-family:'{n}';src:url(data:font/ttf;base64,{b64(p)}) "
        f"format('truetype');font-display:swap}}" for n, p in FONTS.items() if p.exists())
    facts = "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in FACTS)
    palette = "".join(
        f'<li><i style="background:{hexv}"></i><div><b>{name}</b>'
        f'<code>{hexv}</code><em>{role}</em></div></li>' for hexv, name, role in PALETTE)
    typescale = "".join(
        f'<li><div><b>{name}</b><code>{kind}</code><em>{role}</em></div></li>'
        for name, kind, role in TYPE)
    body = "".join(
        f'<section><div class="rule"><span class="label">{n}</span><i></i>'
        f'<span class="count">{len(s)}</span></div><p class="blurb">{b}</p>'
        f'<div class="grid">{"".join(card(*x) for x in s)}</div></section>'
        for n, b, s in SECTIONS)
    total = sum(len(s[2]) for s in SECTIONS)
    OUT.write_text(TEMPLATE.format(face=face, body=body, total=total, facts=facts,
                               palette=palette, typescale=typescale), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1_048_576:.1f} MB, {total} screens)")

TEMPLATE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TripMate — Design board</title><style>
{face}
:root{{--ground:#121110;--surface:#1C1A18;--line:rgba(255,255,255,.12);--paper:#F7F5F2;
--muted:rgba(247,245,242,.62);--jade:#28B981;--gold:#E9B44C;--coral:#E4553F}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--paper);
font:400 15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;
-webkit-font-smoothing:antialiased;padding:0 0 96px}}
.wrap{{max-width:1240px;margin:0 auto;padding:0 32px}}
header{{padding:72px 0 8px}}
.word{{font:600 10px/1 inherit;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}}
h1{{font-family:Melodrama,Georgia,serif;font-weight:400;font-size:clamp(40px,6vw,72px);
line-height:1.04;letter-spacing:-.02em;margin:18px 0 0;max-width:16ch}}
.sub{{color:var(--muted);max-width:60ch;margin:18px 0 0;font-size:16px}}
.spec{{margin:36px 0 0;border-top:1px solid var(--line)}}
.facts{{display:flex;flex-wrap:wrap;gap:24px 40px;padding:20px 0;
border-bottom:1px solid var(--line)}}
.facts div{{min-width:92px}}
.facts dt{{font:600 10px/1 inherit;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}}
.facts dd{{margin:8px 0 0;font-family:Tabular,ui-monospace,monospace;font-size:15px}}
.note{{padding:18px 0;margin:0;border-bottom:1px solid var(--line);color:var(--muted);
font-size:13px;line-height:1.6;max-width:80ch}}
.note b{{color:var(--paper);font-weight:600}}
.tokens{{padding:22px 0;border-bottom:1px solid var(--line)}}
.tokens > .label{{display:block;margin-bottom:16px}}
.tokens ul{{list-style:none;margin:0;padding:0;display:grid;gap:18px 34px;
grid-template-columns:repeat(auto-fill,minmax(272px,1fr))}}
.tokens li{{display:flex;gap:12px;align-items:flex-start}}
.tokens i{{flex:0 0 auto;width:26px;height:26px;border-radius:6px;
border:1px solid var(--line);margin-top:2px}}
.tokens b{{display:block;font-size:14px;font-weight:600;letter-spacing:-.01em}}
.tokens code{{display:block;margin-top:4px;font-family:Tabular,ui-monospace,monospace;
font-size:11.5px;color:var(--muted);letter-spacing:.04em}}
.tokens em{{display:block;margin-top:6px;font-style:normal;font-size:12.5px;
line-height:1.5;color:var(--muted)}}
section{{margin:72px 0 0}}
.rule{{display:flex;align-items:center;gap:14px}}
.rule i{{flex:1;height:1px;background:var(--line)}}
.label{{font:600 10px/1 inherit;letter-spacing:.18em;text-transform:uppercase;color:var(--paper)}}
.count{{font-family:Tabular,monospace;font-size:12px;color:var(--muted)}}
.blurb{{color:var(--muted);margin:12px 0 30px;max-width:62ch}}
.grid{{display:grid;gap:34px 26px;grid-template-columns:repeat(auto-fill,minmax(232px,1fr))}}
.card{{margin:0}}
/* Crop the simulator status bar: the dev build stamps a '< TripMate' return indicator across
   the clock, a debug artefact rather than the product. The frame is 48px shorter than the
   404x880 capture and the image sits on its bottom edge, so exactly that band is lost — a
   percentage margin would not do it, that resolves against the WIDTH. */
.phone{{border-radius:30px;overflow:hidden;background:#000;border:1px solid var(--line);
aspect-ratio:404/832;box-shadow:0 22px 44px -18px rgba(0,0,0,.9),0 2px 8px rgba(0,0,0,.6);
transition:transform .22s ease,box-shadow .22s ease}}
.card:hover .phone{{transform:translateY(-4px);box-shadow:0 30px 56px -18px rgba(0,0,0,.95)}}
.phone img{{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 100%}}
figcaption h3{{margin:16px 0 0;font-size:15px;font-weight:600;letter-spacing:-.01em}}
figcaption p{{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.5}}
footer{{margin:84px 0 0;padding-top:26px;border-top:1px solid var(--line);
color:var(--muted);font-size:13px;max-width:72ch}}
footer b{{color:var(--paper);font-weight:600}} footer p{{margin:0 0 14px}}
@media(max-width:640px){{.wrap{{padding:0 20px}}header{{padding-top:44px}}}}
</style></head><body><div class="wrap">
<header><div class="word">TripMate</div>
<h1>Every screen, as it ships today.</h1>
<p class="sub">Captured from the React Native client on an iPhone 17, against live data and a
real generated itinerary — not mockups. Shared to collect design feedback and ideas.</p>
<div class="spec">
<div class="facts">{facts}</div>
<p class="note"><b>The data is live.</b> A real generated itinerary for Lisbon, live geocoding as
you type, and live POI search from OpenStreetMap — no fixtures, no lorem, no placeholder prices.
The design system is <b>Kiln</b>, shipped 2026-09-08 and documented in DESIGN.md.</p>
<div class="tokens"><span class="label">Palette</span><ul>{palette}</ul></div>
<div class="tokens"><span class="label">Type</span><ul>{typescale}</ul></div>
</div></header>
{body}
<footer>
<p><b>How to read the palette.</b> Three colours, one meaning each: jade acts and only acts,
gold counts money and only money, coral is kept for something that cannot happen. Everything else
is warm paper on a single near-black slate. If a screen here seems to break that, it is worth
saying — that is exactly what this board is for.</p>
<p><b>One thing already known.</b> One screen is still absent — the generation screen, because
capturing it means spending a real model run.</p>
<p><b>Every screen here was re-shot after a round of outside feedback,</b> which read an earlier
version of this board as the whole product and reasonably concluded that what it did not show did
not exist. Some of what it asked for already existed and was simply unphotographed; the rest was
built, and is above. Worth keeping in mind for anything that still looks missing: ask before
assuming.</p>
</footer></div></body></html>"""

if __name__ == "__main__":
    main()
