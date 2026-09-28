import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Server data for a tab screen, re-read every time that screen comes into focus.
 *
 * **`useEffect(…, [])` is the wrong shape here, and structurally so.** A tab navigator keeps
 * every screen mounted for the life of the app, so "on mount" means *once per launch*. Trips
 * read the trip list when the app opened and never again: keep a trip in the wizard, switch to
 * the tab, and it is not there — while the server had been returning it the whole time. That
 * read as a lost trip, which is the worst thing this screen could say.
 *
 * `undefined` means "not read yet" and every caller draws a spinner for it. **A refetch
 * deliberately never returns to it** — resetting on focus would replace a list the reader is
 * already looking at with a loading state, once per tab switch. New data only ever replaces old
 * data.
 *
 * The fetcher is held in a ref rather than a dependency on purpose: callers pass an inline
 * arrow, whose identity changes every render, and `useFocusEffect` re-runs whenever its callback
 * changes — so depending on it would refetch on every render, forever. The ref is written in an
 * effect rather than during render, which is both the React rule and the thing that keeps this
 * safe under the React Compiler.
 */
export function useFocusedFetch<T>(fetcher: () => Promise<T>): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined);
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      latest.current().then((result) => {
        if (active) setData(result);
      });
      // A screen left before its fetch lands must not write into the one the reader moved to.
      return () => {
        active = false;
      };
    }, [])
  );

  return data;
}
