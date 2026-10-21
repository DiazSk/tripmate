# Ready-made trips (Sanity)

The curated trip catalogue Home shows under the AI input lives in Sanity: project `zj8wtfx1`
("TripMate"), dataset `production`, document type `readyTrip`.

- `readyTrip.schema.ts`: the schema, as deployed. Not compiled by this repo (`tsconfig.json`
  excludes this folder); it is for a Sanity Studio, or for redeploying the schema.
- `ready-trips.ndjson`: the 35 seed trips, in Sanity's import format (`_id` and `_key` set).

**The dataset is private.** Only TripMate's server reads it, with a Viewer token in
`SANITY_API_READ_TOKEN` (`src/lib/readyTrips.ts`, served at `GET /api/ready-trips`). Clients never
call Sanity. Document ids keep their `readyTrip.` prefix; a dotted id is never readable without a
token, which is fine here because nothing reads without one.

Re-import, from a Studio project with the schema deployed:
`npx sanity dataset import ready-trips.ndjson production --replace`

Prices (`priceFrom`, USD per person, excluding flights) are mid-range estimates, not quotes. Stops
are well-known places and areas, not bookings.
