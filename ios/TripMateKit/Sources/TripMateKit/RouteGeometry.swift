import Foundation

/// A point on the world, in the contract's own vocabulary: degrees, and `lng` not `lon`.
///
/// Deliberately not `CLLocationCoordinate2D`. This module is pure arithmetic and stays that way —
/// importing CoreLocation to hold two doubles would tie the geometry to a framework, and the app
/// converts at the one boundary where it draws.
public struct GeoPoint: Sendable, Equatable {
    public let lat: Double
    public let lng: Double

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }

    public init(_ stop: Stop) {
        self.lat = stop.lat
        self.lng = stop.lng
    }
}

/// One stop, with the day it belongs to attached.
///
/// **The day index is attached here and nowhere else.** `Stop` carries no day field — a day is a
/// position in `Itinerary.days`, so the index *is* the day's identity, and this boundary is where
/// it becomes part of a stop's data.
public struct RouteStop: Sendable, Equatable {
    public let dayIndex: Int
    /// Position among the *drawn* stops of its day, so leg `i` runs from stop `i` to stop `i + 1`.
    /// Dense by construction — a dropped stop closes the gap rather than leaving a hole, or the
    /// legs either side of it would be drawn to the wrong places.
    public let indexWithinDay: Int
    /// Position in `DayPlan.stops` before anything was dropped.
    ///
    /// **Both indices exist because the panel and the map count differently.** A zeroed coordinate
    /// is dropped from the drawing but still listed and still read, so a day whose second stop has
    /// no coordinate has its third stop at `indexWithinDay` 1 and `rawIndex` 2. Addressing
    /// emphasis with the wrong one of those points at the neighbour — silently, and only on the
    /// days that have a dropped stop.
    public let rawIndex: Int
    public let point: GeoPoint
    public let name: String
}

/// A day's two colours, as components rather than a `Color`.
///
/// Keeping this UI-free is what lets the palette be asserted in a test. The app makes them into
/// colours at the point of drawing.
public struct DayPalette: Sendable, Equatable {
    public let core: (red: Double, green: Double, blue: Double)
    public let glow: (red: Double, green: Double, blue: Double)

    public static func == (a: DayPalette, b: DayPalette) -> Bool {
        a.core == b.core && a.glow == b.glow
    }
}

public enum RouteGeometry {

    // MARK: - Palette

    private static func rgb(_ hex: UInt32) -> (red: Double, green: Double, blue: Double) {
        (
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }

    /// The five day hues, transcribed from `--route-day-N` in `globals.css`.
    ///
    /// **Note these are the muted, map-native tones, not the neon pairs listed in `DESIGN.md`.**
    /// That list (`route-neon-cyan` and friends) predates a rework and is stale; the CSS is the
    /// source of truth. The ramp's five hues are spaced against each other rather than against the
    /// interface accent, so a new accent moves which day gets an accent tint — not the ramp.
    public static let dayPalettes: [DayPalette] = [
        DayPalette(core: rgb(0x4e8c99), glow: rgb(0x7fb3bd)),
        DayPalette(core: rgb(0xa46e93), glow: rgb(0xc596b6)),
        DayPalette(core: rgb(0xc4784b), glow: rgb(0xdfa079)),
        DayPalette(core: rgb(0x7e9c5e), glow: rgb(0xa6bf89)),
        DayPalette(core: rgb(0x7b77ae), glow: rgb(0xa6a2d0)),
    ]

    /// `--accent`, and the only thing it ever means is **"you are pointing at this"** — never
    /// "this is a Tuesday". The day palettes are spaced against each other rather than against
    /// this, so emphasis stays distinguishable from every day's own hue.
    public static let accent = rgb(0x28b981)

    /// `--route-casing`. **What makes a route legible**, rather than brightness: a stroke of colour
    /// has no guaranteed contrast against uncontrolled cartography, while a stroke with a
    /// near-black border supplies its own wherever it lands.
    public static let casing = rgb(0x0a0806)

    /// The palette for a day, cycling.
    ///
    /// Modulo rather than a hash of some day identifier, and that is the point: modulo guarantees
    /// adjacent days never share a palette until the pool wraps, where a hash makes no such
    /// promise and two consecutive days could collide by chance — which is precisely the case the
    /// palette exists to prevent.
    public static func palette(forDay dayIndex: Int) -> DayPalette {
        dayPalettes[((dayIndex % dayPalettes.count) + dayPalettes.count) % dayPalettes.count]
    }

    // MARK: - Stops

    /// Flatten an itinerary into route stops, dropping anything with no usable coordinate.
    ///
    /// A stop at exactly (0, 0) is treated as missing rather than as a point in the Gulf of
    /// Guinea. The model does occasionally emit a zeroed coordinate, and drawing a route leg out
    /// to the Atlantic is worse than drawing one fewer stop.
    public static func routeStops(_ itinerary: Itinerary) -> [RouteStop] {
        var out: [RouteStop] = []
        for (dayIndex, day) in itinerary.days.enumerated() {
            var withinDay = 0
            for (rawIndex, stop) in day.stops.enumerated() {
                guard stop.lat != 0 || stop.lng != 0 else { continue }
                out.append(
                    RouteStop(
                        dayIndex: dayIndex,
                        indexWithinDay: withinDay,
                        rawIndex: rawIndex,
                        point: GeoPoint(stop),
                        name: stop.name
                    )
                )
                withinDay += 1
            }
        }
        return out
    }

    // MARK: - The 2D design

    /// Transcribed from MapLibre's own layers in `src/lib/maplibreRenderer.ts` — `-glow`,
    /// `-core`, `-pool` and `-dot`. **That is the right reference for a flat map**, and the
    /// casing-plus-taper this replaced was not: those belong to Cesium's elevated glass ribbon,
    /// which has a third dimension to separate days in.
    ///
    /// **Every value here is in screen points, and that is the load-bearing part.** MapLibre's
    /// `circle-radius` and `line-width` are pixels, so a stop dot is the same size whether its
    /// day spans 82m or 67km. Measured on one real trip, day spans cover exactly that range —
    /// three orders of magnitude — which is why the metre-radius rings this replaced could only
    /// read correctly over a narrow band of trips. Screen-space units delete that problem rather
    /// than tuning around it.
    public enum Design {
        /// `-glow`: a wide, blurred line under the core.
        public static let glowWidth: Double = 14
        /// MapLibre's `line-blur: 8`.
        public static let glowBlur: Double = 8
        /// `-core`: `ROUTE_CORE_WIDTH_PX` (4) × the layer's own 0.5 multiplier.
        public static let coreWidth: Double = 2

        /// `-pool`: the soft halo under a stop. `circle-radius: 22`, `circle-blur: 1`.
        public static let poolRadius: Double = 22
        public static let poolBlur: Double = 1
        /// `-dot`: `circle-radius: 5` with a `circle-stroke-width: 1.5`.
        public static let dotRadius: Double = 5
        public static let dotStrokeWidth: Double = 1.5

        /// Opacities at full emphasis, with MapLibre's multipliers already applied: the glow and
        /// pool layers are `glowOpacity × 0.55` where `glowOpacity` is itself `α × 0.6`, and the
        /// core is `α × 0.5`. Resting α is 1.
        public static let glowOpacity: Double = 0.6 * 0.55
        public static let coreOpacity: Double = 0.5
        public static let dotOpacity: Double = 1
    }
}
