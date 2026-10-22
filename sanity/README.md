# Ready-made trips (Sanity)

The curated trip catalogue Home shows under the AI input lives in Sanity: project `zj8wtfx1`
("TripMate"), dataset `production`, document type `readyTrip`.

- `readyTrip.schema.ts`: the schema, as deployed. Not compiled by this repo (`tsconfig.json`
  excludes this folder); it is for a Sanity Studio, or for redeploying the schema.
- `ready-trips.ndjson`: the 35 seed trips, without `_id`s: Sanity assigns them.
- `seed.mjs`: upserts the seed by slug, in one transaction.

**The dataset is private.** Only TripMate's server reads it, with a Viewer token in
`SANITY_API_READ_TOKEN` (`src/lib/readyTrips.ts`, served at `GET /api/ready-trips`). Clients never
call Sanity.

**Ids are Sanity's, and the slug is the trip's identity.** Documents carry the ids Sanity generated
(the catalogue was moved off `readyTrip.<slug>` ids on 2026-10-21, as Sanity's own guidance asks);
nothing in the app reads an id. To reseed after editing the ndjson:

    node --env-file=.env.local sanity/seed.mjs          # dry run
    node --env-file=.env.local sanity/seed.mjs --apply

It needs `SANITY_API_DEVELOPER_TOKEN`, a token that can write, kept only in `.env.local`. A seed trip
whose slug exists replaces that document under its own id; a new slug is created; nothing is
deleted. `sanity dataset import` is not the way to reseed: without `_id`s it would add a second copy
of every trip.

What the documents hold is data, not presentation: `shortName` is the place in ordinary case
("Val d’Orcia"; the card's style uppercases it), whether a trip is a weekend is derived from `days`
in the query, and the price caption is a default in the query unless a trip sets `priceNote`.

Prices (`priceFrom`, USD per person, excluding flights) are mid-range estimates, not quotes. Stops
are well-known places and areas, not bookings.
