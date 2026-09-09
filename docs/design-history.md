# Design history

## The Vita-derived system (superseded 2026-09-08)

Between mid-2026 and 2026-09-08 TripMate's visual system was derived from **Vita Travels** by
Phenomenon Studio (Awwwards Honorable Mention, 1 Aug 2026). Not loosely: the palette values were
measured off the live site and adopted verbatim, and so were the fluid root font size, the
negative-tracking ladder, the one-typeface rule, the navbar's blur value, the landing hero's
geometry, the image-row card head, and the section opener.

Two documents recorded that work in detail — `design-breakdown.html` ("Vita Travels, taken apart —
a section-by-section breakdown for TripMate", 810 lines) and `design-audit.html` ("TripMate vs Vita
Travels — design audit", 328 lines, a token-by-token comparison table). Both are removed as of this
commit.

**They were removed because they are wrong, not because they are awkward.** Every value they
compare is gone: the app now runs on "Kiln", a warm near-neutral system with its own palette, its
own three-role colour vocabulary, its own type set and its own edge language. A comparison table
against a palette the product no longer uses is a document that misdescribes the codebase, and this
repo's convention is that docs track the code. The attribution itself was never the problem — it
was honest, it was in the open, and keeping a private record of where an idea came from is good
practice, which is why this note exists rather than a silent deletion.

Both files remain in git history if the measurements are ever wanted again.

### What was replaced, and what was not

Replaced: the interface palette, the type system, the root scale, the hero composition, the
navbar treatment, the section opener, the image-row card head, and the "how it works" arrangement.

Not replaced, and never derived from that reference in the first place: the full-bleed live 3D
globe, the itinerary-as-glass-over-the-map topology, the per-day route ramp and its arcs, the
world-space stop markers, the budget model, and every product behaviour. Those are the product's
own and were left alone deliberately.

See `DESIGN.md` for the current system.
