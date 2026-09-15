import XCTest
@testable import TripMateKit

final class TierTests: XCTestCase {

    /// Nights are one fewer than days, which is what makes a one-day trip cost no lodging.
    func testEstimateChargesOneFewerNightThanDays() {
        let budget = Tiers.tier(.budget)
        XCTAssertEqual(Tiers.estimateTotal(budget, days: 1), 70)
        XCTAssertEqual(Tiers.estimateTotal(budget, days: 2), 70 * 2 + 40)
        XCTAssertEqual(Tiers.estimateTotal(budget, days: 9), 70 * 9 + 40 * 8)
    }

    func testEstimateDoesNotGoNegativeOnZeroDays() {
        XCTAssertEqual(Tiers.estimateTotal(Tiers.tier(.luxury), days: 0), 0)
    }

    /// The three styles for a 9-day trip, which is the length of the fixture trip this app runs
    /// against: 950 / 2550 / 7150.
    func testClosestTierPicksTheNearestEstimate() {
        XCTAssertEqual(Tiers.closest(budget: 900, days: 9), .budget)
        XCTAssertEqual(Tiers.closest(budget: 2600, days: 9), .midrange)
        XCTAssertEqual(Tiers.closest(budget: 9000, days: 9), .luxury)
    }

    /// A zero budget still resolves to a style rather than to nothing, which is what keeps the
    /// route's "No spending style was selected" 400 unreachable for a filled-in form.
    func testClosestTierAlwaysAnswers() {
        XCTAssertEqual(Tiers.closest(budget: 0, days: 9), .budget)
        XCTAssertEqual(Tiers.closest(budget: 1_000_000, days: 9), .luxury)
    }

    /// **Ties go to the earlier tier**, because the scan compares strictly less-than. Exactly
    /// halfway between budget (950) and midrange (2550) for 9 days is 1750.
    func testExactTieGoesToTheEarlierTier() {
        XCTAssertEqual(Tiers.closest(budget: 1750, days: 9), .budget)
        XCTAssertEqual(Tiers.closest(budget: 1751, days: 9), .midrange)
    }

    /// Inclusive: the 12th to the 20th is nine days, not eight.
    func testTripDaysIsInclusive() {
        XCTAssertEqual(Tiers.tripDays(from: "2026-09-12", to: "2026-09-20"), 9)
        XCTAssertEqual(Tiers.tripDays(from: "2026-09-12", to: "2026-09-12"), 1)
    }

    /// **Parsed as UTC.** A date-only string is UTC midnight, and a local formatter rolls it back a
    /// day west of Greenwich — a bug this codebase has already shipped into generated output. A
    /// span crossing a DST boundary is the case that exposes it: parsed locally, 2026-03-28 to
    /// 2026-03-29 in a spring-forward zone is 23 hours and rounds to the wrong side.
    func testTripDaysIsUnaffectedByLocalTimeZoneOrDST() {
        XCTAssertEqual(Tiers.tripDays(from: "2026-03-28", to: "2026-03-29"), 2)
        XCTAssertEqual(Tiers.tripDays(from: "2026-10-24", to: "2026-10-26"), 3)
    }

    /// A reversed range floors at 1 rather than going negative — the cross-field rule is what
    /// tells the traveler, and the day count still has to be usable for tier arithmetic meanwhile.
    func testReversedRangeFloorsAtOneDay() {
        XCTAssertEqual(Tiers.tripDays(from: "2026-09-20", to: "2026-09-12"), 1)
    }

    func testUnparseableDatesFallBackToOneDay() {
        XCTAssertEqual(Tiers.tripDays(from: "", to: ""), 1)
        XCTAssertEqual(Tiers.tripDays(from: "not a date", to: "2026-09-20"), 1)
    }

    func testTripLengthCapIsThirtyDaysInclusive() {
        XCTAssertFalse(Tiers.isTripTooLong(from: "2026-09-01", to: "2026-09-30"))   // 30
        XCTAssertTrue(Tiers.isTripTooLong(from: "2026-09-01", to: "2026-10-01"))    // 31
    }

    /// **Local, not UTC.** `toISOString()` would offer "yesterday" as the earliest start date to
    /// anyone west of Greenwich in the evening. 9pm in Los Angeles is already tomorrow in UTC.
    func testTodayIsLocalRatherThanUTC() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))
        // 2026-09-15 21:00 PDT is 2026-09-16 04:00Z.
        let evening = try XCTUnwrap(
            DateComponents(
                calendar: calendar, timeZone: calendar.timeZone,
                year: 2026, month: 9, day: 15, hour: 21
            ).date
        )
        XCTAssertEqual(Tiers.todayISO(evening, calendar: calendar), "2026-09-15")
    }
}

final class PlanDraftTests: XCTestCase {

    private static func filledBasics() -> PlanDraft {
        var draft = PlanDraft()
        draft.destination = "Val d'Orcia, Italy"
        draft.startDate = "2026-09-12"
        draft.endDate = "2026-09-20"
        draft.budget = 2600
        return draft
    }

    // MARK: - Steps

    func testStepsRunInTheOrderPlanOrderDeclares() {
        XCTAssertEqual(PlanStep.allCases, [.basics, .group, .preferences, .review])
        XCTAssertEqual(PlanStep.basics.next, .group)
        XCTAssertEqual(PlanStep.review.next, nil)
        XCTAssertEqual(PlanStep.basics.previous, nil)
        XCTAssertEqual(PlanStep.preferences.previous, .group)
    }

    // MARK: - Advancing

    /// **Only `basics` can block.** Every field on the later two screens has a defaulted answer,
    /// which is what makes them skippable — a required answer on a screen the traveler has nothing
    /// to say on is a wall in front of a plan.
    func testOnlyBasicsCanBlockAdvancing() {
        let empty = PlanDraft()
        XCTAssertFalse(empty.canAdvance(from: .basics))
        XCTAssertTrue(empty.canAdvance(from: .group))
        XCTAssertTrue(empty.canAdvance(from: .preferences))
    }

    func testBasicsNeedsEveryFieldOfItsOwn() {
        XCTAssertTrue(Self.filledBasics().canAdvance(from: .basics))

        for mutate in [
            { (d: inout PlanDraft) in d.destination = "" },
            { (d: inout PlanDraft) in d.destination = "   " },
            { (d: inout PlanDraft) in d.startDate = "" },
            { (d: inout PlanDraft) in d.endDate = "" },
            { (d: inout PlanDraft) in d.budget = 0 },
            { (d: inout PlanDraft) in d.budget = -100 },
        ] {
            var draft = Self.filledBasics()
            mutate(&draft)
            XCTAssertFalse(draft.canAdvance(from: .basics))
        }
    }

    /// A geocode miss is **not** a block. A third-party geocoder's outage must not read as "the app
    /// is broken", and the trip plans regardless of whether Open-Meteo recognised the name.
    func testAGeocodeMissDoesNotBlockTheTrip() {
        var draft = Self.filledBasics()
        draft.destinationMissed = true
        XCTAssertTrue(draft.canAdvance(from: .basics))
        XCTAssertTrue(draft.canGenerate)
    }

    func testCrossFieldRulesAreTheTwoTheWebStates() {
        var draft = Self.filledBasics()
        XCTAssertNil(draft.crossFieldProblem)

        draft.endDate = "2026-09-01"
        XCTAssertEqual(draft.crossFieldProblem, "End date must be on or after the start date.")

        draft.endDate = "2026-11-01"
        XCTAssertEqual(
            draft.crossFieldProblem,
            "Trips over 30 days aren't supported — please choose a shorter date range."
        )
    }

    /// Half-typed dates must not produce an error the traveler cannot act on yet.
    func testNoCrossFieldComplaintBeforeBothDatesExist() {
        var draft = PlanDraft()
        draft.startDate = "2026-09-12"
        XCTAssertNil(draft.crossFieldProblem)
    }

    // MARK: - Tier

    /// Derived, never chosen — so the review screen and the request body cannot disagree with the
    /// number just typed.
    func testTierFollowsTheBudgetAndTheDayCount() {
        var draft = Self.filledBasics()
        XCTAssertEqual(draft.days, 9)
        XCTAssertEqual(draft.tier, .midrange)

        draft.budget = 800
        XCTAssertEqual(draft.tier, .budget)

        draft.budget = 12_000
        XCTAssertEqual(draft.tier, .luxury)
    }

    // MARK: - Interests

    /// Deselecting a tag **unstars** it, or a star outlives its tag and keeps weighting a
    /// preference the traveler just removed.
    func testDeselectingAnInterestAlsoUnstarsIt() {
        var draft = PlanDraft()
        draft.toggleInterest("Food")
        draft.toggleStar("Food")
        XCTAssertEqual(draft.starredInterests, ["Food"])

        draft.toggleInterest("Food")
        XCTAssertEqual(draft.interests, [])
        XCTAssertEqual(draft.starredInterests, [])
    }

    func testStarringAnUnselectedTagSelectsItToo() {
        var draft = PlanDraft()
        draft.toggleStar("Nightlife")
        XCTAssertEqual(draft.interests, ["Nightlife"])
        XCTAssertEqual(draft.starredInterests, ["Nightlife"])
    }

    /// The cap is a no-op, not an eviction: silently dropping a choice the traveler made is worse
    /// than a button that visibly does nothing while the remaining count is on screen.
    func testStarsCapAtThreeWithoutEvictingTheOldest() {
        var draft = PlanDraft()
        for tag in ["Food", "Nightlife", "Shopping"] { draft.toggleStar(tag) }
        XCTAssertEqual(draft.starsRemaining, 0)

        draft.toggleStar("Photography")
        XCTAssertEqual(draft.starredInterests, ["Food", "Nightlife", "Shopping"])
        // And it did not sneak into the selection either.
        XCTAssertFalse(draft.interests.contains("Photography"))
    }

    /// The order **is** the weighting, so it has to survive an unstar in the middle.
    func testStarOrderIsPreservedAcrossAnUnstar() {
        var draft = PlanDraft()
        for tag in ["Food", "Nightlife", "Shopping"] { draft.toggleStar(tag) }
        draft.toggleStar("Nightlife")
        draft.toggleStar("Relaxation")
        XCTAssertEqual(draft.starredInterests, ["Food", "Shopping", "Relaxation"])
    }

    func testCustomPoisAreTrimmedAndDeduplicated() {
        var draft = PlanDraft()
        draft.addCustomPoi("  Palazzo Piccolomini  ")
        draft.addCustomPoi("Palazzo Piccolomini")
        draft.addCustomPoi("   ")
        XCTAssertEqual(draft.customPois, ["Palazzo Piccolomini"])
    }

    // MARK: - The payload

    /// An untouched optional block is sent as **absent**, not as an empty object.
    ///
    /// `sanitizeLogistics` would collapse an all-empty `logistics` server-side anyway, but
    /// `accessibility` has no such normaliser and its absence genuinely means "nothing was
    /// stated" — which is not the same claim as all-false.
    func testUntouchedOptionalBlocksAreOmitted() {
        let answers = Self.filledBasics().answers
        XCTAssertNil(answers.logistics)
        XCTAssertNil(answers.dietary)
        XCTAssertNil(answers.accessibility)
    }

    func testATouchedOptionalBlockIsSent() {
        var draft = Self.filledBasics()
        draft.logistics.arrivalTime = "14:30"
        draft.accessibility.limitStairs = true
        draft.dietary.tags = ["Vegetarian"]

        let answers = draft.answers
        XCTAssertEqual(answers.logistics?.arrivalTime, "14:30")
        XCTAssertEqual(answers.accessibility?.limitStairs, true)
        XCTAssertEqual(answers.dietary?.tags, ["Vegetarian"])
    }

    /// `groupOther` is free text that only means anything for `.other`, so it must not ride along
    /// on a group that has a name of its own.
    func testGroupOtherIsOnlySentForTheOtherGroup() {
        var draft = Self.filledBasics()
        draft.groupOther = "five college friends"
        draft.group = .couple
        XCTAssertNil(draft.answers.groupOther)

        draft.group = .other
        XCTAssertEqual(draft.answers.groupOther, "five college friends")
    }

    /// `preferences.vibe` is an explicit `null`, matching the web's one call site — the prompt
    /// builder reads the field and nothing has ever populated it.
    func testGenerateRequestCarriesTheDerivedTierAndANullVibe() throws {
        var draft = Self.filledBasics()
        draft.toggleInterest("Food")
        let json = try Self.encoded(draft.generateRequest)

        XCTAssertEqual(json["tier"] as? String, "midrange")
        XCTAssertEqual(json["budget"] as? Double, 2600)
        let preferences = try XCTUnwrap(json["preferences"] as? [String: Any])
        XCTAssertEqual(preferences["tags"] as? [String], ["Food"])
        XCTAssertTrue(preferences["vibe"] is NSNull)
    }

    /// The destination is trimmed on the way out — the field keeps what was typed, the request
    /// does not, and a trailing space has geocoded as a miss before.
    func testDestinationIsTrimmedInTheRequest() throws {
        var draft = Self.filledBasics()
        draft.destination = "  Kyoto, Japan  "
        let json = try Self.encoded(draft.generateRequest)
        XCTAssertEqual(json["destination"] as? String, "Kyoto, Japan")
    }

    /// `dietary` goes in **both** places the server looks: the legacy prompt reads the top-level
    /// field, the staged pipeline reads it inside `userAnswers`, and a food stop the traveler
    /// cannot eat at is the worst defect this app can produce.
    func testDietaryIsSentAtTheTopLevelAndInsideAnswers() throws {
        var draft = Self.filledBasics()
        draft.dietary = DietaryNeeds(tags: ["Halal"], note: "")
        let json = try Self.encoded(draft.generateRequest)

        let top = try XCTUnwrap(json["dietary"] as? [String: Any])
        XCTAssertEqual(top["tags"] as? [String], ["Halal"])
        let answers = try XCTUnwrap(json["userAnswers"] as? [String: Any])
        let nested = try XCTUnwrap(answers["dietary"] as? [String: Any])
        XCTAssertEqual(nested["tags"] as? [String], ["Halal"])
    }

    /// **`status` must be `draft`.** The handler reads `status === "draft" ? "draft" : "saved"`, so
    /// anything else inserts a trip the traveler never chose to keep.
    func testDraftRequestIsAlwaysADraft() throws {
        let itinerary = Itinerary(tier: .midrange, days: [])
        let request = Self.filledBasics().draftRequest(
            itinerary: itinerary, runId: "run-1", sessionId: nil
        )
        let json = try Self.encoded(request)
        XCTAssertEqual(json["status"] as? String, "draft")
        XCTAssertEqual(json["runId"] as? String, "run-1")
        XCTAssertNotNil(json["userAnswers"])
    }

    /// A profile seeds who the traveler is and **nothing about this trip** — a business trip and an
    /// anniversary are the same person, and the budget is a function of the trip.
    func testProfileSeedsTheTravelerButNotTheTrip() {
        let profile = TravelerProfile(
            group: .familyWithKids, explorerStyle: .relaxed, energy: .low, crowds: .avoid,
            priorities: ["Food", "Relaxation"], topPriorities: ["Food"],
            dietary: DietaryNeeds(tags: ["Vegan"], note: "")
        )
        let draft = PlanDraft(profile: profile)

        XCTAssertEqual(draft.group, .familyWithKids)
        XCTAssertEqual(draft.interests, ["Food", "Relaxation"])
        XCTAssertEqual(draft.starredInterests, ["Food"])
        XCTAssertEqual(draft.dietary.tags, ["Vegan"])

        XCTAssertEqual(draft.destination, "")
        XCTAssertEqual(draft.startDate, "")
        XCTAssertEqual(draft.budget, 0)
        XCTAssertEqual(draft.purpose, "")
    }

    private static func encoded<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
    }
}
