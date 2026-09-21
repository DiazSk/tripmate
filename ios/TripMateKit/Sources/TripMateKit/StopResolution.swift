import Foundation

/// Deciding what to ask a geocoder about a stop, and whether to believe the answer.
///
/// **The coordinates on a generated itinerary are invented, and some are wrong by kilometres.**
/// Measured on one real nine-day trip: 49 stops, 39 distinct coordinates, and *ten* of them
/// sharing 43.0766, 11.6785 — the Pienza town centre. One of those ten is "Breakfast at Caffè
/// Poliziano", and Caffè Poliziano is 8.4 km away in Montepulciano.
///
/// Three things cause it and they were written against each other. `itineraryPrompt.ts:26` asks
/// the model to fill in `lat`/`lng` itself. `itineraryPrompt.ts:157` tells it an area-level food
/// stop takes "the neighborhood/market as its name" and "the area's approximate lat/lng" — sound
/// advice that the model then applies to stops whose name is a *specific venue*. And the one
/// corrector, `resolveNamedPlaceCoords` (`poiDetails.ts:178`), matches OpenStreetMap on an
/// anchored exact-name regex, so `^(Breakfast at Caffè Poliziano)$` matches nothing and it fails
/// soft, keeping the guess.
///
/// This type is the judgement half of the repair: what to search for, and what to accept. The
/// searching itself is `StopResolver` in the app target, which has no judgement in it at all.
public enum StopResolution {

    /// How far a name-resolution may move a stop.
    ///
    /// **Not invented here — this is `MAX_CORRECTION_KM` from `poiDetails.ts:156`**, where the
    /// server makes the identical judgement and explains it: "Kyoto's own sights span ~15km, so
    /// the bound has to be generous without letting a same-named place in another prefecture
    /// through."
    public static let maxCorrectionM: Double = 40_000

    /// Below this, record nothing.
    ///
    /// A 30m move changes no pixel, but it *does* change `RoutePresentation.identity` — which is
    /// a lat/lng string — and so forces a redraw of the whole day for nothing.
    public static let minCorrectionM: Double = 50

    /// The words a generated stop name begins with when the name is a meal rather than a place.
    ///
    /// Short and fixed on purpose. Most of it already appears in `DaySlotting.nameHints`, which
    /// reads the same names for the opposite reason — to guess a time of day.
    static let leadIns: Set<String> = [
        "breakfast", "brunch", "lunch", "dinner", "supper",
        "drinks", "coffee", "aperitivo", "snack", "dessert",
    ]

    /// The word that separates the meal from the place it happens at.
    static let separators: Set<String> = ["at", "around", "near", "in", "by"]

    /// What to actually search for, given a stop's name. `nil` when there is nothing worth asking.
    ///
    /// The prompt produces two shapes and only two — `"<meal> around <area>"` and
    /// `"<meal> at <place>"` — so this is a vocabulary match, not a parser.
    ///
    /// **The lead-in gate is load-bearing rather than decorative.** Splitting on the separator
    /// unconditionally turns "Museum of Art in Pienza" into "Pienza", which resolves to the town
    /// centroid — reintroducing the exact bug this exists to fix. Only a name that *starts* with
    /// a meal word is treated as a meal.
    ///
    /// Splits on the **first** separator only, so "Dinner at the trattoria in Pienza" asks about
    /// "the trattoria in Pienza" rather than about Pienza.
    public static func query(for name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let words = trimmed.split(whereSeparator: \.isWhitespace).map(String.init)
        guard let first = words.first, leadIns.contains(fold(first)) else { return trimmed }
        // A name that is only a meal word names no place. Asking a geocoder about "Lunch" spends
        // a request to be told about a town in Poland.
        guard words.count > 1 else { return nil }

        guard let cut = words.indices.dropFirst()
            .first(where: { separators.contains(fold(words[$0])) })
        else {
            // A meal word with no separator — "Breakfast buffet". Nothing to strip.
            return trimmed
        }
        // A separator with nothing after it — "Breakfast at" — names a place no more than a
        // bare "Lunch" does, so it asks nothing rather than asking about the fragment.
        guard cut + 1 < words.count else { return nil }
        return words[(cut + 1)...].joined(separator: " ")
    }

    /// Does this query name a *particular* place, or just a kind of place?
    ///
    /// **Found by running it.** Day 5 of the test trip contains "Pecorino tasting at caseificio"
    /// and "Dinner at agriturismo restaurant". Those resolve — to *a* cheese dairy and *an*
    /// agriturismo, some arbitrary one within the search region, which is a confident wrong
    /// answer where the model's vague centroid was at least honestly vague. The sanity radius
    /// cannot catch it: the imposter is a kilometre away, not forty.
    ///
    /// The signal is a capitalised word that is **not the first**. "Caffè Poliziano" and "Corso
    /// Rossellino" have one; "agriturismo restaurant" and "Pasta-making class" do not, because a
    /// sentence capitalises its opening word whether or not it names anything. It costs the
    /// occasional real lowercase place name, which is the right way to be wrong here — a stop we
    /// decline to move keeps exactly the behaviour it has today.
    public static func namesAPlace(_ query: String) -> Bool {
        let words = query.split(whereSeparator: \.isWhitespace)
        return words.dropFirst().contains { $0.first?.isUppercase == true }
    }

    /// Lowercased, unaccented, stripped of the punctuation a name can carry.
    ///
    /// `Café` and `cafe` are the same word to this, which matters because the model writes both.
    static func fold(_ word: String) -> String {
        word.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .trimmingCharacters(in: .punctuationCharacters)
    }

    /// The points a candidate has to be plausible against: the day's *other* stops.
    ///
    /// (0,0) is dropped, the same rule `RouteGeometry.routeStops` applies — a zeroed stop is a
    /// missing coordinate, and letting it into a centroid drags the whole day toward the Gulf of
    /// Guinea.
    ///
    /// **Excluding the stop being resolved is not cosmetic.** Its own fabricated point is the
    /// thing under suspicion; leaving it in lets a wrong coordinate vote on whether its own
    /// replacement is believable.
    public static func anchors(_ stops: [Stop], excluding index: Int) -> [GeoPoint] {
        stops.enumerated()
            .filter { $0.offset != index }
            .map { GeoPoint($0.element) }
            .filter { !($0.lat == 0 && $0.lng == 0) }
    }

    /// Is this candidate close enough to the rest of the day to be the same trip?
    ///
    /// **A flat bound, and deliberately not a multiple of `DayFit.radius`.** The relative rule was
    /// written first and it fails the case that motivates the whole feature: the Pienza day's
    /// stops are all the *same fabricated point*, so its mean radius pins to `DayFit`'s 400m
    /// floor, and three times that rejects the true café at 8.4 km. **Any relative test inherits
    /// the corruption it is supposed to detect** — the day looks tight precisely because the data
    /// is wrong.
    ///
    /// With no anchors there is no evidence, and no evidence is not grounds for refusal — a
    /// one-stop trip accepts whatever it is told, which is no worse than the guess it replaces.
    public static func accepts(_ candidate: GeoPoint, anchors: [GeoPoint]) -> Bool {
        guard let centre = Framing.centroid(anchors) else { return true }
        return Framing.distanceM(centre, candidate) <= maxCorrectionM
    }

    /// The candidate to believe, if any: **the acceptable one nearest to where the model put it.**
    ///
    /// **Not Apple's first hit, and that is a bug fix rather than a preference.** Day 1 of the
    /// test trip contains "La Posta", which is Italian for "the post office" and names a dozen
    /// places in Tuscany. Taking the top result moved it ten kilometres to Bagno Vignoni — and
    /// that stop had *authoritative* coordinates, because it was added through the add-a-stop
    /// flow from `MKLocalSearch` in the first place. The repair made the data worse.
    ///
    /// The model's guess is a weak signal but it is not no signal: it says "roughly Pienza". So
    /// among the candidates the sanity radius admits, take the one that moves the stop *least*.
    /// The Pienza La Posta then finds itself and stays put, while Caffè Poliziano still travels
    /// to Montepulciano because no nearer candidate exists. Minimum necessary movement is the
    /// right default for a repair.
    ///
    /// This also removes the need to mark search-added stops as exempt: a stop already in the
    /// right place resolves to itself, and `isWorthApplying` then discards the no-op.
    public static func best(
        of candidates: [GeoPoint], near original: GeoPoint, anchors: [GeoPoint]
    ) -> GeoPoint? {
        candidates
            .filter { accepts($0, anchors: anchors) }
            .min { Framing.distanceM(original, $0) < Framing.distanceM(original, $1) }
            .flatMap { isWorthApplying(from: original, to: $0) ? $0 : nil }
    }

    /// Is this move worth recording at all? See `minCorrectionM`.
    public static func isWorthApplying(from old: GeoPoint, to new: GeoPoint) -> Bool {
        Framing.distanceM(old, new) >= minCorrectionM
    }
}
