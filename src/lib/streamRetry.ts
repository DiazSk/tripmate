/**
 * Whether a streamed `/api/itinerary` run makes its one plain-POST retry. Only a stream that never
 * opened does. A refusal (429, 503, 504, any non-OK status) is an answer, not a drop: sent again it
 * would spend the allowance a second time on a request already refused. An abort is the traveller
 * stopping the run, and offline the retry could only fail the same way.
 */
export function shouldFallBack({
  response,
  aborted,
  online,
}: {
  /** The stream's response, or undefined when `fetch` threw before one arrived. */
  response?: { ok: boolean; body: unknown };
  aborted: boolean;
  online: boolean;
}): boolean {
  if (aborted) return false;
  if (response) return response.ok && !response.body;
  return online;
}
