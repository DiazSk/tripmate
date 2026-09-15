import SwiftUI

/// Where hardware physically interrupts the display — on a foldable, the hinge.
///
/// **Always empty on the iOS 27.0 SDK, and that is a fact about the SDK rather than a stub.**
/// `SwiftUI.ReservedRegion` and `GeometryProxy.reservedRegions(kind:options:layoutDirectionBehavior:)`
/// exist as exported symbols in `SwiftUICore.tbd` but are declared in **no swiftinterface**, so
/// nothing can compile against them — not even through `@_spi`, since there is no declaration to
/// import. A `.tbd` lists everything a dylib exports, internal symbols included; it is not an API
/// surface, and reading one as if it were is what produced an earlier wrong conclusion here.
///
/// This type stays because it is the seam the real API attaches to, and because the alternative is
/// retrofitting hinge-awareness through the map layer after the fact — which is precisely how
/// fold-specific branches get scattered through a codebase. One function changes when the API
/// lands. Nothing above this line does.
struct ShellExclusions: Equatable, Sendable {
    /// Active exclusion frames in the shell's coordinate space.
    var frames: [CGRect] = []

    /// True when hardware is currently interrupting the display.
    ///
    /// Deliberately a different question from "is there room for two panes" — that one is answered
    /// from the available size in `AppShell`, and conflating the two is what makes a layout depend
    /// on a device instead of on a measurement.
    var isInterrupted: Bool { !frames.isEmpty }

    /// The largest active exclusion, which for a book-style fold is the hinge.
    var primaryFrame: CGRect? {
        frames.max { $0.width * $0.height < $1.width * $1.height }
    }
}

private struct ShellExclusionsKey: EnvironmentKey {
    static let defaultValue = ShellExclusions()
}

extension EnvironmentValues {
    /// Read by anything drawing into the world layer — the map's camera framing above all, since
    /// a route centred on the fold is bisected by physical hardware.
    var shellExclusions: ShellExclusions {
        get { self[ShellExclusionsKey.self] }
        set { self[ShellExclusionsKey.self] = newValue }
    }
}

extension GeometryProxy {
    /// The one place the reserved-region API attaches.
    ///
    /// When the SDK declares it, this becomes:
    ///
    /// ```swift
    /// ShellExclusions(
    ///     frames: reservedRegions(kind: .exclusion, options: [], layoutDirectionBehavior: .fixed)
    ///         .filter(\.isActive)
    ///         .map(\.frame)
    /// )
    /// ```
    ///
    /// `.fixed` rather than `.mirrors` for the layout direction, because a hinge does not move
    /// when the interface flips to right-to-left — it is a fact about hardware, not reading order,
    /// and mirroring it would put the exclusion on the wrong half of the screen in Arabic.
    func activeExclusions() -> ShellExclusions {
        ShellExclusions()
    }
}
