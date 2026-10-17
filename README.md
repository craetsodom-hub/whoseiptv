# WhoseIPTV Events Feed

Small, validated multi-sport schedule feed for the WhoseIPTV Android app. No domain or server is required.

## Public feed

`https://raw.githubusercontent.com/craetsodom-hub/whoseiptv/main/feed/events/v1/events.json`

The scheduled GitHub Action refreshes the feed every three hours. It requests today plus the next two UTC days using a bounded priority set and one rotating secondary market per sport. Football uses `config/football-countries.json`; basketball, tennis, cricket, and rugby use `config/sport-countries.json`. Spain, the UK, the US, France, Germany and Italy remain in the priority set where the sport configuration supports them; the rest of the reviewed country list rotates across runs. Formula 1 uses the official worldwide broadcaster table instead of duplicating legacy country requests. The current plan is 72 primary TV-schedule calls per run instead of the previous 450-call burst.

## Data source and safety

- Schedule and broadcaster data comes from the documented TheSportsDB v1 TV schedule endpoint.
- Formula 1 sessions are additionally collected from Formula 1's official race pages and country-by-country broadcaster table.
- Football broadcaster discovery is source-driven. `scripts/broadcast/adapters/index.mjs` is the permitted-source registry: each adapter declares its trusted first-party host, parser contract, source scope, and a fail-closed collector. Reusable parsers support structured JSON, JSON-LD/embedded page state, and semantic HTML; adapters are fixture-tested independently.
- Only an official source that matches competition, both participants, kickoff, territory, and a named destination can add an exact channel. A service/network selection is retained as lower-precision evidence and rights-holder information stays metadata only; no adapter invents a subchannel.
- UTC timestamps are converted to epoch seconds; the Android app converts them to the user's local timezone.
- Only records containing a supported sports event, valid UTC time, territory, and named broadcaster are published.
- At least 80% of primary schedule requests must succeed. Otherwise the workflow fails before publication and keeps the previous feed. The previous feed is last-known-good data only until its existing `validUntilEpochSeconds`; clients must show it as stale after that point. Official-adapter and logo failures are isolated and never remove valid events or existing broadcasts.
- Transient source requests retry with a bound. HTTP 429 responses are never repeated through the curl fallback, and event-detail and artwork lookups have hard per-run caps. The coverage sidecar records every primary source attempt and its success ratio.
- Feed and coverage JSON files are written through same-directory temporary files and atomic renames. A failed build does not partially overwrite either public document.
- The feed expires after 12 hours so stale schedules are never presented as current.
- Existing aliases in `config/channel-aliases.json` are retained for compatibility. New sources use generic case, punctuation/whitespace, quality-suffix, separator, and locale-prefix normalization instead of new provider-specific alias mappings. Territories remain part of the broadcast scope.
- Team badges are resolved from stable TheSportsDB team IDs where available, with a bounded-concurrency, rate-limited, expiring lookup cache. Only HTTPS artwork from `r2.thesportsdb.com`, `www.thesportsdb.com`, `cdn.nba.com`, or `media.formula1.com` is emitted.
- The generator never emits IPTV playlist or stream URLs. The app matches broadcaster names against the user's own playlist.

The free API and the permitted official contracts have limited coverage. Missing event-level destinations are omitted rather than guessed; rights-holder-only data is reported as a gap.

## Discovery coverage

Each build writes `feed/events/v1/coverage.json` alongside the v1 feed. It is a non-app sidecar containing source attempts and success/failure, exact destinations, rights with no exact event destination, rejection reasons, and percentage summaries by sport, competition, territory, and adapter. Run `npm run coverage:broadcasts` to print the current audit and any remaining unsupported source contracts.

## Adding a permitted official source

Add an adapter under `scripts/broadcast/adapters/` and register it in `index.mjs`. It must:

- declare an HTTPS first-party `sourceUrl`, `trustedHosts`, parser types, and `appliesTo` scope;
- return both teams, competition, UTC kickoff, territory, named destination, source URL, and matching method;
- fail closed for ambiguous, replay, untrusted, malformed, or network-level-only data;
- have a captured fixture and tests for parser success, source failure, duplicate destination handling, and territory conflicts.

Do not add event-to-channel exceptions, provider-specific aliases, IPTV URLs, or unreviewed page scraping.

## Local verification

```sh
npm test
npm run build
```
