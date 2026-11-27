# Sports season catalog

The catalog includes fixtures for the 2026/27 Premier League season and published sessions for the 2026 Formula 1 season. It carries the Premier League club roster and badges, competition and organizer logos, UK broadcast announcements and published channel airtimes, and UK day-pass and monthly streaming offers. The football calendar applies published fixture amendments and verifies historical kickoffs against completed results. The racing catalog includes verified UK and US session airings where the broadcaster has published an exact listing. It retains season rights information for other markets. US pricing includes the standard monthly plan and free live practice for fixtures with a verified US airing.

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

If a published market source explicitly states that a fixture has no airing, put the fixture ID and its source URL, verification time, and expiry in that market's optional `noAiring` array. An empty search or missing announcement does not establish a no-airing result.

Each fixture must reference a season and existing participant IDs. Add the exact broadcast country, destination identity, precision and source for each airing. Include prices only when the product's published terms establish its market, plan price, period and destinations. A reconciliation failure leaves the previous snapshot available with its original expiry.

## Release verification

```sh
npm run catalog:audit
npm run catalog:audit -- --worldwide
```

The first audit checks all seasons and broadcast markets in the snapshot. Use the worldwide audit when offering coverage in every supported country. It also checks for undeclared countries. Both commands verify the logo files over HTTPS and exit with a nonzero status when an audit finds a gap. The JSON output shows counts and examples for each issue.

The server runs the audit on startup and on snapshot updates when binding publicly or using marketplace authentication. It requires current evidence for kickoff times, exact airings, airtimes and market-specific prices, or an explicit no-airing result. Set `CATALOG_WORLDWIDE=1` to enforce worldwide coverage. For a local release test, set `CATALOG_REQUIRE_COMPLETE=1`. A previous passing snapshot can be served through its evidence expiry if a refresh fails. Local preview keeps provisional times and coverage gaps visible.

## Marketplace integration

For RapidAPI, import [the OpenAPI file](../marketplaces/rapidapi.openapi.yaml). Host the catalog with `CATALOG_HOST=0.0.0.0` and set `RAPIDAPI_PROXY_SECRET` to the proxy secret. Configure the base URL to the hosted service. A direct bearer token can be enabled with `CATALOG_TOKEN`.

For Apify, build from [the Actor directory](../marketplaces/apify). Set `CATALOG_API_URL` and either `CATALOG_TOKEN` or both `RAPIDAPI_KEY` and `RAPIDAPI_HOST` as environment secrets. A run exports filtered fixture records to its dataset. It checks the snapshot generation while paging and fails if it changes, if a selected schedule is stale, or if the result exceeds the requested size limit.
