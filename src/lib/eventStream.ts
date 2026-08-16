/**
 * Parses a Server-Sent Events response body into individual events. `EventSource` is
 * GET-only, so a POST-initiated SSE stream (this app's `/api/itinerary?stream=1`) has to be
 * read by hand: `fetch`, `response.body.getReader()`, `TextDecoder`. A chunk boundary can
 * split a frame mid-way — this is the one thing a parser that assumes one chunk equals one
 * frame gets wrong under real network conditions, so `buffer` persists raw text across reads
 * until a complete `\n\n`-terminated frame is available.
 */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: string) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawFrame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      dispatchFrame(rawFrame, onEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
  // Any text left in `buffer` here is an unterminated trailing frame — the stream ended
  // before its closing "\n\n" arrived. Dropped deliberately: a partial frame has no
  // reliable event/data split, and the caller detects "the stream ended with nothing
  // usable" by checking whether it ever received a done/error event, not by this function
  // throwing.
}

function dispatchFrame(rawFrame: string, onEvent: (event: string, data: string) => void): void {
  let event = "message";
  let data = "";
  for (const line of rawFrame.split("\n")) {
    if (line.startsWith(":")) continue; // the leading padding/comment frame, or any other comment
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) data = line.slice("data:".length).trim();
  }
  if (data) onEvent(event, data);
}
