/**
 * A parser for the generation endpoint's Server-Sent Events stream.
 *
 * Three properties of the real protocol (`src/app/api/itinerary/route.ts`) shape this, and all
 * three bite a naive line-splitting parser:
 *
 * 1. **The first frame is 2048 bytes of `:` comment.** It is padding that exists to defeat
 *    WebKit's stream buffering, and it is not an event.
 * 2. **A bare `:` keepalive arrives every 20 seconds** for the same transport reasons.
 * 3. Both carry no `event:` line and no data. So frames are dropped by **testing for empty
 *    data**, not by recognising the event name — a parser that routes on name alone is handed
 *    `undefined` and throws partway through a four-minute generation.
 *
 * Frames are also split across network chunks at arbitrary byte offsets, so a buffer is carried
 * between feeds and only complete `\n\n`-terminated frames are emitted.
 */
export interface SseFrame {
  event: string;
  data: string;
}

export function createSseParser(onFrame: (frame: SseFrame) => void) {
  let buffer = '';

  return {
    /** Feed a decoded chunk. Emits every complete frame it now holds. */
    feed(chunk: string) {
      buffer += chunk;
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const frame = parseFrame(raw);
        if (frame) onFrame(frame);
        split = buffer.indexOf('\n\n');
      }
    },
    /** Flush a trailing frame that arrived without its terminator (a stream cut short). */
    end() {
      if (!buffer.trim()) {
        buffer = '';
        return;
      }
      const frame = parseFrame(buffer);
      buffer = '';
      if (frame) onFrame(frame);
    },
  };
}

function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  const data: string[] = [];

  for (const line of raw.split('\n')) {
    // A comment. The padding frame and every keepalive arrive this way.
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // Exactly one leading space is part of the framing, not the payload.
      const value = line.slice(5);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }

  // The empty-data test is the guard, not the event name: comment-only frames have a name of
  // "message" by default and nothing to deliver.
  const joined = data.join('\n');
  if (!joined) return null;
  return { event, data: joined };
}
