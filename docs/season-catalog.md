# Sports season catalog

The catalog includes fixtures for the 2026/27 Premier League season and published sessions for the 2026 Formula 1 season. It carries the Premier League club roster and badges, the competition and organizer logo, UK broadcast announcements and published channel airtimes, and UK day-pass and monthly streaming offers. Formula 1 country coverage reports season rights holders when available. Fixture-level broadcasts remain unverified until there is an airing for the fixture and market.

## Build and serve

```sh
npm run catalog:build
npm run catalog:serve
```

Set `CATALOG_PATH` to serve a different snapshot. The default is `.season-catalog/catalog.json`. The server picks up a validated snapshot after an atomic replacement. Refresh it on a schedule that runs within its 24-hour validity window.

```sh
curl 'http://127.0.0.1:8780/v1/fixtures?competition=premier-league&season=premier-league-2026-27&leagueCountry=GB&country=GB&from=2026-11-27&broadcastsOnly=true'
curl 'http://127.0.0.1:8780/v1/coverage?country=GB'
```

`leagueCountry` filters the competition's country. `country` filters the broadcast listings and prices. A fixture can still appear for a country with no verified listing, unless `broadcastsOnly=true` is set. The catalog reports a network announcement at network precision until a channel or service is explicitly named.

`startsAt` is the event start in UTC. `airsAt` is the published start of the broadcast in UTC and may be earlier than the event. Provisional fixture dates are marked. Pricing is scoped to the market, competition and destination. Offers report their currency, minor-unit amount, billing period, terms, source, verification time, and expiry. Expired offers disappear from the response. Missing airtimes and prices have explicit statuses.

## Add a season or market

The builder accepts normalized input batches after its output path.

```sh
npm run catalog:build -- .season-catalog/catalog.json ./season-input.json
```

A batch has `competitions`, `organizations`, `seasons`, `fixtures` and optional `offers` arrays. Use the generated snapshot as a shape reference. Give each season the IDs from its independently checked fixture inventory in `expectedFixtureIds`. For each market supply the fixture IDs with observed listings in `expectedListedFixtureIds`, whether the list is full or partial. An empty broadcast inventory can carry season rights holders. Sports with different season formats can supply their own fixture IDs and dates.

Each fixture must reference a season and existing participant IDs. Add the exact broadcast country, destination identity, precision and source for each airing. Include prices only when the product's published terms establish its market, plan price, period and destinations. A reconciliation failure leaves the previous snapshot available with its original expiry.

## Marketplace integration

For RapidAPI, import [the OpenAPI file](../marketplaces/rapidapi.openapi.yaml). Host the catalog with `CATALOG_HOST=0.0.0.0` and set `RAPIDAPI_PROXY_SECRET` to the proxy secret. Configure the base URL to the hosted service. A direct bearer token can be enabled with `CATALOG_TOKEN`.

For Apify, build from [the Actor directory](../marketplaces/apify). Set `CATALOG_API_URL` and either `CATALOG_TOKEN` or both `RAPIDAPI_KEY` and `RAPIDAPI_HOST` as environment secrets. A run exports filtered fixture records to its dataset. It checks the snapshot generation while paging and fails if it changes, if a selected schedule is stale, or if the result exceeds the requested size limit.
