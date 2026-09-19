import CoreText
import SwiftUI
import TripMateKit
import UIKit

// MARK: - Applying it

extension View {
    /// Font, tracking and line spacing in one call, because SwiftUI splits them across three.
    ///
    /// **`.tracking()`, not `.kerning()` — and the old code used the wrong one as well as the
    /// wrong number.** CSS `letter-spacing` adds space after *every* character including the
    /// last; `kerning` only adjusts between pairs. `tracking` is the faithful match.
    func textStyle(_ style: TextStyle) -> some View {
        modifier(TextStyleModifier(style: style))
    }
}

private struct TextStyleModifier: ViewModifier {
    let style: TextStyle

    func body(content: Content) -> some View {
        let uiFont = FontLoader.font(style)
        return content
            .font(Font(uiFont))
            .tracking(style.tracking)
            // **CSS `line-height` is a total; SwiftUI's `lineSpacing` is the gap between lines.**
            // So it is the difference, and it depends on the face's own metrics rather than on
            // the point size — which is why it is measured off the loaded font here instead of
            // being derived arithmetically.
            .lineSpacing(max(0, style.lineHeight * style.size - uiFont.lineHeight))
    }
}

// MARK: - Loading

/// Registers the bundled faces and builds fonts at a point on the weight axis.
///
/// **`CTFontManagerRegisterFontsForURLs`, not `UIAppFonts`.** The project sets
/// `GENERATE_INFOPLIST_FILE = YES` and has no Info.plist to put an array in; the folder is a
/// `PBXFileSystemSynchronizedRootGroup`, so dropping the files in bundles them with no project
/// surgery.
enum FontLoader {

    /// Call once, before anything draws.
    static func registerBundledFonts() {
        let urls = [Typeface.melodrama, .switzer, .tabular].compactMap {
            Bundle.main.url(forResource: $0.fileName, withExtension: "ttf")
        }
        guard !urls.isEmpty else { return }
        // The completion handler returning `true` means "keep going after an error". A duplicate
        // registration is the expected error — a SwiftUI preview host registers twice — and it
        // is not worth failing a launch over.
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true) { _, _ in true }
    }

    /// The `wght` axis tag, as the four-byte integer CoreText wants.
    private static let wghtAxis = 0x77676874  // 'wght'

    /// Build the face at an exact weight.
    ///
    /// **Verified before being relied on**, the lesson from reporting `.tbd` symbols as API:
    /// asking for 400 makes `CTFontCopyVariation` report 400 and widens "My memories" from
    /// 147.39pt to 151.17pt against the file's 300 default. The axis is real.
    ///
    /// Falls back to the system face rather than trapping — a missing font should look wrong,
    /// not crash, and the visual diff in verification is what catches it.
    static func font(_ style: TextStyle) -> UIFont {
        let clamped = min(max(style.wght, style.face.weightRange.lowerBound),
                          style.face.weightRange.upperBound)
        let key = "\(style.face.fileName)-\(clamped)-\(style.size)"
        if let cached = cache.object(forKey: key as NSString) { return cached }

        guard let url = Bundle.main.url(forResource: style.face.fileName, withExtension: "ttf"),
              let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL)
                as? [CTFontDescriptor],
              let base = descriptors.first
        else {
            return .systemFont(ofSize: style.size, weight: uiWeight(clamped))
        }

        let varied = CTFontDescriptorCreateCopyWithAttributes(base, [
            kCTFontVariationAttribute: [wghtAxis: clamped],
        ] as CFDictionary)
        let font = CTFontCreateWithFontDescriptor(varied, style.size, nil) as UIFont
        cache.setObject(font, forKey: key as NSString)
        return font
    }

    /// Only for the fallback path, where there is no axis to set.
    private static func uiWeight(_ wght: Float) -> UIFont.Weight {
        switch wght {
        case ..<350: .light
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        default: .bold
        }
    }

    /// Building a `CTFont` per text render is measurable; these are few and immutable.
    ///
    /// `nonisolated(unsafe)` because `NSCache` is documented thread-safe — the compiler cannot
    /// prove that, and an actor would make `font()` async, which a `ViewModifier` cannot await.
    nonisolated(unsafe) private static let cache = NSCache<NSString, UIFont>()
}
