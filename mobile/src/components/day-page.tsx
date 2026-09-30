import type { Repair } from '@shared/guardrailFixes';
import { groupStopsByTimeOfDay } from '@shared/timeOfDay';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import type { CostState, DayPlan, Stop } from '@/api/types';
import { PillButton } from '@/components/form';
import { PlacePhoto } from '@/components/place-photo';
import { TravelSegment } from '@/components/travel-segment';
import { SpendBreakdown } from '@/components/spend-breakdown';
import { StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { Colors, PhotoScrim, Radius, Spacing, dayCore } from '@/constants/theme';
import { formatDateline, weatherLine } from '@/lib/dayDisplay';
import { directionsUrl } from '@/lib/directions';
import { EVIDENCE_FOOTNOTE, locationNote } from '@shared/evidence';
import { fixMessage, isBlocking, type Guardrail } from '@/lib/health';
import { formatMoney } from '@/lib/spend';

/**
 * One day of a trip, read as a page.
 *
 * **A day owns its own scroll.** The screen pages horizontally between days, so each day is a
 * column of its own rather than a section of one long list. A plain `ScrollView` over `.map()`
 * rather than a list: a day is four to eight stops, virtualising that is ceremony, and it keeps a
 * vertical scroller from nesting inside the horizontal pager on the same axis.
 */
export function DayPage({
  day,
  dayIndex,
  dayCount,
  destination,
  emphasis,
  onEmphasise,
  onFindNearby,
  findings,
  onToggleLock,
  onSetCost,
  onAsk,
  repairs,
  onRepair,
  offline,
}: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  /** Names the masthead photograph — see DayMasthead for why it is not the day's own stop. */
  destination: string;
  /** Index of the emphasised stop within this day, or null. */
  emphasis: number | null;
  onEmphasise: (index: number | null) => void;
  /** "What else is near this stop" — the anchored replacement for pressing open map. */
  onFindNearby: (stop: Stop) => void;
  /**
   * This day's guardrail findings, in `stops`-array indices.
   *
   * Passed in rather than computed here, and that is the point: the trip screen evaluates the
   * whole plan once and hands each day its slice, so the coral line on a row and the figure in the
   * health panel above it are literally the same object. Two surfaces computing the same verdict
   * separately is how they start disagreeing.
   */
  findings: Guardrail[];
  /** Flip a stop between booked and ordinary. Booked is §0 rank 1 — the plan is re-planned around
   *  it and the server's applier refuses to move it. */
  onToggleLock: (stopIndex: number) => void;
  /** What a stop really cost, and whether that money is committed or gone. */
  onSetCost: (stopIndex: number, cost: number | undefined, state: CostState | undefined) => void;
  /**
   * Serving a copy from disk, so nothing here may be written.
   *
   * Two of the three row actions need the network — "Find nearby" searches Overpass and "Mark
   * booked" writes the plan — and both already fail safely: the search returns nothing and the
   * lock flips and reverts. Safe is not the same as honest, and a control that flips back with
   * no explanation is the failure this states instead.
   *
   * Directions stays live. It is a URL, and a map app is the one thing that still works
   * underground.
   */
  offline: boolean;
  /** Opens the chat composer seeded with text. Never sends it. */
  onAsk: (message: string) => void;
  /** The computed ways out of one finding — see `guardrailFixes`. Empty means Ask is the only
   *  route, which is what the button then does. */
  repairs: (finding: Guardrail) => Repair[];
  onRepair: (days: DayPlan[], label: string) => void;
}) {
  const stops = day.stops ?? [];
  /**
   * The day, cut into Morning / Afternoon / Evening.
   *
   * The grouping is imported rather than written here: it never reorders the day, an untimed stop
   * joins the group in progress, and — the part that matters most — each entry keeps its **index
   * in the day's own `stops` array**, which is the currency `emphasis`, `onEmphasise` and the map
   * camera all speak in. Regrouping with fresh indices would light up the wrong row.
   */
  const groups = groupStopsByTimeOfDay(stops);
  /**
   * A day with one heading is a heading that says nothing — it labels the whole list it sits on.
   * Both the web and the Swift app suppress it on the same test, and a day whose stops carry no
   * readable clock time comes back as a single unlabelled group, so it reads exactly as before.
   */
  const showHeadings = groups.length > 1;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <DayHead day={day} dayIndex={dayIndex} dayCount={dayCount} />

      {/* **No trailing total.** `spend-breakdown` prints `daySpend(day)` at the foot of this
          same screen, and its own note has the argument: a day's total "is a summary of what you
          have just read, so it cannot come before it." That copy also sat directly above the
          first stop, which made it the gold mark competing hardest with the content. */}
      <View style={styles.slot}>
        <SectionRule label="The day" />
      </View>

      {groups.map((group, groupIndex) => (
        <View key={group.label ?? `group-${groupIndex}`}>
          {showHeadings && group.label ? (
            <View style={styles.slot}>
              <SectionRule label={group.label} />
            </View>
          ) : null}
          {group.stops.map((entry, indexInGroup) => (
            <View key={`${entry.stop.name}-${entry.index}`}>
              {/* Only WITHIN a group, never across a heading. A leg spanning Morning to Afternoon
                  is the day's long gap, where the minutes say least, and a segment drawn under a
                  fresh heading reads as belonging to the heading rather than to the two stops. */}
              {indexInGroup > 0 ? (
                <TravelSegment from={group.stops[indexInGroup - 1].stop} to={entry.stop} />
              ) : null}
              <StopRow
                stop={entry.stop}
                // The day's own numbering, not the group's — the stops stay 1..n down the page and
                // keep agreeing with the numbered discs on the map.
                ordinal={entry.index + 1}
                dayIndex={dayIndex}
                expanded={emphasis === entry.index}
                findings={findings.filter((f) => f.stopIndex === entry.index)}
                onPress={() => onEmphasise(emphasis === entry.index ? null : entry.index)}
                onFindNearby={() => onFindNearby(entry.stop)}
                onToggleLock={() => onToggleLock(entry.index)}
                onSetCost={(cost, state) => onSetCost(entry.index, cost, state)}
                onAsk={onAsk}
                repairs={repairs}
                onRepair={onRepair}
                offline={offline}
              />
            </View>
          ))}
        </View>
      ))}

      {day.lodging ? (
        <View style={styles.lodging}>
          <SectionRule label="Stay" />
          <View style={styles.lodgingRow}>
            <View style={styles.grow}>
              <ThemedText type="heading">{day.lodging.name}</ThemedText>
              {day.lodging.note ? (
                <ThemedText type="detail" themeColor="muted">
                  {day.lodging.note}
                </ThemedText>
              ) : null}
            </View>
            <Cost amount={day.lodging.actualCost ?? day.lodging.cost} />
          </View>
        </View>
      ) : null}

      <DayPlate day={day} destination={destination} />

      <SpendBreakdown day={day} dayIndex={dayIndex} />

      {/* **Said once, at the foot, rather than on every stop.** The prose is the planner's on
          essentially every generated stop, so a per-stop disclaimer is a sentence repeated forty
          times and read none — the reason Plan Health's coverage line sits above its findings
          rather than beside each one. What varies stop to stop is the location, and that is
          marked where it varies. */}
      <ThemedText type="micro" themeColor="muted" style={styles.footnote}>
        {EVIDENCE_FOOTNOTE}
      </ThemedText>
    </ScrollView>
  );
}

/**
 * What the day is, in as little height as it can be said in.
 *
 * **The photograph used to be here, and the first stop was the sixth thing on the screen.** The
 * trip chrome above this — title, date range, day chips, List/Map, the budget bar — already
 * runs to about 264pt on a 402pt device. A 16:9 full-bleed picture adds 226 more, and the
 * introduction another 70, so on the screen this app is read on in a street the first stop
 * arrived at roughly 600pt of an 874pt display: visible, barely, and only if nothing above it
 * wrapped. Three separate reviewers reported the day screen as chrome-first. It was.
 *
 * So the picture goes to the foot (`DayPlate`) and what stays is the part that is *operational*:
 * which day of how many, what the day is for, and the weather, which decides what you put on
 * before you leave. The date itself does not stay — the day chips directly above this carry it,
 * and `22 THU` under `OCT 22 – 28` is the same fact twice. That is the argument `Today`'s header
 * already makes about the clock.
 *
 * The weather comes out of its slate badge and becomes ordinary muted text, because the badge
 * existed to survive a photograph and there is no longer one under it.
 */
function DayHead({ day, dayIndex, dayCount }: { day: DayPlan; dayIndex: number; dayCount: number }) {
  const weather = weatherLine(day);
  return (
    <View style={styles.head}>
      <View style={styles.headLine}>
        <ThemedText type="label" themeColor="muted">
          {`Day ${dayIndex + 1} of ${dayCount}`}
        </ThemedText>
        {weather ? (
          <ThemedText type="detail" themeColor="muted" numberOfLines={1} style={styles.headWeather}>
            {weather}
          </ThemedText>
        ) : null}
      </View>

      {day.theme ? <ThemedText type="title">{day.theme}</ThemedText> : null}

      {day.summary ? (
        <ThemedText type="detail" themeColor="muted">
          {day.summary}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * The day's photograph, as a closing plate rather than a masthead.
 *
 * Only large type and tracked caps ride the picture — the Photograph-Is-Not-A-Surface rule, and
 * the dateline it carries is exactly that. It sits after the last thing you *do* with the day
 * and before the money, which is where atmosphere can be spent without costing anything: the
 * reader who came here to find their next stop has already found it.
 *
 * A band, not a frame: 21:9 rather than 16:9, so it closes the day rather than restating it at
 * the weight a masthead has.
 *
 * **The photograph is the destination's, and a per-day one was tried and measured away.** Paging
 * days made the repeated picture look inert — swipe, and the largest thing on screen does not
 * move — so it was switched to the day's first stop. Then the hit rate was measured across every
 * saved trip: **2 of 14 days**. Not close, and not random. The model names stops the way a person
 * would say them rather than the way an encyclopaedia titles them ("Fushimi Inari" against
 * "Fushimi Inari-taisha"), and a day's first stop is very often transit or a meal — "Tram 15E to
 * Belém", "Breakfast at Manteigaria" — which will never have an article. Widening to *any* stop
 * in the day scored identically: 12 of 14 days have no photograph for any stop they name.
 *
 * So the destination photograph stays, because it is the one that actually resolves. What changes
 * on a swipe is the dateline, and every row above it.
 */
function DayPlate({ day, destination }: { day: DayPlan; destination: string }) {
  return (
    <PlacePhoto
      name={destination}
      aspectRatio={21 / 9}
      // Square, because it touches both screen edges — a radius only reads as a corner when
      // there is page beside it to be a corner against.
      radius={0}
      scrim={PhotoScrim}
      style={styles.plate}>
      <View style={styles.dateline}>
        <ThemedText type="display" numberOfLines={2}>
          {formatDateline(day.date)}
        </ThemedText>
        {day.title ? (
          <ThemedText type="detail" style={styles.datelineTitle}>
            {day.title}
          </ThemedText>
        ) : null}
      </View>
    </PlacePhoto>
  );
}

/** A stop is a row, never a card. The system draws rules rather than boxing things. */
function StopRow({
  stop,
  ordinal,
  dayIndex,
  expanded,
  findings,
  onPress,
  onFindNearby,
  onToggleLock,
  onSetCost,
  onAsk,
  repairs,
  onRepair,
  offline,
}: {
  stop: Stop;
  ordinal: number;
  dayIndex: number;
  expanded: boolean;
  /** This stop's own findings — already filtered to `stopIndex`. */
  findings: Guardrail[];
  repairs: (finding: Guardrail) => Repair[];
  onRepair: (days: DayPlan[], label: string) => void;
  onPress: () => void;
  onFindNearby: () => void;
  onToggleLock: () => void;
  onSetCost: (cost: number | undefined, state: CostState | undefined) => void;
  onAsk: (message: string) => void;
  /** Serving a copy from disk — see the outer prop. */
  offline: boolean;
}) {
  const booked = stop.timeFlexibility === 'FIXED';
  const where = locationNote(stop.located);
  // `category` is stored lowercase ('food', 'entry') and was capitalised by the label step's
  // `textTransform`. Sentence case has to do it in the string, or the row reads "· food".
  const particulars = [stop.time, stop.durationLabel, sentence(stop.category)]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('  ·  ');
  const blocked = findings.some(isBlocking);

  return (
    <Pressable
      onPress={onPress}
      // Blocked last, so it wins over the emphasis wash. Expanding a row is something you did;
      // the day not working is something that is true whether or not you are looking at it.
      style={[
        styles.stop,
        expanded && styles.stopExpanded,
        blocked && styles.stopBlocked,
      ]}
      android_ripple={{ color: Colors.pressed }}>
      <StopDisc ordinal={ordinal} color={dayCore(dayIndex)} />

      <View style={styles.grow}>
        <View style={styles.stopHead}>
          <ThemedText type="heading" style={styles.grow}>
            {stop.name}
          </ThemedText>
          <Cost amount={stop.actualCost ?? stop.cost} />
        </View>

        <View style={styles.particularsRow}>
          {particulars ? (
            <ThemedText type="detail" themeColor="muted">
              {particulars}
            </ThemedText>
          ) : null}
          {/* A word, not a glyph. `plan/_layout.tsx` records that a bare SF symbol name renders
              nothing at all on Android, and a padlock drawn two ways is a second thing to keep in
              step for no gain — "Booked" also scales with Dynamic Type and reads to a screen
              reader without a label of its own. */}
          {booked ? (
            <ThemedText type="detail" themeColor="foreground">
              Booked
            </ThemedText>
          ) : null}
        </View>

        {/* Where it occurs, not only in the panel above. A conflict read beside the stop it
            concerns is a decision; the same sentence in a list elsewhere is a chore. Shown
            collapsed as well as expanded — a problem nobody has tapped into is still a problem. */}
        {findings.map((finding, i) => (
          <Finding
            key={`${finding.message}-${i}`}
            finding={finding}
            repairs={repairs(finding)}
            onRepair={onRepair}
            onAsk={onAsk}
          />
        ))}

        {expanded ? (
          <View style={styles.expanded}>
            {stop.why ? <ThemedText type="detail">{stop.why}</ThemedText> : null}
            {stop.note ? (
              <ThemedText type="detail" themeColor="muted">
                {stop.note}
              </ThemedText>
            ) : null}

            {/* **What the pin is standing on.** The rest of this row is prose either way; the
                coordinate is the one thing that was sometimes checked against a real listing and
                sometimes not, and the reader cannot tell by looking. Only on the expanded stop —
                a badge per row would put a caveat on a list somebody is scanning. Nothing at all
                on a plan saved before this was recorded, because "estimated" would claim a check
                failed when none ran. */}
            {where ? (
              <ThemedText type="caption" themeColor="muted">
                {where.value}
              </ThemedText>
            ) : null}

            {/* What you can do about a stop, on the stop. "Near here" lives here rather than on
                the map because a tap on open map points at nothing — a stop is a referent you
                chose, and it carries the day and the arrival time with it. */}
            <View style={styles.actions}>
              <PillButton
                compact
                role="link"
                title="Directions"
                accessibilityLabel={`Directions to ${stop.name}`}
                onPress={() => Linking.openURL(directionsUrl(stop)).catch(() => {})}
              />
              <PillButton compact title="Find nearby" disabled={offline} onPress={onFindNearby} />
              {/* The traveler's own §0 rank 1. Marking a stop booked is what stops the planner
                  moving it on the next edit, and unlocking is deliberately only available here:
                  a patch op that could clear the flag could clear it and move the stop in the
                  same turn, which is the lock not existing.

                  **Booked tints the capsule.** The only thing separating the two states was the
                  verb, so the lock a traveller set read at a glance as another thing to press.
                  `accentWash` is the same jade-at-9% this file already uses for the expanded
                  row and the selected cost kind — a state, not a new colour. */}
              <PillButton
                compact
                title={booked ? 'Unlock' : 'Mark booked'}
                disabled={offline}
                onPress={onToggleLock}
                style={booked ? styles.bookedPill : undefined}
              />
            </View>

            {/* **The second money state was unreachable from the phone.** `actualCost` has existed
                on the type and in the web client for as long as the budget bar has coalesced it,
                and nothing here could write one — so every figure on every mobile screen was the
                planner's estimate wearing whichever label the code guessed. This is the field
                that makes the distinction real. The kind is optional: an amount with no kind is
                already a state the model supports, and demanding a classification before
                accepting a number would stop people entering the number. */}
            <CostEntry
              cost={stop.actualCost}
              state={stop.costState}
              disabled={offline}
              onChange={onSetCost}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * What a stop really cost, and which kind of real that is.
 *
 * Committed on blur rather than per keystroke: every change is a write to the server through
 * `updateTripItinerary`, and a request per digit would be four requests to enter "35".
 *
 * **Clearing the field is a real action**, distinct from typing zero. Empty removes the figure
 * and puts the stop back to the planner's estimate; `0` says it turned out to be free, and
 * `spendSplit` counts it as settled money of zero. Both are answers somebody means.
 */
function CostEntry({
  cost,
  state,
  disabled,
  onChange,
}: {
  cost?: number;
  state?: CostState;
  disabled: boolean;
  onChange: (cost: number | undefined, state: CostState | undefined) => void;
}) {
  const [draft, setDraft] = useState(cost == null ? '' : String(cost));

  function commit(text: string) {
    const trimmed = text.trim();
    if (trimmed === '') return onChange(undefined, undefined);
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return setDraft(cost == null ? '' : String(cost));
    onChange(value, state);
  }

  return (
    <View style={styles.costRow}>
      <ThemedText type="label" themeColor="muted">
        What it cost
      </ThemedText>
      <View style={styles.costField}>
        <ThemedText type="money" themeColor="muted">
          $
        </ThemedText>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={() => commit(draft)}
          editable={!disabled}
          keyboardType="decimal-pad"
          returnKeyType="done"
          placeholder="—"
          placeholderTextColor={Colors.muted}
          selectionColor={Colors.accent}
          maxFontSizeMultiplier={1.6}
          accessibilityLabel="What this stop actually cost"
          style={styles.costInput}
        />
      </View>
      {/* Only once there is a figure to describe. An empty row offering to classify nothing is a
          question about a number nobody has entered. */}
      {cost != null ? (
        <View style={styles.costKinds}>
          {(['booked', 'spent'] as const).map((kind) => (
            <Pressable
              key={kind}
              onPress={() => onChange(cost, state === kind ? undefined : kind)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: state === kind, disabled }}
              style={[styles.costKind, state === kind && styles.costKindOn]}>
              <ThemedText type="caption" themeColor={state === kind ? 'accent' : 'muted'}>
                {kind === 'booked' ? 'Booked' : 'Paid'}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A label against a rule, which is how this system opens a section. */
/**
 * A conflict, and the ways out of it.
 *
 * **"Fix this" used to spend a model call on arithmetic.** It seeded the chat composer and
 * waited a minute to be told what a subtraction already knew: the hop needs more minutes than
 * the gap leaves it, and there are two places to find them. `repairsFor` computes those two,
 * and a tap applies one.
 *
 * The label is the preview. "Push Castle back 10 min, to 2:15 PM" says exactly what happens,
 * the change is one clock time, and Undo sits on the bar above — a confirmation step between
 * those is the ceremony this app already declined for adding a stop.
 *
 * Where nothing can be computed — a weather risk, a leg booked at both ends — the button does
 * what it always did and hands the problem to Ask, which is the right route for anything
 * needing a judgement about places rather than about minutes.
 */
function Finding({
  finding,
  repairs,
  onRepair,
  onAsk,
}: {
  finding: Guardrail;
  repairs: Repair[];
  onRepair: (days: DayPlan[], label: string) => void;
  onAsk: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      {/* **The whole row is the target, not the verb at the end of it.** A capsule here would
          be a third shape in a column that already has the stop row and the repair options, and
          `Fix this` on its own was a 36pt target at the right margin. The finding and the way
          out of it are one thing to press — the same treatment `styles.repair` gives the
          options this opens, so pressing a finding and pressing a fix feel like one gesture. */}
      <Pressable
        onPress={() => (repairs.length > 0 ? setOpen((was) => !was) : onAsk(fixMessage(finding)))}
        accessibilityRole="button"
        accessibilityState={repairs.length > 0 ? { expanded: open } : undefined}
        accessibilityLabel={
          repairs.length > 0
            ? `Ways to fix: ${finding.message}`
            : `Ask TripMate to fix: ${finding.message}`
        }
        style={({ pressed }) => [styles.finding, pressed && styles.repairPressed]}>
        <ThemedText
          type="detail"
          themeColor={isBlocking(finding) ? 'alert' : 'muted'}
          style={styles.grow}>
          {finding.message}
        </ThemedText>
        <ThemedText type="detail" themeColor="accent" style={styles.firm}>
          {open ? 'Close' : 'Fix this'}
        </ThemedText>
      </Pressable>

      {open ? (
        <View style={styles.repairs}>
          {repairs.map((repair) => (
            <Pressable
              key={repair.label}
              onPress={() => {
                setOpen(false);
                onRepair(repair.next.days as DayPlan[], repair.label);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.repair, pressed && styles.repairPressed]}>
              <ThemedText type="detail">{repair.label}</ThemedText>
            </Pressable>
          ))}
          {/* Stated rather than implied. The promise that marking something booked keeps it
              still is worth restating at the moment somebody is choosing between two moves. */}
          <ThemedText type="micro" themeColor="muted" style={styles.repairNote}>
            Nothing booked will move.
          </ThemedText>
          {/* One more option in the same shape, because that is what it is: the way out when
              none of the computed moves is the one you wanted. */}
          <Pressable
            onPress={() => onAsk(fixMessage(finding))}
            accessibilityRole="button"
            style={({ pressed }) => [styles.repair, pressed && styles.repairPressed]}>
            <ThemedText type="detail" themeColor="accent">
              Ask for something else
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SectionRule({ label, trailing }: { label: string; trailing?: string }) {
  return (
    <View style={styles.sectionRule}>
      <ThemedText type="label" themeColor="muted">
        {label}
      </ThemedText>
      <View style={styles.rule} />
      {trailing ? (
        <ThemedText type="money" themeColor="money">
          {trailing}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Gold counts. A zero is not a money fact, so it goes muted rather than borrowing the colour. */
/**
 * A figure on a row, which must be the figure the totals are counting.
 *
 * Both call sites pass `actualCost ?? cost`, the same coalesce `spendOf` makes in the shared
 * money module. They passed `cost` until entering a real one became possible on this client —
 * at which point the row said $25 while the day above it said $31, which is the three-summations
 * disagreement `spend.ts` was written to end, resurfacing one layer up.
 */
function Cost({ amount }: { amount: number }) {
  if (!amount) return null;
  return (
    <ThemedText type="money" themeColor="money">
      {formatMoney(amount)}
    </ThemedText>
  );
}

/** First letter up, rest untouched — the categories are single lowercase words. */
function sentence(word: string | undefined): string | undefined {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

const styles = StyleSheet.create({
  content: { paddingBottom: Spacing.regular * 2 },
  footnote: { paddingHorizontal: Spacing.read, paddingTop: Spacing.rows },

  head: { paddingHorizontal: Spacing.read, paddingTop: Spacing.read, gap: Spacing.hair },
  // The overline and the weather share a line: they are the two facts you check before leaving,
  // and stacked they were two more rows above the list this pass exists to raise.
  headLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  // Truncates rather than wrapping — a long fallback must not push the day's name down.
  headWeather: { flex: 1, textAlign: 'right' },
  /**
   * **No gutter of its own — the photograph is the one thing here that spans the device.**
   * A frame inset 16pt each side and rounded is a picture *on* a page; edge to edge it is the
   * page. Everything else on this screen keeps the gutter, so the inset still exists where it
   * does work: holding a measure for reading.
   */
  plate: { justifyContent: 'flex-end', marginTop: Spacing.compact },
  /**
   * The page's gutter, not the picture's.
   *
   * This was `Spacing.rows` (12) while the photograph was inset 16 — so the dateline sat 28pt
   * from the screen and read as type inside a frame. Full-bleed there is no frame, and 12 against
   * the 16 the prose directly below uses is a four-point stagger on the same edge. Everything on
   * this screen now starts on one line; the weather badge takes the same value for the same
   * reason.
   */
  dateline: { padding: Spacing.read, gap: Spacing.hair },
  datelineTitle: { opacity: 0.8 },

  sectionRule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginTop: Spacing.compact,
    marginBottom: Spacing.hair,
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.cardBorder },

  /** `SectionRule` carries no inset of its own — it inherits one from whichever block holds it
   *  (the masthead, the stay). A time-of-day heading sits at the page's top level, so it brings
   *  its own. */
  slot: { paddingHorizontal: Spacing.read },

  /**
   * **No divider between rows, and this is the third hairline on this screen to go.**
   *
   * It was a `borderTopWidth` on this padded box, so it drew from 0.00pt to 401.67pt — the full
   * device — while the `SectionRule` headings beside it run 17.67–385.67 and every word it
   * separated is inset 16. A rule spanning more than the content it divides reads as a seam in
   * the page rather than a break in a list, which is what kept getting reported.
   *
   * Insetting it to 16 was the other option and it is the wrong one here: a stop is already a
   * numbered disc, a bold name and a muted meta line, with the leg between it and the last one
   * saying "walk, about 7 min". The order is legible four ways over; a line is a fifth that only
   * adds weight. The group headings stay, because those mark a real division — morning from
   * afternoon — rather than repeating one the list already shows.
   *
   * Vertical space does the separating: 12pt below one row, the leg, 12pt above the next.
   */
  stop: {
    flexDirection: 'row',
    gap: 13,
    paddingVertical: Spacing.rows,
    paddingHorizontal: Spacing.read,
    alignItems: 'flex-start',
  },
  stopExpanded: { backgroundColor: Colors.accentWash },
  stopBlocked: { backgroundColor: Colors.alertSoft },
  particularsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: Spacing.tight,
    marginTop: 3,
  },
  // No indent of its own: this sits inside the stop's content column, which is already inset,
  // and the options belong under the sentence they answer rather than stepped away from it.
  repairs: { marginTop: Spacing.tight, gap: Spacing.hair },
  repair: {
    // 44, the HIG minimum. It shipped at 40 — close enough to look right and not to be one.
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.hair,
    borderRadius: Radius.read,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  repairPressed: { backgroundColor: Colors.pressed },
  repairNote: { paddingHorizontal: Spacing.rows, marginTop: Spacing.hair },
  // A row-shaped pressable, so it takes the surface radius rather than the pill: a full pill on
  // a box this wide renders as a lozenge. Same material as the repair options it opens.
  finding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    marginTop: Spacing.hair,
    minHeight: 44,
    paddingHorizontal: Spacing.rows,
    paddingVertical: Spacing.hair,
    borderRadius: Radius.read,
    backgroundColor: Colors.surfaceDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  firm: { flexShrink: 0 },
  bookedPill: { backgroundColor: Colors.accentWash },
  stopHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  grow: { flex: 1 },
  expanded: { marginTop: Spacing.tight, gap: Spacing.hair },
  // Wraps: three capsules fit across at Default and go 2+1 by the 1.6x cap rather than
  // truncating. `tight` between them, since a capsule carries its own edge.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.tight,
    marginTop: Spacing.tight,
  },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight, marginTop: Spacing.tight },
  costField: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  costInput: { color: Colors.foreground, minWidth: 56, paddingVertical: 4, fontSize: 15 },
  costKinds: { flexDirection: 'row', gap: Spacing.hair },
  costKind: {
    paddingHorizontal: Spacing.tight,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.control,
  },
  // Jade at 9% plus the jade word, which is how selection reads everywhere else here.
  costKindOn: { backgroundColor: Colors.accentWash },

  lodging: { paddingHorizontal: Spacing.read },
  lodgingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.tight,
    paddingVertical: Spacing.rows,
  },
});
