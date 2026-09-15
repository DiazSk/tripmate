import Foundation

/// One dispatched frame: the `event:` name and its raw `data:` payload.
public struct SSEEvent: Sendable, Equatable {
    public let name: String
    public let data: String
}

/// Incremental SSE frame parser, ported rule-for-rule from the web client's own
/// `src/lib/eventStream.ts`. `EventSource` is GET-only and this stream is POST-initiated, so both
/// clients have to parse by hand — and they must parse *identically*, or the two disagree about
/// what a generation produced.
///
/// **Buffers at the byte level, not the string level**, which is the one place this improves on
/// the original rather than copying it. Frame boundaries are ASCII `\n\n`, so splitting on bytes
/// and decoding each *complete* frame as UTF-8 makes a multi-byte character split across a chunk
/// boundary structurally impossible. The JS version needs `TextDecoder(…, {stream: true})` to get
/// the same guarantee.
///
/// A value type on purpose: the whole point is that `consume` can be driven from a test with
/// hand-cut chunk boundaries, with no network and no async.
public struct SSEFrameParser: Sendable {
    private var buffer = Data()

    public init() {}

    /// Feed one chunk. Returns every *complete* frame it completed, in order.
    ///
    /// Frames that carry no `data` are dropped rather than returned — that covers the 2048-space
    /// padding frame the server sends first to defeat WebKit's 1024-byte buffering, and the bare
    /// `:\n\n` keepalive it sends every 20s. Both are comment frames, and a caller should never
    /// have to know they exist.
    public mutating func consume(_ chunk: Data) -> [SSEEvent] {
        buffer.append(chunk)
        var out: [SSEEvent] = []
        while let range = buffer.firstRange(of: Data([0x0A, 0x0A])) {
            let frame = buffer[buffer.startIndex..<range.lowerBound]
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            if let event = Self.dispatch(frame) { out.append(event) }
        }
        return out
    }

    /// Convenience for tests and for callers holding text already.
    public mutating func consume(_ text: String) -> [SSEEvent] {
        consume(Data(text.utf8))
    }

    /// Whatever is left unterminated when the stream ends.
    ///
    /// **Deliberately discarded, matching the web client.** A partial frame has no reliable
    /// event/data split, so there is nothing honest to do with it. Exposed only so a caller can
    /// assert it is empty in a test; detect "the stream ended with nothing usable" by whether you
    /// ever saw `done` or `error`, never by inspecting this.
    public var unterminatedRemainder: String {
        String(decoding: buffer, as: UTF8.self)
    }

    private static func dispatch(_ frame: Data) -> SSEEvent? {
        var name = "message"
        var data = ""
        for lineBytes in frame.split(separator: 0x0A, omittingEmptySubsequences: false) {
            let line = String(decoding: lineBytes, as: UTF8.self)
            // Comments — the padding frame, the keepalive, and anything else the server chooses
            // to send that a client must not interpret.
            if line.hasPrefix(":") { continue }
            if line.hasPrefix("event:") {
                name = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                data = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
            }
        }
        // Empty `data` is not an event. Matches `if (data) onEvent(...)` in eventStream.ts.
        return data.isEmpty ? nil : SSEEvent(name: name, data: data)
    }
}

// MARK: - Typed generation events

/// The named events `POST /api/itinerary?stream=1` emits, per the contract.
public enum GenerationEvent: Sendable {
    case stage(StageEvent)
    case stop(StreamedStop)
    case dayCoords(DayCoordsEvent)
    /// The plan is interactive *now*; the run is not over.
    case plan(GenerationResult)
    case revised(RevisedEvent)
    case done(GenerationResult)
    /// **Arrives on an HTTP 200.** There is no status code to check, so this case is the only
    /// signal — surface it or a failure reads as a hang.
    case failure(String)
    /// A named event this client does not model. Kept rather than thrown: the server may add
    /// events, and an unknown one is not an error.
    case unknown(name: String, data: String)
}

public struct StageEvent: Codable, Sendable, Equatable {
    public enum Stage: String, Codable, Sendable {
        case geocode, context, generate, critique, placing
    }
    public enum Status: String, Codable, Sendable {
        case start, done, skipped, failed
    }
    public let stage: Stage
    public let status: Status
}

/// One stop parsed out of the model's streaming text. This is what draws the route live.
public struct StreamedStop: Codable, Sendable, Equatable {
    public let dayIndex: Int
    public let stopIndex: Int
    /// `""` when the model omitted it — not null, and not absent.
    public let date: String
    public let stop: Stop
}

/// Geocode fix-ups, keyed by stop *name*.
///
/// Note the coordinate spelling: **`lon` here, `lng` on `Stop`.** Contract rule 3, and the reason
/// there is no single shared coordinate type in this package.
public struct DayCoordsEvent: Codable, Sendable, Equatable {
    public struct Point: Codable, Sendable, Equatable {
        public let lat: Double
        public let lon: Double
    }
    public let dayIndex: Int
    public let coords: [String: Point]
}

public struct RevisedEvent: Codable, Sendable, Equatable {
    public let days: [DayPlan]
    public let issues: [String]
}

public struct GenerationResult: Codable, Sendable, Equatable {
    public let itinerary: Itinerary
    public let traceId: String?
    public let runId: String?
    /// Genuinely *absent* when unknown rather than null — the one place on this wire where that
    /// distinction holds.
    public let sessionId: String?
}

public extension SSEEvent {
    /// Decode this frame into a typed generation event.
    ///
    /// Returns `.unknown` for an unrecognised name, and throws only when a *recognised* name
    /// carries undecodable data — that is a real contract violation and should be loud.
    func asGenerationEvent(decoder: JSONDecoder = .tripMate) throws -> GenerationEvent {
        let bytes = Data(data.utf8)
        switch name {
        case "stage":  return .stage(try decoder.decode(StageEvent.self, from: bytes))
        case "stop":   return .stop(try decoder.decode(StreamedStop.self, from: bytes))
        case "day-coords": return .dayCoords(try decoder.decode(DayCoordsEvent.self, from: bytes))
        case "plan":   return .plan(try decoder.decode(GenerationResult.self, from: bytes))
        case "revised": return .revised(try decoder.decode(RevisedEvent.self, from: bytes))
        case "done":   return .done(try decoder.decode(GenerationResult.self, from: bytes))
        case "error":
            struct Envelope: Decodable { let error: String }
            return .failure(try decoder.decode(Envelope.self, from: bytes).error)
        default: return .unknown(name: name, data: data)
        }
    }
}
