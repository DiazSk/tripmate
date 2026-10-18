/**
 * The model ran out of its time budget, on either transport. Its own class so a route can tell
 * "took too long" (a 504 the traveller can retry) apart from every other failure. A module of its
 * own, re-exported by claude.ts, so limitResponse.ts can check for it without pulling the SDK and
 * `child_process` into routes that never call a model (`/api/geocode`, the import front half).
 */
export class ModelTimeoutError extends Error {
  name = "ModelTimeoutError";
}
