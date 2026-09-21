import Foundation
import XCTest
@testable import TripMateKit

/// Decoding `POST /api/trip-edit`.
///
/// **The body below is a real captured response**, not a hand-written one — the contract rules in
/// B1 all came from real quirks, and a fixture written from the type would only assert that the
/// type agrees with itself. Captured 2026-09-21 from the Val d'Orcia trip against a running dev
/// server, asking day 1 to lose a stop; trimmed to one day and one stop, envelope untouched.
final class TripEditDecodingTests: XCTestCase {

    private func decode() throws -> TripEdit {
        try JSONDecoder().decode(TripEdit.self, from: Data(Self.captured.utf8))
    }

    func testDecodesTheRealEnvelope() throws {
        let edit = try decode()
        XCTAssertTrue(edit.ok)
        XCTAssertFalse(edit.itinerary.days.isEmpty)
        // 1-based, and the reason the store subtracts one before clearing a correction.
        XCTAssertEqual(edit.daysModified, [1])
        XCTAssertTrue(edit.rejected.isEmpty)
    }

    /// Both are echoed back on the next turn, so losing either silently starts a new conversation
    /// or edits from a stale copy of the plan.
    func testCarriesTheSessionAndTheHash() throws {
        let edit = try decode()
        XCTAssertNotNil(edit.sessionId)
        XCTAssertNotNil(edit.syncedHash)
    }

    /// `ops` is in neither the type nor the response — the route applies the patch itself. If this
    /// ever fails, the contract moved and `applyPatch` now needs a Swift twin.
    func testTheItineraryArrivesApplied() throws {
        let edit = try decode()
        XCTAssertFalse(edit.itinerary.days[0].stops.isEmpty)
    }

    /// A rejected op nulls the hash, which is how the server is forced to resync rather than edit
    /// from a picture it knows is wrong. Null must decode, not throw.
    func testANullHashDecodes() throws {
        let nulled = Self.captured.replacingOccurrences(
            of: "\"syncedHash\": \"\(try decode().syncedHash ?? "")\"",
            with: "\"syncedHash\": null"
        )
        let edit = try JSONDecoder().decode(TripEdit.self, from: Data(nulled.utf8))
        XCTAssertNil(edit.syncedHash)
        XCTAssertTrue(edit.ok)
    }

    /// The route reads only these two keys off a turn; `id` is ours and must not be sent.
    func testAChatTurnEncodesOnlyWhatTheRouteReads() throws {
        let data = try JSONEncoder().encode(ChatTurn(role: .user, content: "drop a stop"))
        let keys = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        ).keys.sorted()
        XCTAssertEqual(keys, ["content", "role"])
    }

    private static let captured = #"""
{
  "ok": true,
  "runId": "32bb3a04-ff32-4570-8707-cc0ab2354e57",
  "sessionId": "dac8c6d5-9559-4e33-815a-b2d234920396",
  "syncedHash": "22fcc290676bcbe2",
  "itinerary": {
    "tier": "midrange",
    "days": [
      {
        "stops": [
          {
            "note": "9-day rental; small car recommended for narrow historic center streets",
            "lng": 11.6785,
            "tags": [
              "Necessary"
            ],
            "actualCost": 455,
            "category": "transit",
            "cost": 380,
            "name": "Car rental pickup",
            "time": "11:00 AM",
            "durationLabel": "1 hour",
            "why": "Essential for exploring Val d'Orcia's hilltop towns and rural roads",
            "lat": 43.0766
          }
        ],
        "weather": "Warm and sunny, cooling in the evening",
        "date": "2026-09-12",
        "summary": "Arrive in the heart of Val d'Orcia, settle into your Pienza base, and explore this Renaissance gem's cheese shops and stone streets. 🧀✨",
        "lodging": {
          "note": "Central location for exploring Val d'Orcia; farmhouse charm suits food/culture focus. Alternative: B&B in town center.",
          "cost": 125,
          "name": "Boutique agriturismo in Pienza"
        }
      }
    ]
  },
  "reply": "I'll drop the Pienza historic center visit to make day 1 less rushed. Since you're staying there for several nights, you can explore the town another day. I've also moved dinner earlier to 6:30 PM to give you a longer afternoon to settle in at the agriturismo.",
  "options": [],
  "changes": [
    "Removed Pienza historic center sightseeing (saves 2 hours)",
    "Moved dinner to 6:30 PM (from 7:30 PM)",
    "Adjusted evening stop to 8:45 PM"
  ],
  "warnings": [],
  "daysModified": [
    1
  ],
  "why": null,
  "knockOn": null,
  "rejected": []
}
"""#
}
