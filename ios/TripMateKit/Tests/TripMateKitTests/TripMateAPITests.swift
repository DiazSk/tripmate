import XCTest
@testable import TripMateKit

/// Feeds canned responses to a real `URLSession`, so these tests exercise the client's actual
/// request-building, status-mapping and streaming path rather than a seam around them.
final class StubURLProtocol: URLProtocol {
    struct Stub {
        var status: Int = 200
        var headers: [String: String] = ["Content-Type": "application/json"]
        /// Delivered in order, as separate loads — which is what lets a streaming test cut the
        /// SSE body at deliberately awkward boundaries.
        var chunks: [Data] = []
    }

    /// Test-only, and each test sets it before issuing its one request. Marked unsafe rather than
    /// wrapped in a lock because adding synchronisation here would be ceremony around a value
    /// that is never contended.
    nonisolated(unsafe) static var stub = Stub()
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        let response = HTTPURLResponse(
            url: request.url!, statusCode: Self.stub.status,
            httpVersion: "HTTP/1.1", headerFields: Self.stub.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in Self.stub.chunks { client?.urlProtocol(self, didLoad: chunk) }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    static func reset() {
        stub = Stub()
        lastRequest = nil
    }
}

final class TripMateAPITests: XCTestCase {

    private var api: TripMateAPI!

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        api = TripMateAPI(
            baseURL: URL(string: "https://example.test")!,
            session: URLSession(configuration: config)
        )
    }

    private func stub(_ status: Int, _ body: String) {
        StubURLProtocol.stub = .init(status: status, chunks: [Data(body.utf8)])
    }

    // MARK: - Status mapping
    //
    // 429 and 503 are the two that matter most: the contract calls them first-class states, so a
    // test pins that they keep the server's own copy instead of collapsing to a generic error.

    func testThrottleMapsToTypedCaseAndKeepsServerCopy() async {
        stub(429, #"{"error":"Too many requests — slow down and try again shortly."}"#)
        do {
            _ = try await api.listTrips()
            XCTFail("expected a throw")
        } catch let error as APIError {
            guard case .throttled(let message) = error else { return XCTFail("got \(error)") }
            XCTAssertTrue(message.contains("slow down"))
        } catch { XCTFail("wrong error type: \(error)") }
    }

    func testSpendCapMapsToItsOwnCase() async {
        stub(503, #"{"error":"Demo budget for today has been used up — try again tomorrow."}"#)
        do {
            _ = try await api.listTrips()
            XCTFail("expected a throw")
        } catch let error as APIError {
            guard case .spendCapReached(let message) = error else { return XCTFail("got \(error)") }
            XCTAssertTrue(message.contains("Demo budget"))
        } catch { XCTFail("wrong error type: \(error)") }
    }

    func testPaymentRequiredMapsToNotEntitled() async {
        stub(402, "{}")
        do {
            _ = try await api.listTrips()
            XCTFail("expected a throw")
        } catch let error as APIError {
            XCTAssertEqual(error, .notEntitled)
        } catch { XCTFail("wrong error type: \(error)") }
    }

    func testNotFoundKeepsTheRoutesOwnWording() async {
        stub(404, #"{"error":"That trip isn't saved here."}"#)
        do {
            _ = try await api.trip(id: "nope")
            XCTFail("expected a throw")
        } catch let error as APIError {
            guard case .notFound(let message) = error else { return XCTFail("got \(error)") }
            XCTAssertEqual(message, "That trip isn't saved here.")
        } catch { XCTFail("wrong error type: \(error)") }
    }

    // MARK: - Requests and decoding

    func testListTripsSendsStatusAndUnwrapsEnvelope() async throws {
        stub(200, #"""
        {"trips":[{"id":"t1","destination":"Lisbon","startDate":"2026-09-19",
          "endDate":"2026-09-20","budget":1200,"status":"saved"}]}
        """#)
        let trips = try await api.listTrips(status: .draft)
        XCTAssertEqual(trips.count, 1)
        XCTAssertEqual(trips[0].destination, "Lisbon")

        let url = StubURLProtocol.lastRequest?.url?.absoluteString ?? ""
        XCTAssertTrue(url.contains("/api/trips"))
        XCTAssertTrue(url.contains("status=draft"))
    }

    /// `endDate` and `days` come back server-derived. The test asserts we read *their* values,
    /// not the ones we sent — an edit that adds a day is exactly when those diverge.
    func testUpdateTripReadsServerDerivedEndDate() async throws {
        stub(200, #"{"ok":true,"endDate":"2026-09-25","days":7,"status":"saved"}"#)
        let result = try await api.updateTrip(
            id: "t1", itinerary: Itinerary(tier: .budget, days: []), status: .saved
        )
        XCTAssertEqual(result.endDate, "2026-09-25")
        XCTAssertEqual(result.days, 7)
        XCTAssertEqual(result.status, .saved)
        XCTAssertEqual(StubURLProtocol.lastRequest?.httpMethod, "PATCH")
    }

    func testGeocodeDecodesLngSpelling() async throws {
        stub(200, #"{"lat":38.72,"lng":-9.14,"name":"Lisbon"}"#)
        let place = try await api.geocode(destination: "Lisbon")
        XCTAssertEqual(place.lng, -9.14)
        XCTAssertEqual(place.name, "Lisbon")
    }

    // MARK: - Streaming

    private static let sseBody = """
    :\(String(repeating: " ", count: 2048))

    event: stage
    data: {"stage":"generate","status":"start"}

    :

    event: stop
    data: {"dayIndex":0,"stopIndex":0,"date":"2026-09-19","stop":{"name":"Alfama","lat":38.7,\
    "lng":-9.1,"cost":"12","note":"n","time":"9:00 AM","durationLabel":"1h","category":"weird"}}

    event: done
    data: {"itinerary":{"days":[]}}


    """

    /// The whole path: padding frame, keepalive, a lenient cost, an unknown category, and a
    /// terminating `done` — delivered in awkward 7-byte slices so reassembly is genuinely tested.
    func testGenerateStreamsTypedEventsAcrossChunkBoundaries() async throws {
        let bytes = Array(Self.sseBody.utf8)
        StubURLProtocol.stub = .init(
            status: 200,
            headers: ["Content-Type": "text/event-stream"],
            chunks: stride(from: 0, to: bytes.count, by: 7).map {
                Data(bytes[$0..<min($0 + 7, bytes.count)])
            }
        )

        var names: [String] = []
        for try await event in api.generate(
            .init(destination: "Lisbon", startDate: "2026-09-19", endDate: "2026-09-20", budget: 1200)
        ) {
            switch event {
            case .stage(let s): names.append("stage:\(s.stage.rawValue)")
            case .stop(let s):
                names.append("stop")
                // Both leniency rules, arriving through the real streaming path.
                XCTAssertEqual(s.stop.cost, 12)
                XCTAssertEqual(s.stop.category, .other)
            case .done: names.append("done")
            default: names.append("other")
            }
        }
        XCTAssertEqual(names, ["stage:generate", "stop", "done"])
    }

    /// The web client's "Ruling B": a plan is interactive from the moment `plan` lands while the
    /// run continues, so a late `error` must not reach the caller and tear it down.
    func testErrorAfterPlanIsDropped() async throws {
        let body = """
        event: plan
        data: {"itinerary":{"days":[]}}

        event: error
        data: {"error":"The planner didn't finish. Try generating again."}


        """
        StubURLProtocol.stub = .init(
            status: 200,
            headers: ["Content-Type": "text/event-stream"],
            chunks: [Data(body.utf8)]
        )

        var sawPlan = false
        var sawFailure = false
        for try await event in api.generate(
            .init(destination: "Lisbon", startDate: "2026-09-19", endDate: "2026-09-20", budget: 1200)
        ) {
            if case .plan = event { sawPlan = true }
            if case .failure = event { sawFailure = true }
        }
        XCTAssertTrue(sawPlan)
        XCTAssertFalse(sawFailure, "a late error must not survive a delivered plan")
    }

    /// An `error` with no preceding `plan` *must* surface — it arrives on an HTTP 200, so this
    /// case is the only signal the generation failed.
    func testErrorBeforePlanIsDelivered() async throws {
        let body = """
        event: error
        data: {"error":"The planner didn't finish. Try generating again."}


        """
        StubURLProtocol.stub = .init(
            status: 200,
            headers: ["Content-Type": "text/event-stream"],
            chunks: [Data(body.utf8)]
        )

        var message: String?
        for try await event in api.generate(
            .init(destination: "Lisbon", startDate: "2026-09-19", endDate: "2026-09-20", budget: 1200)
        ) {
            if case .failure(let m) = event { message = m }
        }
        XCTAssertEqual(message, "The planner didn't finish. Try generating again.")
    }

    /// The throttle fires *before* the stream opens, even with `?stream=1`. A client that only
    /// parsed frames would see an empty stream and report nothing at all.
    func testThrottleBeforeStreamOpensThrowsRatherThanYieldingNothing() async {
        stub(429, #"{"error":"Too many requests — slow down and try again shortly."}"#)
        do {
            for try await _ in api.generate(
                .init(destination: "Lisbon", startDate: "2026-09-19", endDate: "2026-09-20", budget: 1200)
            ) {}
            XCTFail("expected a throw")
        } catch let error as APIError {
            guard case .throttled = error else { return XCTFail("got \(error)") }
        } catch { XCTFail("wrong error type: \(error)") }
    }

    func testGenerateRequestsTheStreamVariant() async {
        StubURLProtocol.stub = .init(
            status: 200, headers: ["Content-Type": "text/event-stream"], chunks: []
        )
        // An empty body is a legitimate (if useless) stream; we only care what was requested.
        do {
            for try await _ in api.generate(
                .init(destination: "Lisbon", startDate: "2026-09-19", endDate: "2026-09-20", budget: 1200)
            ) {}
        } catch {}
        let url = StubURLProtocol.lastRequest?.url?.absoluteString ?? ""
        XCTAssertTrue(url.contains("stream=1"), "got \(url)")
        XCTAssertEqual(StubURLProtocol.lastRequest?.httpMethod, "POST")
    }
}
