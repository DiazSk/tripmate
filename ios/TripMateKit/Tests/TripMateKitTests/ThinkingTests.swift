import Foundation
import XCTest
@testable import TripMateKit

final class ThinkingTests: XCTestCase {
    private let epoch = Date(timeIntervalSinceReferenceDate: 0)

    func testAdvancesOncePerPeriod() {
        XCTAssertEqual(Thinking.word(at: epoch), Thinking.words[0])
        XCTAssertEqual(Thinking.word(at: epoch.addingTimeInterval(2.4)), Thinking.words[0])
        XCTAssertEqual(Thinking.word(at: epoch.addingTimeInterval(2.6)), Thinking.words[1])
    }

    func testWrapsAround() {
        let full = Thinking.period * Double(Thinking.words.count)
        XCTAssertEqual(Thinking.word(at: epoch.addingTimeInterval(full)), Thinking.words[0])
        XCTAssertEqual(
            Thinking.word(at: epoch.addingTimeInterval(full + Thinking.period)),
            Thinking.words[1]
        )
    }

    /// **The guard.** Before 2001 the interval is negative; `Int(_:)` truncates toward zero and
    /// leaves a negative remainder, which traps on subscript.
    func testNegativeInstantsDoNotTrap() {
        for seconds in stride(from: -60.0, through: -0.5, by: 0.5) {
            let word = Thinking.word(at: Date(timeIntervalSinceReferenceDate: seconds))
            XCTAssertTrue(Thinking.words.contains(word))
        }
    }
}
