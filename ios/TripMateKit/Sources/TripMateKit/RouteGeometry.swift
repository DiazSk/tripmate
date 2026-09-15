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
    /// Index within its own day, which is what emphasis is addressed by.
    public let indexWithinDay: Int
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
            for stop in day.stops {
                guard stop.lat != 0 || stop.lng != 0 else { continue }
                out.append(
                    RouteStop(
                        dayIndex: dayIndex,
                        indexWithinDay: withinDay,
                        point: GeoPoint(stop),
                        name: stop.name
                    )
                )
                withinDay += 1
            }
        }
        return out
    }

    // MARK: - The taper

    /// `ARC_WIDTH_START` → `ARC_WIDTH_END` over `ARC_TAPER_SEGMENTS`.
    public static let widthStart: Double = 16
    public static let widthEnd: Double = 9
    public static let taperSegments = 6
    /// Total across *both* edges — 5 here is a body between two 2.5pt edges.
    public static let casingWidth: Double = 5

    /// The per-segment widths of a tapering leg.
    ///
    /// **The taper says which way the day runs before any animation does** — it narrows from the
    /// stop being left toward the stop being arrived at. Neither Cesium nor CoreGraphics has
    /// per-vertex width, so a leg is cut into consecutive constant-width pieces; sampled at
    /// segment midpoints so the widths are symmetric about the leg rather than biased to one end.
    public static func taperWidths(
        segments: Int = taperSegments,
        start: Double = widthStart,
        end: Double = widthEnd
    ) -> [Double] {
        guard segments > 0 else { return [] }
        guard segments > 1 else { return [(start + end) / 2] }
        return (0..<segments).map { index in
            let t = (Double(index) + 0.5) / Double(segments)
            return start + (end - start) * t
        }
    }
}
