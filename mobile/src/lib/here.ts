import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

/**
 * Where the phone is, when the traveller has said that is alright.
 *
 * **Everything here is an improvement on a working screen, never a requirement.** Today already
 * ranks saved places from the next stop, which needs no permission and no radio, and that stays
 * the answer whenever this module cannot produce one — denied, switched off, timed out, or an
 * older build with no native module at all. Nothing below throws and nothing returns an error for
 * a caller to render; the whole surface is a coordinate or null.
 *
 * **Nothing is ever sent anywhere.** The coordinate is used to sort a list already on the device
 * and is not written to the cache, the API, or a log. The permission string in `app.json` says
 * exactly that, and it is the only promise the system prompt lets this app make.
 *
 * **The one failure the `catch` blocks below cannot absorb: a missing usage string.** Without
 * `NSLocationWhenInUseUsageDescription` in `Info.plist`, `getForegroundPermissionsAsync` does not
 * reject — it raises `RCTFatal`, which is a native abort and takes the whole screen down with a
 * red box. Observed exactly once, on the first build after adding this: `expo run:ios` reinstalls
 * pods but does **not** re-run the config plugins when `ios/` already exists, so the native module
 * was present and the plist key was not. `npx expo prebuild -p ios` is what applies the plugin,
 * and it has to run before the build that first ships a permission.
 *
 * The consequence for anyone extending this: the `expo-location` entry in `app.json` is not
 * configuration, it is a load-bearing part of this module, and a different call (background
 * location, which wants a different key) needs its own string added there *and* a prebuild before
 * it will do anything but crash.
 */

/**
 * How long to wait for a fix before giving up.
 *
 * Expo's own docs are explicit that `getCurrentPositionAsync` "may take several seconds" and it
 * has no timeout of its own — a caller that simply awaits it can wait forever, which on this
 * screen would be a list that never sorts. Eight seconds is longer than a warm fix and short
 * enough that the fallback still feels like the screen working rather than recovering.
 */
const FIX_TIMEOUT_MS = 8_000;

export interface Here {
  lat: number;
  lng: number;
}

/**
 * A fix, or null. Never throws, never hangs past `FIX_TIMEOUT_MS`.
 *
 * **`Accuracy.High` (~10m), because the number is printed as a fact.** `Balanced` (~100m) is the
 * obvious choice for ranking places kilometres apart and it was the first one written here — but
 * `describeDistance` rounds to the nearest 50m below a kilometre, so a hundred-metre fix would
 * put "400 m" on screen for somewhere that might be 300 or 500. That is precision the input does
 * not have, which is the class of defect this app has spent three review rounds removing. The
 * usual argument against `High` is battery, and it does not apply to a single fix taken once per
 * mount — a stream would be a different decision.
 */
async function fix(): Promise<Here | null> {
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!position) return null;
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    // Location services off at the OS level, a simulator with no location set, or the native
    // module missing because this build predates it. All of them mean the same thing here.
    return null;
  }
}

/**
 * What Today knows about where you are, and how to ask.
 *
 * **It never prompts on its own.** `getForegroundPermissionsAsync` reports the current status
 * without showing anything, so a granted permission is used silently on every later visit and an
 * undecided one produces an affordance instead of a dialog. A system prompt that appears because
 * somebody opened Home is a prompt asked before the reason for it is on screen, and it is
 * answered "no" once and then forever — `canAskAgain` goes false and iOS never shows it again.
 *
 * **One fix per mount, deliberately.** There is no watcher: `Today` unmounts whenever the tab
 * changes, which is how somebody actually returns to this screen, so the fix is retaken on the
 * visit rather than tracked continuously. A location that followed the traveller around would
 * cost the radio all afternoon to keep a list of three rows in order, on a screen whose numbers
 * are rounded to 50m anyway.
 *
 * `canAsk` is therefore the whole permission model the caller needs: draw the offer, or don't.
 * A refusal leaves `canAsk` false and the screen silently keeps its existing ranking, with no
 * line about Settings — the list works, and nagging for a permission it does not need would be
 * the screen asking twice for something already answered.
 */
export function useHere(): {
  here: Here | null;
  /** True only when a prompt would actually appear, and the offer is worth drawing. */
  canAsk: boolean;
  /** True while a prompt is open or a fix is being taken. */
  busy: boolean;
  ask: () => void;
} {
  const [here, setHere] = useState<Here | null>(null);
  const [canAsk, setCanAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!alive) return;
        if (permission.granted) {
          const got = await fix();
          if (alive) setHere(got);
          return;
        }
        // Undecided *and* still askable. A denial that iOS will not re-prompt for is the same as
        // no permission, and offering it would be a button that does nothing.
        setCanAsk(permission.canAskAgain);
      } catch {
        // A rejected promise — no native module in this build, or the platform refusing. The
        // screen keeps the ranking it already had. A *missing usage string* does not land here;
        // see the note at the top of this file.
        if (alive) setCanAsk(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ask = useCallback(() => {
    setBusy(true);
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.granted) {
          setHere(await fix());
          setCanAsk(false);
        } else {
          // Asked and declined. The offer goes away rather than staying as a standing request.
          setCanAsk(false);
        }
      } catch {
        setCanAsk(false);
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  return { here, canAsk, busy, ask };
}

/**
 * The smallest heading change worth redrawing for.
 *
 * **This exists because of a platform limit, not a battery one.** `Marker`'s `rotation` prop is
 * "iOS: Google Maps only", so on Apple Maps the cone is rotated by a JS transform on the
 * marker's own content — and a marker whose content changes has to be re-rasterised through
 * `tracksViewChanges`. The magnetometer reports far faster than that is worth doing. Five
 * degrees is below what anyone reads as a wrong direction and roughly an order of magnitude
 * fewer redraws than the raw stream.
 */
const HEADING_STEP_DEGREES = 5;

/**
 * Which way the phone is pointing, or null where nothing can say.
 *
 * **This is a watcher, and the file above it says there are none.** That rule is about *position*
 * and the reason given is battery: a GPS stream kept open all afternoon to sort three rows. The
 * magnetometer is not that — it is cheap, and a direction cone that does not turn is a decoration
 * claiming to be an instrument. So the position stays a single fix per mount and the heading
 * streams, which is the honest reading of why the rule exists rather than of what it says.
 *
 * Null covers every way this can be unavailable, and they are not rare: permission not granted,
 * a device with no magnetometer, **and the simulator**, which has none. The caller draws a plain
 * dot in that case rather than a cone pointing at a guess.
 *
 * `trueHeading` over `magHeading`: the map is drawn to true north, so a magnetic heading would
 * be off by the local declination — up to ~20° in places people actually travel.
 */
export function useHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let last: number | null = null;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        // Never prompts, for the same reason `useHere` never does.
        if (!permission.granted || !alive) return;
        subscription = await Location.watchHeadingAsync((next) => {
          // A negative `trueHeading` is how iOS reports that it has no usable value yet.
          if (!alive || next.trueHeading < 0) return;
          if (last !== null && angleBetween(last, next.trueHeading) < HEADING_STEP_DEGREES) return;
          last = next.trueHeading;
          setHeading(next.trueHeading);
        });
        if (!alive) subscription.remove();
      } catch {
        // No magnetometer, no native module, or the platform refusing. A plain dot is correct.
      }
    })();

    return () => {
      alive = false;
      subscription?.remove();
    };
  }, []);

  return heading;
}

/** Degrees apart on a circle, so 359° and 1° are 2° apart rather than 358°. Shared with the
 *  map's own compass, which asks the same question of a different heading. */
export function angleBetween(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}
