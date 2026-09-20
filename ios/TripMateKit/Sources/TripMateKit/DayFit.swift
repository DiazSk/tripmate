import Foundation

/// Which day of a trip a newly-found place belongs to, decided from coordinates alone.
///
/// **No model call, deliberately.** A day is already a shape on the map — the stops the planner
/// grouped together — and "which of these shapes does this point belong to" is a question geometry
/// answers exactly, in microseconds, offline, and identically every time. Handing it to an LLM
/// would trade all four for an opinion. What comes back is a *suggestion* anyway: the day list
/// stays fully selectable, so being wrong costs a tap rather than a wrong plan.
///
/// The scoring is **distance to the day's centroid measured in units of that day's own radius**,
/// and the normalisation is the whole point. Raw distance systematically prefers sprawling days: a
/// day crossing a region has a centroid "near" everything, while a tight morning pocket three
/// streets over is judged far by the same metre count that would be nothing to the sprawling one.
/// Dividing by the day's own spread asks the question that matters — *is this point the kind of
/// distance from this day that this day's own stops are?* — so a café 900m from a pocket that fits
/// inside 1.1km reads as a worse fit than one 3.8km into a day that already spans 12km.
///
/// Ported from `src/lib/dayFit.ts` with its 13 cases. It reuses `Framing.distanceM` and
/// `Framing.centroid`, which are the same haversine and the same plain mean the web computes.
/// `Framing.boundingRadiusM` is **not** reused — see `radius`.
public enum DayFit {

    /// A day reduced to what the fit needs: its index in the trip and the coordinates it holds.
    public struct DayShape: Sendable, Equatable {
        public let day: Int
        public let stops: [GeoPoint]

        public init(day: Int, stops: [GeoPoint]) {
            self.day = day
            self.stops = stops
        }
    }

    public struct Fit: Sendable, Equatable {
        /// Index into the trip's days, matching `DayShape.day`.
        public let day: Int
        /// Metres from the point to the day's centroid. Reported for "1.2 km from Day 3".
        public let distanceM: Double
        /// `distanceM` in units of the day's own radius — what days are actually ranked on. Lower
        /// is a better fit; `.infinity` for a day with no stops, which is never recommended.
        public let score: Double
    }

    /// The floor on a day's radius, in metres.
    ///
    /// A day with one stop has a radius of zero, and dividing by it sends every score to infinity
    /// — a one-stop day would then never be recommended. 400m is roughly a walkable block and a
    /// half, the distance at which two places genuinely read as "the same part of town", so it is
    /// the smallest spread worth treating as a real one.
    public static let minDayRadiusM: Double = 400

    /// Days whose centroid is further than this are not offered at all. A place in another city is
    /// not a fit for any day, and recommending the least-bad one would be a confident wrong answer
    /// where no answer is the honest one.
    public static let maxFitDistanceM: Double = 60_000

    /// How far a day's stops sit from their own centre — the day's "size" for scoring.
    ///
    /// **The mean, not the max**, which is why `Framing.boundingRadiusM` cannot stand in for this.
    /// One outlier must not inflate the whole day's tolerance: a Kyoto day with Fushimi Inari 12km
    /// out from four stops in Gion should not become a day that welcomes anything within 12km. Its
    /// mean radius stays around 3km, which is a fair description of what that day mostly is.
    static func radius(_ stops: [GeoPoint], around centre: GeoPoint) -> Double {
        guard !stops.isEmpty else { return minDayRadiusM }
        let total = stops.reduce(0.0) { $0 + Framing.distanceM(centre, $1) }
        return max(minDayRadiusM, total / Double(stops.count))
    }

    /// Score every day for a candidate point, best fit first.
    ///
    /// Days with no stops score `.infinity` and sort last **but are still returned**: the picker
    /// lists every day whether or not it holds anything, and an empty day is a perfectly
    /// reasonable place to put the first thing — it just is not something geometry can recommend.
    ///
    /// Ties break on the earlier day, so the suggestion is stable. Swift's sort is not guaranteed
    /// stable, so that tiebreak is written rather than relied upon.
    public static func rank(_ point: GeoPoint, days: [DayShape]) -> [Fit] {
        days.map { shape in
            guard let centre = Framing.centroid(shape.stops) else {
                return Fit(day: shape.day, distanceM: .infinity, score: .infinity)
            }
            let distanceM = Framing.distanceM(centre, point)
            return Fit(
                day: shape.day,
                distanceM: distanceM,
                score: distanceM / radius(shape.stops, around: centre)
            )
        }
        .sorted { $0.score == $1.score ? $0.day < $1.day : $0.score < $1.score }
    }

    /// The one day to recommend, or `nil` when geometry has nothing useful to say.
    ///
    /// Nil in three cases, all of them "no honest answer" rather than "no answer computed": no
    /// days at all, no day with any stops to form a shape from, and every day further off than
    /// `maxFitDistanceM`. The caller then shows the day list with no recommendation rather than
    /// pointing at a day it cannot justify.
    public static func suggest(_ point: GeoPoint, days: [DayShape]) -> Fit? {
        guard let best = rank(point, days: days).first,
              best.score.isFinite, best.distanceM <= maxFitDistanceM
        else { return nil }
        return best
    }
}

extension Itinerary {
    /// Every day as a shape, in trip order. What `DayFit.rank` takes.
    public var dayShapes: [DayFit.DayShape] {
        days.enumerated().map { DayFit.DayShape(day: $0.offset, stops: $0.element.stops.map(GeoPoint.init)) }
    }
}
