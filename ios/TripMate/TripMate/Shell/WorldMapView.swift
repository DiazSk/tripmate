import MapKit
import SwiftUI

/// The map, as `MKMapView` wrapped for SwiftUI.
///
/// **`UIViewRepresentable` rather than SwiftUI's `Map`, and not by preference.** Every framing
/// rule this app owns is written in terms of a target point plus a *range*, a pitch and a
/// heading — that is the vocabulary `mapCamera.tsx` uses and the vocabulary `MKMapCamera` happens
/// to take verbatim. SwiftUI's `Map` does not expose that camera, so the framing logic would have
/// to be rewritten against a different model to use it.
///
/// Deliberately minimal. This is the shell's map, not the renderer: it proves the wrap, the dark
/// configuration and the hinge plumbing. Routes, stop markers, ground rings and the camera state
/// machine are the renderer's own phase, and a half-built one here would be something to unpick
/// rather than build on.
struct WorldMapView: UIViewRepresentable {
    @Environment(\.shellExclusions) private var exclusions

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()

        // Apple's own cartography is all there is here — there is no tint knob, no LOD control
        // and no style JSON, which is the trade `DESIGN.md`'s globe section documents losing.
        // `.realistic` elevation is the one thing that buys back a sense of terrain.
        let configuration = MKStandardMapConfiguration(elevationStyle: .realistic)
        configuration.pointOfInterestFilter = .includingAll
        map.preferredConfiguration = configuration

        map.showsCompass = false      // The app draws its own, per DESIGN.md's control stack.
        map.showsScale = false
        map.isRotateEnabled = true
        map.isPitchEnabled = true
        // The interface is dark-only (`color-scheme: dark` in the web app's :root), so the map
        // must not follow the system appearance into light.
        map.overrideUserInterfaceStyle = .dark
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.directionalLayoutMargins = Self.margins(
            clearing: exclusions, in: map.bounds
        )
    }

    /// Keep MapKit's *own* furniture — the attribution label, and the compass when it is shown —
    /// out of the hinge.
    ///
    /// A middle band is not expressible as edge insets, so this does the one part that is: it
    /// insets from whichever edge the band is nearer, pushing MapKit's controls onto the roomier
    /// half. **This is not the app's hinge handling.** A route whose centre falls on the fold is
    /// bisected by physical hardware, and the fix for that is camera framing that biases the
    /// target clear of the exclusion — which belongs with the framing rules, not here.
    static func margins(
        clearing exclusions: ShellExclusions, in bounds: CGRect
    ) -> NSDirectionalEdgeInsets {
        guard
            let band = exclusions.primaryFrame,
            band.width > 0, band.height > 0,
            bounds.width > 0
        else { return .zero }

        // A book-style fold reads as a tall, narrow band. A wide, short one is a notch or an
        // under-display camera, which the system already handles through safe areas.
        guard band.height > band.width else { return .zero }

        let bandIsNearLeading = band.midX < bounds.midX
        return bandIsNearLeading
            ? NSDirectionalEdgeInsets(top: 0, leading: band.maxX, bottom: 0, trailing: 0)
            : NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: bounds.width - band.minX)
    }
}
