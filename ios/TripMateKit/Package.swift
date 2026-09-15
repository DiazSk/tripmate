// swift-tools-version: 6.0
import PackageDescription

// The contract-facing half of the iOS client: wire models, the SSE reader, the API client.
//
// A package rather than a target inside the app, and deliberately Foundation-only — no UIKit, no
// MapKit, no SwiftUI. That buys one thing worth more than the tidiness: `swift test` runs it on
// the host in a second, with no simulator to boot. This is the layer where every decoder rule in
// docs/api-contract-v1.md has to be enforced, and those rules came from real quirks of real
// handlers, so they need the fastest possible feedback loop.
//
// No `platforms:` clause on purpose. Nothing here is platform-specific; the app target sets the
// iOS 27 deployment floor, and pinning it twice is how the two drift.
let package = Package(
    name: "TripMateKit",
    products: [
        .library(name: "TripMateKit", targets: ["TripMateKit"]),
    ],
    targets: [
        .target(name: "TripMateKit"),
        .testTarget(name: "TripMateKitTests", dependencies: ["TripMateKit"]),
    ]
)
