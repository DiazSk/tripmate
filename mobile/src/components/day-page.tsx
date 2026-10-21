import type { Repair } from '@shared/guardrailFixes';
import { groupStopsByTimeOfDay } from '@shared/timeOfDay';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DayPlan, Stop } from '@/api/types';
import { MoneyBand } from '@/components/budget-sheet';
import { PlacePhoto } from '@/components/place-photo';
import { TravelSegment } from '@/components/travel-segment';
import { DISC_SIZE, StopDisc } from '@/components/stop-disc';
import { ThemedText } from '@/components/themed-text';
import { Colors, PhotoScrim, Radius, Spacing, dayCore } from '@/constants/theme';
import { dayLine, stopParticulars } from '@/lib/dayDisplay';
import { directionsUrl } from '@/lib/directions';
import { evidenceTags } from '@/lib/provenance';
import { locationNote } from '@shared/evidence';
import { fixMessage, isBlocking, type Guardrail } from '@/lib/health';
import { SURENESS_LABEL, anyActualSpend, daySpend, formatMoney, spendShares, surenessOf, type Sureness } from '@/lib/spend';
import { emptyDayFindings } from '@/lib/importNotes';
import type { ProposalRow } from '@/lib/proposalRows';

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
  onSetCost,
  onAsk,
  repairs,
  onRepair,
  onBudget,
  footer,
  offline,
  preview,
  shelf,
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
  /**
   * What a stop really cost, and how sure that is. Booked and Paid also lock the stop — §0 rank 1,
   * re-planned around and never moved by the server's applier — and Estimate releases it. See
   * `surenessFields`: the lock and the cost's state are one control now, not two.
   */
  onSetCost: (stopIndex: number, cost: number | undefined, sureness: Sureness) => void;
  /** Opens the Budget sheet on this day. */
  onBudget: () => void;
  /** How much of the foot the floating toolbar covers, so the last section scrolls clear of it. */
  footer: number;
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
  /**
   * A proposal from the chat, drawn on this day: the proposed stops marked with what the edit does
   * to them, and a ghost for each stop that leaves. Read-only while it is up — nothing here has
   * changed yet, and a cost edited on a row that might be about to move is a second edit.
   */
  preview?: { rows: ProposalRow[]; dayName: (index: number) => string } | null;
  /** A fact about the whole trip that sits under the day's hero — the draft's Keep shelf. */
  shelf?: ReactNode;
}) {
  const stops = day.stops ?? [];
  const scroller = useRef<ScrollView>(null);
  /** Where the preview list starts in the scroll, so its first change can be brought into view. */
  const listY = useRef(0);
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
    <ScrollView
      ref={scroller}
      contentContainerStyle={[styles.content, { paddingBottom: footer + Spacing.regular }]}
      showsVerticalScrollIndicator={false}>
      <DayHead day={day} dayIndex={dayIndex} dayCount={dayCount} destination={destination} />
      {shelf}

      {preview ? (
        <View style={styles.section} onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
          <SectionRule label="Preview · nothing has changed yet" />
          <ProposalList
            rows={preview.rows}
            dayIndex={dayIndex}
            dayName={preview.dayName}
            // The first change, under the day strip rather than under the reply card at the foot.
            onFirstChange={(y) => scroller.current?.scrollTo({ y: Math.max(0, listY.current + y - Spacing.regular), animated: true })}
          />
        </View>
      ) : (
      <View style={styles.section}>
        <SectionRule label={`The day · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`} />

        {/* An empty day has no rows for a finding to sit on, so its own "Fix this" goes here — the
            same `Finding`, which with no repairs opens chat pre-filled. See `emptyDayFindings`. */}
        {emptyDayFindings(day, findings).map((finding) => (
          <Finding key={finding.message} finding={finding} repairs={[]} onRepair={onRepair} onAsk={onAsk} />
        ))}

        {groups.map((group, groupIndex) => (
          <View key={group.label ?? `group-${groupIndex}`}>
            {showHeadings && group.label ? <Eyebrow label={group.label} /> : null}
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
                  onSetCost={(cost, sureness) => onSetCost(entry.index, cost, sureness)}
                  onAsk={onAsk}
                  repairs={repairs}
                  onRepair={onRepair}
                  offline={offline}
                />
              </View>
            ))}
          </View>
        ))}
      </View>
      )}

      {day.lodging ? (
        <View style={[styles.section, styles.stay]}>
          <View style={styles.stayIcon}>
            <Glyph name={{ ios: 'bed.double', android: 'bed' }} size={17} color={Colors.foreground} />
          </View>
          <View style={styles.grow}>
            <ThemedText type="label" themeColor="muted">
              Tonight
            </ThemedText>
            <ThemedText type="heading">{day.lodging.name}</ThemedText>
            {day.lodging.note ? (
              <ThemedText type="detail" themeColor="muted">
                {day.lodging.note}
              </ThemedText>
            ) : null}
          </View>
          <Cost amount={day.lodging.actualCost ?? day.lodging.cost} />
        </View>
      ) : null}

      <DayTotal day={day} dayIndex={dayIndex} onOpen={onBudget} />
    </ScrollView>
  );
}

/**
 * The day's name over the destination's photograph, then what the day is for.
 *
 * **The photograph was moved to the foot once, for a measured reason, and comes back with that
 * reason gone.** The trip chrome above this used to run title, dates, day chips, a List/Map · Play ·
 * Ask · + row and a budget bar, and a 16:9 picture under all of that put the first stop at about
 * 600pt of an 874pt display. The action row and the budget bar have since left the top for the
 * floating toolbar, which returns roughly the height a 21:9 band takes — and the day's name, which
 * used to be a separate line, rides the picture instead of sitting under it. So the band costs the
 * list nothing it did not already spend, and the photograph is where it says where you are.
 *
 * **The photograph is the destination's, and a per-day one was tried and measured away**: across
 * every saved trip only 2 of 14 days had a picture for any stop they name (the model says
 * "Fushimi Inari", the encyclopaedia says "Fushimi Inari-taisha", and a first stop is often a
 * tram). What changes on a swipe is the day's name over it, and every row below.
 *
 * Only large type rides the picture — the Photograph-Is-Not-A-Surface rule. The weather is short
 * enough to join the overline; the summary is reading, so it sits on the night beneath.
 */
function DayHead({
  day,
  dayIndex,
  dayCount,
  destination,
}: {
  day: DayPlan;
  dayIndex: number;
  dayCount: number;
  destination: string;
}) {
  return (
    <>
      <PlacePhoto
        name={destination}
        aspectRatio={21 / 9}
        // Square, because it touches both screen edges — a radius only reads as a corner when
        // there is page beside it to be a corner against.
        radius={0}
        scrim={PhotoScrim}
        style={styles.band}>
        <View style={styles.bandText}>
          {day.theme || day.title ? (
            <ThemedText type="display" themeColor="onDeep" numberOfLines={2}>
              {day.theme || day.title}
            </ThemedText>
          ) : null}
          <ThemedText type="detail" themeColor="onDeep" numberOfLines={1} style={styles.bandLine}>
            {dayLine(day, dayIndex, dayCount)}
          </ThemedText>
        </View>
      </PlacePhoto>
      {day.summary ? (
        <ThemedText type="body" themeColor="muted" style={styles.summary}>
          {day.summary}
        </ThemedText>
      ) : null}
    </>
  );
}

/**
 * The day's money in one line, and the way into the rest of it.
 *
 * The full breakdown used to close every page; it now lives in the Budget sheet, beside the
 * trip's, so this is the total, the band, and a tap.
 */
function DayTotal({ day, dayIndex, onOpen }: { day: DayPlan; dayIndex: number; onOpen: () => void }) {
  const total = daySpend(day);
  if (!(total > 0)) return null;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Day ${dayIndex + 1} costs ${formatMoney(total)}. Open the breakdown.`}
      style={({ pressed }) => [styles.section, styles.total, pressed && styles.pressed]}>
      <ThemedText type="label" themeColor="muted">
        {`Day ${dayIndex + 1} · ${anyActualSpend([day]) ? 'confirmed' : 'projected'}`}
      </ThemedText>
      <View style={styles.totalRow}>
        <ThemedText type="moneyLarge" style={[styles.grow, styles.figure]}>
          {formatMoney(total)}
        </ThemedText>
        <View style={styles.sure}>
          <ThemedText type="detail" themeColor="muted">
            Breakdown
          </ThemedText>
          <Glyph name={{ ios: 'chevron.right', android: 'chevron_right' }} size={11} color={Colors.muted} />
        </View>
      </View>
      <MoneyBand shares={spendShares(day)} />
    </Pressable>
  );
}

function Glyph({ name, size, color }: { name: SymbolViewProps['name']; size: number; color: string }) {
  return <SymbolView name={name} size={size} tintColor={color} />;
}

/**
 * The day as the proposal would leave it.
 *
 * Changed rows carry the accent's wash and an edge, which is the one place orange is spent on the
 * day: it marks what the decision at the thumb is about. A stop that leaves stays where it was,
 * struck through and dimmed, with where it is going; a stop that only changes time keeps its row
 * and shows the old time crossed out beside the new one.
 */
function ProposalList({
  rows,
  dayIndex,
  dayName,
  onFirstChange,
}: {
  rows: ProposalRow[];
  dayIndex: number;
  dayName: (index: number) => string;
  onFirstChange: (y: number) => void;
}) {
  const first = rows.findIndex((row) => row.kind !== 'same');
  const isGhost = (row: ProposalRow) => row.kind === 'leaving' || row.kind === 'removed';
  // The disc numbers count the stops the day would have, so a ghost takes no number of its own.
  const ordinals = rows.map((_, i) => rows.slice(0, i + 1).filter((row) => !isGhost(row)).length);
  return (
    <View>
      {rows.map((row, i) => {
        const ghost = isGhost(row);
        const { stop } = row;
        const line =
          row.kind === 'leaving'
            ? `To ${dayName(row.toDay)}, ${row.toTime}`
            : row.kind === 'removed'
              ? 'Dropped from the day'
              : row.kind === 'arriving'
                ? `From ${dayName(row.fromDay)}, was ${row.was}`
                : row.kind === 'added'
                  ? 'New'
                  : row.kind === 'retimed'
                    ? // The time is already on the line, struck and new; the rest of the particulars follow it.
                      stopParticulars({ ...stop, time: undefined })
                    : [stopParticulars(stop), surenessOf(stop) !== 'estimate' ? SURENESS_LABEL[surenessOf(stop)] : null]
                        .filter(Boolean)
                        .join('  ·  ');
        return (
          <View
            key={`${row.kind}-${stop.name}-${i}`}
            onLayout={i === first ? (e) => onFirstChange(e.nativeEvent.layout.y) : undefined}
            // A stop that leaves is not what the decision adds to this day, so it is dimmed rather than lit.
            style={[styles.stop, ghost ? styles.ghost : row.kind !== 'same' && styles.changed]}
            accessibilityLabel={`${stop.name}. ${row.kind === 'same' ? '' : `${row.kind}. `}${line}`}>
            {ghost ? <View style={styles.ghostDisc} /> : <StopDisc ordinal={ordinals[i]} color={dayCore(dayIndex)} />}
            <View style={styles.grow}>
              <ThemedText type="heading" style={ghost && styles.struck}>
                {stop.name}
              </ThemedText>
              {row.kind === 'same' ? null : (
                <Text>
                  {row.kind === 'retimed' ? (
                    <ThemedText type="detail" themeColor="muted" style={styles.struck}>
                      {`${row.was}  `}
                    </ThemedText>
                  ) : null}
                  {row.kind === 'retimed' || row.kind === 'arriving' || row.kind === 'added' ? (
                    <ThemedText type="detail" style={styles.strong}>
                      {`${stop.time}  ·  `}
                    </ThemedText>
                  ) : null}
                  <ThemedText type="detail" themeColor={row.kind === 'added' ? 'accentText' : ghost ? 'foreground' : 'muted'}>
                    {line}
                  </ThemedText>
                </Text>
              )}
              {row.kind === 'same' && line ? (
                <ThemedText type="detail" themeColor="muted">
                  {line}
                </ThemedText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
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
  onSetCost: (cost: number | undefined, sureness: Sureness) => void;
  onAsk: (message: string) => void;
  /** Serving a copy from disk — see the outer prop. */
  offline: boolean;
}) {
  const sureness = surenessOf(stop);
  const where = locationNote(stop.located);
  // `Description:` rather than the field's own name, because the reader has just read a
  // sentence, not a `note`. Joined on one line: two grey qualifiers stacked read as a block of
  // caveats, and side by side they read as a footer.
  const tags = evidenceTags(stop);
  const provenance = [
    tags.detail ? `Description: ${tags.detail}` : null,
    tags.cost ? `Cost: ${tags.cost}` : null,
  ].filter(Boolean);
  // Shared with the map's stop card — see `stopParticulars`.
  const particulars = stopParticulars(stop);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.stop, expanded && styles.stopExpanded]}
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
          {/* A word, not only a glyph: a padlock alone reads to nobody with a screen reader, and
              "Booked" or "Paid" scales with Dynamic Type. The lock beside it says what the word
              now also means — the planner will not move this stop. */}
          {sureness !== 'estimate' ? (
            <View style={styles.sure}>
              <Glyph name={{ ios: 'lock.fill', android: 'lock' }} size={10} color={Colors.muted} />
              <ThemedText type="detail" themeColor="muted">
                {SURENESS_LABEL[sureness]}
              </ThemedText>
            </View>
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
            {/* What the stop is, first and at reading size: it is the reason the row was opened.
                The planner's note and the evidence step down beneath it. */}
            {stop.why ? <ThemedText type="body">{stop.why}</ThemedText> : null}
            {stop.note ? (
              <ThemedText type="detail" themeColor="muted">
                {stop.note}
              </ThemedText>
            ) : null}

            {/* **What this stop is standing on, as a footer rather than a badge per line.** Only on
                the expanded stop, and nothing at all where a plan predates the recording, because
                "estimated" would claim a check failed when none ran. `stopEvidence` decides it. */}
            {where || provenance.length > 0 ? (
              <ThemedText type="caption" themeColor="muted">
                {[where?.value, ...provenance].filter(Boolean).join('  ·  ')}
              </ThemedText>
            ) : null}

            {/* **Three equal tiles in one row, icon over label**, the way Maps lays out a place.
                They were three capsules that wrapped to two lines and a fourth control for the
                lock; the lock is the cost's state now (below), and Ask is here because a question
                about this one stop is the commonest reason to open it. Directions stays live
                offline — it is a URL, and a map app is the one thing that still works
                underground — and keeps the orange, being the thing you do with a stop. */}
            <View style={styles.tiles}>
              <Tile
                label="Directions"
                accessibilityLabel={`Directions to ${stop.name}`}
                icon={{ ios: 'location.north.fill', android: 'navigation' }}
                primary
                onPress={() => Linking.openURL(directionsUrl(stop)).catch(() => {})}
              />
              <Tile label="Nearby" icon={{ ios: 'magnifyingglass', android: 'search' }} disabled={offline} onPress={onFindNearby} />
              <Tile
                label="Ask"
                accessibilityLabel={`Ask about ${stop.name}`}
                icon={{ ios: 'sparkles', android: 'auto_awesome' }}
                disabled={offline}
                onPress={() => onAsk(`${stop.name}: `)}
              />
            </View>

            <CostLine stop={stop} sureness={sureness} disabled={offline} onChange={onSetCost} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * What a stop costs and how sure that is, as one line that opens to its editor.
 *
 * Closed, it is the figure and its state — "Cost $12 · Booked" — because that is all a list being
 * scanned needs. Open, the amount and Estimate / Booked / Paid. Choosing Booked or Paid also locks
 * the stop, which is what "Mark booked" used to do from a fourth button; the two were one fact.
 *
 * The amount commits on blur rather than per keystroke: every change is a whole-plan write, and a
 * request per digit would be four requests to enter "35". **Clearing it is a real action**,
 * distinct from typing zero: empty puts the planner's estimate back, `0` says it turned out free.
 */
function CostLine({
  stop,
  sureness,
  disabled,
  onChange,
}: {
  stop: Stop;
  sureness: Sureness;
  disabled: boolean;
  onChange: (cost: number | undefined, sureness: Sureness) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(stop.actualCost == null ? '' : String(stop.actualCost));
  const shown = stop.actualCost ?? stop.cost;

  function commit(text: string) {
    const trimmed = text.trim();
    if (trimmed === '') return onChange(undefined, sureness);
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return setDraft(stop.actualCost == null ? '' : String(stop.actualCost));
    onChange(value, sureness);
  }

  return (
    <View style={styles.cost}>
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Cost ${shown ? formatMoney(shown) : 'free'}, ${SURENESS_LABEL[sureness]}. ${open ? 'Close' : 'Change'}.`}
        style={({ pressed }) => [styles.costLine, pressed && styles.pressed]}>
        <ThemedText type="detail" themeColor="muted">
          Cost
        </ThemedText>
        <ThemedText type="money" themeColor="money" style={styles.grow}>
          {shown ? formatMoney(shown) : 'Free'}
        </ThemedText>
        <View style={styles.sure}>
          {sureness === 'estimate' ? null : <Glyph name={{ ios: 'lock.fill', android: 'lock' }} size={10} color={Colors.foreground} />}
          <ThemedText type="detail" themeColor={sureness === 'estimate' ? 'muted' : 'foreground'} style={styles.strong}>
            {SURENESS_LABEL[sureness]}
          </ThemedText>
        </View>
        <Glyph name={{ ios: open ? 'chevron.up' : 'chevron.right', android: open ? 'expand_less' : 'chevron_right' }} size={11} color={Colors.muted} />
      </Pressable>

      {open ? (
        <View style={styles.editor}>
          <View style={styles.amount}>
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
              placeholder={String(stop.cost)}
              placeholderTextColor={Colors.muted}
              selectionColor={Colors.accent}
              maxFontSizeMultiplier={1.6}
              accessibilityLabel="What this stop actually cost"
              style={styles.amountInput}
            />
          </View>
          <View style={styles.states} accessibilityRole="radiogroup">
            {(['estimate', 'booked', 'paid'] as const).map((kind) => {
              const on = sureness === kind;
              return (
                <Pressable
                  key={kind}
                  onPress={() => onChange(stop.actualCost, kind)}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled }}
                  style={[styles.state, on && styles.stateOn]}>
                  <ThemedText type="detail" style={[styles.strong, { color: on ? Colors.accentForeground : Colors.foreground }]}>
                    {SURENESS_LABEL[kind]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          <ThemedText type="caption" themeColor="muted">
            Booked and Paid stops are locked: the planner will not move them.
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

/** One of a stop's three actions: a symbol over a short word, an equal share of the row. */
function Tile({
  label,
  accessibilityLabel,
  icon,
  primary = false,
  disabled = false,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  icon: SymbolViewProps['name'];
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const ink = disabled ? Colors.muted : primary ? Colors.accentForeground : Colors.foreground;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={primary ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.tile, primary && !disabled && styles.tilePrimary, pressed && styles.tilePressed]}>
      <Glyph name={icon} size={18} color={ink} />
      <ThemedText type="caption" style={[styles.tileLabel, { color: ink }]}>
        {label}
      </ThemedText>
    </Pressable>
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
        <Glyph
          name={{ ios: 'exclamationmark.triangle', android: 'warning' }}
          size={14}
          color={isBlocking(finding) ? Colors.alert : Colors.muted}
        />
        <View style={styles.grow}>
          <ThemedText type="detail">{finding.message}</ThemedText>
          {/* Paper, not orange: orange is the stop's Directions and the toolbar's +, and a third
              orange control on a screen is how a repair started reading as the thing to do first. */}
          <View style={styles.fix}>
            <ThemedText type="detail" style={[styles.strong, styles.fixLabel]}>
              {open ? 'Close' : 'Fix this'}
            </ThemedText>
          </View>
        </View>
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

/**
 * A section's name with one rule beneath it, as trip-2C draws "THE DAY · 5 STOPS". The rule used to
 * run on from the label's end, and every part of the day had one too, so under the section's own
 * edge the page stacked three or four hairlines inside 60pt.
 */
function SectionRule({ label }: { label: string }) {
  return (
    <View style={styles.sectionRule}>
      <ThemedText type="label" themeColor="muted">
        {label}
      </ThemedText>
    </View>
  );
}

/** Morning / Afternoon / Evening: a plain eyebrow over its stops, with no rule of its own. */
function Eyebrow({ label }: { label: string }) {
  return (
    <ThemedText type="label" themeColor="muted" style={styles.eyebrow}>
      {label}
    </ThemedText>
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

/** Washes over the slate section, from the ink so they read in either appearance. */
const LIFT = `${Colors.foreground}0F`;
const FILL = `${Colors.foreground}12`;

const styles = StyleSheet.create({
  content: { gap: Spacing.rows },

  /** Full bleed: the photograph spans the device; the type on it keeps the page's 16pt gutter. */
  band: { justifyContent: 'flex-end' },
  bandText: { padding: Spacing.read, gap: Spacing.hair },
  bandLine: { opacity: 0.86 },
  summary: { paddingHorizontal: Spacing.read },

  /**
   * **A section runs edge to edge on the slate, ruled top and bottom.** It was a column of rows on
   * the bare night with no edge at all, and the opened stop's controls had the width a card's
   * margins and corners would otherwise take; full bleed gives them all of it, the way an iOS
   * plain list does. Text keeps the gutter, which is what holds the measure.
   */
  section: {
    backgroundColor: Colors.surfaceDeep,
    // The top edge only. With both, two sections a gap apart drew two rules 12pt apart.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
    paddingHorizontal: Spacing.read,
    paddingVertical: Spacing.rows,
  },
  sectionRule: {
    marginTop: Spacing.hair,
    paddingBottom: Spacing.tight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  eyebrow: { marginTop: Spacing.rows },

  /** A stop is a row, never a card: no divider between rows — the disc, the bold name and the
   *  leg between two stops already say where one ends. Its own wash runs the section's full width
   *  when opened, so the negative margin undoes the section's gutter for it alone. */
  stop: {
    flexDirection: 'row',
    gap: 13,
    paddingVertical: Spacing.rows,
    paddingHorizontal: Spacing.read,
    marginHorizontal: -Spacing.read,
    alignItems: 'flex-start',
  },
  // A light step of the ink, not a slate: the section is already the slate, and a darker one on
  // it measured identical to the page. In light it is ink at the same step.
  stopExpanded: { backgroundColor: LIFT },
  // The edge eats into the inset rather than pushing the row, so a changed row stays aligned.
  changed: { backgroundColor: Colors.accentWash, borderLeftWidth: 3, borderLeftColor: Colors.accent, paddingLeft: Spacing.read - 3 },
  ghost: { opacity: 0.6 },
  ghostDisc: { width: DISC_SIZE, height: DISC_SIZE, borderRadius: DISC_SIZE / 2, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.muted },
  struck: { textDecorationLine: 'line-through' },
  stopHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.tight },
  particularsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: Spacing.tight,
    marginTop: 3,
  },
  sure: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grow: { flex: 1 },
  expanded: { marginTop: Spacing.tight, gap: Spacing.tight },

  tiles: { flexDirection: 'row', gap: Spacing.tight, marginTop: Spacing.hair },
  tile: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.tight,
    borderRadius: Radius.surface,
    backgroundColor: FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  tilePrimary: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tilePressed: { opacity: 0.75 },
  tileLabel: { fontWeight: '600' },
  strong: { fontWeight: '600' },
  figure: { fontSize: 30, lineHeight: 36 },

  cost: { gap: Spacing.tight },
  costLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.tight,
    minHeight: 44,
    paddingHorizontal: Spacing.rows,
    borderRadius: Radius.surface,
    backgroundColor: FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  pressed: { backgroundColor: Colors.pressed },
  editor: { gap: Spacing.tight },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: Spacing.rows,
    borderRadius: Radius.surface,
    backgroundColor: FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  amountInput: { flex: 1, color: Colors.foreground, paddingVertical: 8, fontSize: 17 },
  /** The selected state is paper with ink on it, the day chip's own treatment, so it reads at
   *  well over 3:1 against its track — the grey thumb it replaces measured 1.45:1. */
  states: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: Radius.surface, backgroundColor: FILL },
  state: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.read },
  stateOn: { backgroundColor: Colors.foreground },

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
    backgroundColor: FILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.cardBorder,
  },
  repairPressed: { opacity: 0.75 },
  repairNote: { paddingHorizontal: Spacing.rows, marginTop: Spacing.hair },
  // The alert's own soft fill, so a conflict reads as one before a word of it is read.
  finding: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.tight,
    marginTop: Spacing.tight,
    padding: Spacing.rows,
    borderRadius: Radius.surface,
    backgroundColor: Colors.alertSoft,
  },
  fix: {
    alignSelf: 'flex-start',
    marginTop: Spacing.tight,
    paddingHorizontal: Spacing.read,
    minHeight: 34,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.foreground,
  },
  fixLabel: { color: Colors.accentForeground },

  stay: { flexDirection: 'row', alignItems: 'center', gap: Spacing.rows },
  stayIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.surface,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FILL,
  },
  total: { gap: Spacing.hair },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.tight },
});
