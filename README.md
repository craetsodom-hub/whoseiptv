# WhoseIPTV Events Feed

Small, validated multi-sport schedule feed for the WhoseIPTV Android app. No domain or server is required.

## Public feed

`https://raw.githubusercontent.com/craetsodom-hub/whoseiptv/main/feed/events/v1/events.json`

The scheduled GitHub Action refreshes the feed every three hours. It requests today plus the next two UTC days using a bounded priority set and one rotating secondary market per sport. Football uses `config/football-countries.json`; basketball, tennis, cricket, and rugby use `config/sport-countries.json`. Spain, the UK, the US, France, Germany and Italy remain in the priority set where the sport configuration supports them; the rest of the reviewed country list rotates across runs. Formula 1 uses the official worldwide broadcaster table instead of duplicating legacy country requests. The current plan is 72 primary TV-schedule calls per run instead of the previous 450-call burst.

## Data source and safety

- Schedule and broadcaster data comes from the documented TheSportsDB v1 TV schedule endpoint.
- Formula 1 sessions come from official race pages. The country broadcaster table supplies competition rights only; it does not prove the channel for a particular race or sprint.
- Football broadcaster discovery is source-driven. `scripts/broadcast/adapters/index.mjs` is the permitted-source registry: each adapter declares its trusted first-party host, parser contract, source scope, and a fail-closed collector. Reusable parsers support structured JSON, JSON-LD/embedded page state, and semantic HTML; adapters are fixture-tested independently.
- Only an official source that matches competition, both participants, kickoff, territory, and a named destination can add an exact channel. A service/network selection is retained as lower-precision evidence and rights-holder information stays metadata only; no adapter invents a subchannel.
- UTC timestamps are converted to epoch seconds; the Android app converts them to the user's local timezone.
- Records require a supported event and valid UTC time. Football fixtures and rights-only records may have no confirmed event destination; that absence must not be filled with a guessed channel.
- At least 80% of primary schedule requests must succeed. Otherwise the workflow fails before publication and keeps the previous feed. The previous feed is last-known-good data only until its existing `validUntilEpochSeconds`; clients must show it as stale after that point. Official-adapter and logo failures are isolated and never remove valid events or existing broadcasts.
- Transient source requests retry with a bound. HTTP 429 responses are never repeated through the curl fallback, and event-detail and artwork lookups have hard per-run caps. The coverage sidecar records every primary source attempt and its success ratio.
- Feed and coverage JSON files are each written through same-directory temporary files and atomic renames after validation. The two replacements are not a filesystem transaction; consumers must check each document's timestamp independently.
- The feed expires after 12 hours so stale schedules are never presented as current.
- Existing aliases in `config/channel-aliases.json` remain playlist spelling hints for compatibility. Broadcast identity is stricter: territory, numbered channels, regional feeds, quality variants and separately verified audio variants are preserved. An alias is not evidence that two regional channels share a schedule.
- Team badges are resolved from stable TheSportsDB team IDs where available, with a bounded-concurrency, rate-limited, expiring lookup cache. Only HTTPS artwork from `r2.thesportsdb.com`, `www.thesportsdb.com`, `cdn.nba.com`, or `media.formula1.com` is emitted.
- The generator never emits IPTV playlist or stream URLs. The app matches broadcaster names against the user's own playlist.

The free API and the permitted official contracts have limited coverage. Missing event-level destinations are omitted rather than guessed; rights-holder-only data is reported as a gap.

## Backward-compatible evidence fields

Schema version remains 1. `confirmed` is a legacy assignment flag, not proof of independent official verification. Consumers must inspect provenance and precision together:

| Field | Meaning |
| --- | --- |
| `sourceType` | Official event/schedule, all-event service, third-party source event, or general rights |
| `destinationPrecision` | `channel`, `service`, or `network`; a streaming platform is not a numbered TV channel |
| `originalChannelName` / `channelId` | Original provider value and strict scoped identity |
| `checkedAt` / `verifiedAt` | Full collection timestamp where available / existing date-only compatibility field |
| `languages` / `languageEvidence` | Audio codes only with separate event/feed audio evidence; country, channel name and page language are insufficient |
| `scope` | Regional or package restrictions, including NBA local-market listings |
| `broadcastRights` | Competition rights holders, never an exact match-channel assignment |

NBA radio entries and international entries with missing territories are excluded. Named OTT destinations remain services. F1 country-table references are unconfirmed network records with corresponding rights metadata. Existing consumers can continue reading the v1 shape; consumers that ignore precision must not describe every confirmed assignment as an exact channel.

Retries are bounded in count and honor provider `Retry-After` seconds or HTTP dates without shortening the requested delay. Production API entitlement, public-feed redistribution rights and individual artwork licences must be confirmed separately; technical access does not grant those rights.

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
