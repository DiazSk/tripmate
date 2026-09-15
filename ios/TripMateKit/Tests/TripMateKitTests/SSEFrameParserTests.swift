import XCTest
@testable import TripMateKit

/// The parser's job is to behave exactly like `src/lib/eventStream.ts`. Every test here pins a
/// rule that file documents, and most of them pin a rule whose failure is *silent* — a dropped
/// keepalive looks like a stalled generation, a mis-split frame looks like a malformed plan.
final class SSEFrameParserTests: XCTestCase {

    func testDispatchesASimpleFrame() {
        var p = SSEFrameParser()
        let events = p.consume("event: stage\ndata: {\"stage\":\"geocode\",\"status\":\"start\"}\n\n")
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].name, "stage")
        XCTAssertEqual(events[0].data, "{\"stage\":\"geocode\",\"status\":\"start\"}")
    }

    /// The server sends `:` + 2048 spaces first, to push past WebKit's 1024-byte buffering
    /// threshold. It is a comment frame and must never surface as an event.
    func testSkipsThe2048SpacePaddingFrame() {
        var p = SSEFrameParser()
        let padding = ":" + String(repeating: " ", count: 2048) + "\n\n"
        XCTAssertEqual(p.consume(padding).count, 0)
    }

    /// A bare `:\n\n` every 20s keeps proxies from killing the 60-150s generate wait.
    func testSkipsTheKeepaliveComment() {
        var p = SSEFrameParser()
        XCTAssertEqual(p.consume(":\n\n").count, 0)
    }

    /// The failure this exists to prevent: one chunk equals one frame is false under real network
    /// conditions, and a parser that assumes it corrupts the payload rather than erroring.
    func testReassemblesAFrameSplitAcrossChunks() {
        var p = SSEFrameParser()
        XCTAssertEqual(p.consume("event: sto").count, 0)
        XCTAssertEqual(p.consume("p\ndata: {\"dayIndex\"").count, 0)
        let events = p.consume(":0}\n\n")
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].name, "stop")
        XCTAssertEqual(events[0].data, "{\"dayIndex\":0}")
    }

    /// Byte-level buffering means a multi-byte character straddling a chunk boundary is fine.
    /// String-level accumulation is where this breaks, and destination names are full of accents.
    func testHandlesAMultiByteCharacterSplitAcrossChunks() {
        var p = SSEFrameParser()
        let full = Array("event: stop\ndata: {\"name\":\"Jerónimos\"}\n\n".utf8)
        // Cut inside the two-byte "ó" (0xC3 0xB3).
        let cut = full.firstIndex(of: 0xC3)! + 1
        XCTAssertEqual(p.consume(Data(full[..<cut])).count, 0)
        let events = p.consume(Data(full[cut...]))
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].data, "{\"name\":\"Jerónimos\"}")
    }

    /// The boundary is `\n\n`; a frame arriving with the next one already appended must yield two.
    func testDispatchesMultipleFramesFromOneChunk() {
        var p = SSEFrameParser()
        let events = p.consume("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n")
        XCTAssertEqual(events.map(\.name), ["a", "b"])
        XCTAssertEqual(events.map(\.data), ["1", "2"])
    }

    /// A frame with no `event:` line is `message`, per the spec and the web parser.
    func testDefaultsTheEventNameToMessage() {
        var p = SSEFrameParser()
        let events = p.consume("data: hello\n\n")
        XCTAssertEqual(events.first?.name, "message")
    }

    /// `if (data) onEvent(...)` — a frame carrying only a name is not an event.
    func testDropsAFrameWithNoData() {
        var p = SSEFrameParser()
        XCTAssertEqual(p.consume("event: stage\n\n").count, 0)
    }

    /// An unterminated trailing frame is discarded deliberately: no reliable event/data split.
    /// A caller detects a truncated stream by never having seen `done` or `error`.
    func testLeavesAnUnterminatedFrameUndispatched() {
        var p = SSEFrameParser()
        XCTAssertEqual(p.consume("event: done\ndata: {\"partial\":").count, 0)
        XCTAssertEqual(p.unterminatedRemainder, "event: done\ndata: {\"partial\":")
    }

    func testDecodesEachNamedGenerationEvent() throws {
        var p = SSEFrameParser()
        let stream = """
        event: stage
        data: {"stage":"generate","status":"start"}

        event: day-coords
        data: {"dayIndex":1,"coords":{"Alfama":{"lat":38.7,"lon":-9.1}}}

        event: error
        data: {"error":"The planner didn't finish. Try generating again."}


        """
        let typed = try p.consume(stream).map { try $0.asGenerationEvent() }
        XCTAssertEqual(typed.count, 3)

        guard case .stage(let s) = typed[0] else { return XCTFail("expected .stage") }
        XCTAssertEqual(s.stage, .generate)
        XCTAssertEqual(s.status, .start)

        // The coordinate spelling that differs from `Stop.lng`.
        guard case .dayCoords(let d) = typed[1] else { return XCTFail("expected .dayCoords") }
        XCTAssertEqual(d.coords["Alfama"]?.lon, -9.1)

        guard case .failure(let message) = typed[2] else { return XCTFail("expected .failure") }
        XCTAssertTrue(message.contains("didn't finish"))
    }

    /// A name this client does not model is not an error — the server may add events.
    func testUnknownEventNameIsKeptNotThrown() throws {
        var p = SSEFrameParser()
        let events = p.consume("event: some-future-thing\ndata: {}\n\n")
        guard case .unknown(let name, _) = try events[0].asGenerationEvent() else {
            return XCTFail("expected .unknown")
        }
        XCTAssertEqual(name, "some-future-thing")
    }
}
