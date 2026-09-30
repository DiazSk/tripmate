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
    ("Screens", "22"),
    ("Captured", "29 Sep 2026"),
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
    ("00-signin.png","Sign in \u2014 the first screen","What the app opens on, and it now takes the whole device. It was a sheet, which meant the photograph could not do what the code says it does \u2014 run under the status bar \u2014 because a sheet is inset and rounded. <b>The escape has a shape now too.</b> \u201cKeep planning without an account\u201d was body text in muted grey, the same face and colour as the blurb above it, and was reported as not looking like a button at all. The two changes are one: the sheet was justified on its swipe-down being the keep-planning gesture, so an undocumented swipe carried half the escape and grey prose carried the rest. The gate stays soft \u2014 planning, generating and saving all work signed out, and the work follows you onto an account later."),
    ("01-home.png","Home, between trips","A serif statement, one jade action, then the next trip as a photograph. The method section is the honesty: it says what the planner actually does. Step 02 now names the <b>16-day forecast window</b> and what happens outside it \u2014 it used to promise \u201cforecast for your actual dates\u201d, which for a trip a month out is not something the backend can do."),
    ("01-home-today.png","Home, while the trip is running","<b>The same screen, mid-trip.</b> Home already chose between \u201cUp next\u201d and \u201cLatest memory\u201d off the dates; this is the third branch, and the method section steps aside because the reader is standing in the city. <b>It says one thing, and the figure is the loud half.</b> The screen used to be five rows of equal weight with no subject. Now a single spoken line leads \u2014 in coral, with the verb quiet and the number carrying the stress, because the number is what you act on. This capture caught the zero case, <i>Leave now</i> \u2014 at zero it stops counting down to nothing. Inside half an hour it is <i>Leave in 18 min</i>; further out, <i>Leave by</i> and a clock, above the appointment, since the moment you have to go outranks the moment you are due; past ninety minutes it becomes <i>Free for about\u2026</i>, the state this screen once had nothing to say in. <b>The journey beneath it now says it is an estimate</b> \u2014 <i>about 22 min by transit</i>. It is straight-line distance times a circuity factor, not a route, and three surfaces were printing it as though it had been measured. <b>The first stop of a day never shows a departure time</b>, because that needs a previous stop and lodging carries no coordinates. The stops either side are dots and times only \u2014 a rail once joined them and was dropped after four attempts failed to make it meet its own dots."),
    ("01b-today-offline.png","The same screen with no network","The trip is read from disk and the copy says so, with the time it was taken. The schedule stands unchanged \u2014 a cached 10:30 stop is still a 10:30 stop \u2014 and the countdown keeps running, because it is arithmetic against the device clock rather than anything fetched. Directions stays live: it is a URL, and a map app is what still works in a tunnel. <b>The control that cannot work says what it needs</b> rather than going quietly grey \u2014 <i>Plans changed?</i> becomes <i>Needs a connection</i>, while <i>Plan another trip</i> keeps its jade because planning offline is fine. <b>One line would change tense if it were here.</b> A cached forecast is one that <i>was</i> true when it was taken; this day has no forecast at all, so nothing is claimed \u2014 which is the same rule reaching its other end."),
    ("02-trips.png","Trips","Not \u201cMemories\u201d: the wall held a trip that happened and a trip that has not, and a future trip is not a memory. Kept trips only, split Upcoming / Past \u2014 and a trip counts as upcoming until the day after it ends, because somebody standing there on the final afternoon has not acquired a memory yet. The figures carry the noun now: gold says <i>money</i> and cannot say <i>which</i> money."),
    ("03-profile.png","Profile","Deliberately native. The design system hands settings surfaces back to the platform \u2014 the one place Kiln steps aside, taking iOS list conventions with the palette unchanged. The lifetime figure reads <b>Planned</b>, not <i>Spent</i>: it sums what kept trips were planned to cost, and this product collects no transactions."),
  ]),
  ("Planning", "Four steps. Only the first gates anything.", [
    ("04-plan-basics.png","Where and when","The only required step. Budget carries a per-person / whole-party basis, because the plan prices everything as a party total."),
    ("04b-destination-search.png","Finding the place","Live geocoding as you type, disambiguated by region \u2014 there is more than one Kyoto. <b>And only places.</b> The same query used to offer <i>Kyoto Heliport</i> and <i>Kyoto Imperial Palace</i>; this field sets the coordinate every later distance, forecast and travel time is measured from, so picking the heliport would anchor a week to a landing pad with nothing downstream able to tell."),
    ("04c-saved-places.png","What you already saved","Places imported before planning. <b>The ones in this destination come first and arrive already chosen</b>; the rest sit under <i>Saved elsewhere</i> rather than unlabelled beside them, because an Amber Fort listed plainly under a Kyoto trip reads as a candidate for it. <b>The heading only appears when there is a \u201chere\u201d to be elsewhere from</b>, which is the rule this shot happens to demonstrate from the other side: the single saved place is in Jaipur, the trip is to Kyoto, and with nothing local to lead the list the split would be a heading over nothing."),
    ("05-plan-group.png","Who is going","The preset is a shortcut into the counters below it, not a second question: picking one fills them in and they stay editable. They used to be unrelated, so nothing stopped \u201cSolo\u201d standing over three adults. Party down to infants, because it changes the pace rather than just a headcount."),
    ("06-plan-preferences.png","What you're after","<b>How full each day</b> and <b>what to see</b> are two questions. They were one \u2014 packed / relaxed / offbeat / mixed \u2014 which made a packed off-the-beaten-path trip unsayable, and quietly set a three-stop day for anyone who answered \u201coffbeat\u201d. The chips cycle chosen \u2192 <b>\u2605 starred</b> \u2192 clear on repeated taps, which the caption above them states rather than leaving to be discovered; all three are untouched here."),
    ("07-plan-review.png","The brief, before a word is written","Every answer back in one list, each with its own way in. Diet and access print even when empty: they are the hard constraints, and a row that vanishes when unset is a row nobody can notice is missing. <b>And they now print the same words.</b> Access said <i>No requirements</i>, which answers for the traveller \u2014 what is known is that none were <i>provided</i>. Both rows say <i>Nothing noted</i>, which describes the record rather than the person, and it is the same distinction <i>Not checked</i> draws one screen over. <b>Pace is one row with three labelled answers.</b> It read as <i>A balanced day \u00b7 A comfortable amount \u00b7 Some of each</i>, which made the reader work out which phrase answered which question \u2014 two of them near-synonyms out of context. Splitting it into three rows would have meant three Edit links to the single wizard step holding all three. One row\u2019s navigation, three rows\u2019 legibility."),
  ]),
  ("The trip", "One plan, two faces, and the checks that run over it.", [
    ("09-trip-day.png","A day","A day is a page, paged horizontally. Stops are rows, never cards \u2014 and the rules between them are gone. That divider drew edge to edge while every heading beside it and every word it separated sat inset 16pt, so it read as a seam in the page rather than a break in a list. A stop is already a numbered disc, a bold name, a muted line and a leg above it saying how long the hop takes; vertical space does the rest. <b>The photograph spans the device</b> for the same reason \u2014 inset and rounded it is a picture on a page, edge to edge it is the page. The strip carries dates rather than bare ordinals, and sits on its own row because choosing a day is navigation while List/Map and Ask/+ act on the day you landed on. <b>The masthead used to carry a badge reading \u201cPleasant autumn day\u201d.</b> No forecast covered these dates, so it came from the planner \u2014 the stored string is \u201cPleasant autumn day, 18.9-23.5\u00b0C, mostly sunny\u201d, temperatures invented \u2014 and the client cut it at the comma, dropping the fabricated figures while keeping the fabricated claim in the slot reserved for measured ones. The badge now shows a real forecast, or the day\u2019s own theme, or nothing."),
    ("11-trip-map.png","The same day, mapped","Numbered discs carry the day's own hue \u2014 the one sanctioned crossing between the interface palette and the map's. The pill says what the map cannot draw: a route is visibly a shape and invisibly a cost, and how much of a day is spent moving is the half somebody is deciding on. Time, never distance \u2014 nothing here knows whether the reader thinks in miles. And <b>about</b> 16 min, because it is arithmetic over average speeds rather than a routed figure; the word is spelled once now, beside the arithmetic, and four surfaces read it from there."),
    ("12-trip-conflict.png","A conflict","One stop runs past the start of the next, so the arriving stop takes a coral wash and says so in its own words \u2014 both clocks named, the arithmetic shown rather than asserted. The same treatment covers a leg with too few minutes in it; what varies is the sentence, not the signal."),
    ("12b-trip-repairs.png","\u2026and the ways out","<b>Fix this</b> spends no model call on arithmetic: a hop short of minutes has at most two answers, both computed \u2014 push the arriving stop later, or start the leaving one earlier. Only one is offered here, because the other would have tightened the leg in front of it. They share one sentence shape \u2014 verb, what moves, how far, which way, then the clock it lands on \u2014 so comparing them is reading rather than parsing. Neither is offered if it would tighten another leg, and the line under them states the rule that governs everything here: nothing booked will move."),
    ("13-trip-stop-detail.png","A stop, opened","Why it was chosen, one practical line, and the three things you can do \u2014 including marking it booked, which forbids the planner from ever moving it."),
    ("10-plan-health.png","Plan health, opened","The figure decomposes into seven dimensions, each with the findings that cost it its points. It is arithmetic rather than judgement \u2014 a flat penalty per finding \u2014 and a dimension nothing could check says <b>Not checked</b> rather than claiming a pass nobody ran. <b>The diagnosis leads, not the figure.</b> The score used to be the most immediate thing on a screen whose entire purpose is diagnostic \u2014 a reader could glance at 84, conclude \u201cgood enough\u201d and never read the two findings that make the plan impossible. Severity outranks an aggregate, so a blocker takes the headline in coral and the figure steps down beside it. With nothing blocking, the figure leads again, because then nothing outranks it. <b>Two words carry the epistemics.</b> <i>2 blockers found</i>, not <i>2 blockers</i>: what is known is what the checks that ran turned up, not what is in the plan. And the number says what it is a number of \u2014 <i>across checked</i> \u2014 whenever coverage is partial, because 84 out of seven checks and 84 out of four are not the same claim in the same type size."),
    ("10b-spend-breakdown.png","Where the day\u2019s money went","Largest first, zero-value categories dropped rather than printed at zero. The heading says <b>projected</b> until a real spend is entered \u2014 the bar above it already made that distinction and this did not, so one screen called one summation by two names."),
  ]),
  ("Changing it", "Two ways in, both conversational.", [
    ("14-trip-chat.png","Ask for a change","Scope is stated before you ask, starts wide, and is enforced by the applier rather than requested of the model. <b>And it is now recorded on the turn.</b> Read the two older exchanges: a refusal sits under a control saying <i>Whole trip</i>, because the scope moved afterwards and nothing said so. The newest request carries the scope it went out under, so its refusal explains itself. Unstamped turns stay unstamped \u2014 saying nothing about what was never recorded."),
    ("15-trip-add-place.png","Add a stop","Live search around the day you are reading. <b>Every row says where it would land and what it would cost</b> \u2014 the clock time, whether it squeezes, and the extra travel \u2014 before you open anything. <b>\u201cAdds about 3 min walking\u201d, not \u201c+3 min\u201d</b>: the old form could be read as three minutes from an anchor, three more than the current route, or three added to the total, and the verb settles it without the caption having to. That answer existed one tap later, on the card, which is what made this read as ordinary search with a destination bolted on."),
    ("09b-trip-offline.png","The plan, with no network","Today is the screen you open standing in a street, and it links straight here \u2014 so this one is cached too, or the on-trip mode is a dead end one tap in. Ask, Add, Find nearby and Mark booked all go grey. The two writes refuse <i>before</i> their optimistic update rather than after: both already rolled a failed save back, but a control that flips and reverts with no reason reads as a broken app instead of a stated limit."),
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
<p><b>Every screen here was re-shot for this round.</b> Five are new: Home while a trip is
running, the same screen with no network, the saved-places split, the computed repairs on their
own, and the plan offline. Two previous rounds of outside feedback read earlier versions of this
board as the whole product and reasonably concluded that what it did not show did not exist —
a third of the first round asked for things that were already built and merely unphotographed. So
for anything that still looks missing: name the screen you would expect it on, and ask, rather
than inferring absence from a picture.</p>
<p><b>Two things left open last round are now changed, on the reviewer's argument rather than
mine.</b> Pace no longer prints three answers on one line, and emoji are gone from the generation
prompt — the case that won was that this product has a deliberately small visual vocabulary and
pictographs in generated prose are a fourth one nobody designed. The third, the category rail's
scroll affordance, both of us agreed to leave to evidence rather than instinct.</p>
<p><b>What the last round actually changed is the class of thing being looked for.</b> It was run
as a truthfulness audit, and every finding was a surface speaking above its evidence — an
invented forecast, a count that implied exhaustiveness, a database row presented as a guarantee.
Two turned out to be worse in the code than in the photograph. The most useful question to ask of
this board is still that one: <b>where does it claim more than it knows?</b></p>
<p><b>Known to be unresolved.</b> Stops carry no provenance, so a historical fact, a computed
estimate and a generated suggestion all arrive in the same voice — that is the next cycle. And
plans generated before this round keep their emoji and their invented weather prose in storage;
the prompt stops new ones, and the client refuses to render the old ones as fact, but the strings
are still on disk.</p>
</footer></div></body></html>"""

if __name__ == "__main__":
    main()
