# WhoseIPTV Events Feed

Small, validated multi-sport schedule feed for the WhoseIPTV Android app. No domain or server is required.

## Public feed

`https://raw.githubusercontent.com/craetsodom-hub/whoseiptv/main/feed/events/v1/events.json`

The scheduled GitHub Action refreshes the feed every three hours. It requests today plus the next two UTC days for Football, Basketball, Tennis, Formula 1, Cricket, and Rugby across GB, US, ES, FR, MA, TR, DE, and IT. Requests are paced to respect the free source limits; more territories can be added only after a source with adequate capacity is verified.

## Data source and safety

- Schedule and broadcaster data comes from the documented TheSportsDB v1 TV schedule endpoint.
- Formula 1 sessions are additionally collected from Formula 1's official race pages and country-by-country broadcaster table.
- UTC timestamps are converted to epoch seconds; the Android app converts them to the user's local timezone.
- Only records containing a supported sports event, valid UTC time, territory, and named broadcaster are published.
- At least 80% of source requests must succeed. Otherwise the workflow fails and keeps the previous feed.
- The feed expires after 12 hours so stale schedules are never presented as current.
- Channel aliases are explicit and reviewable in `config/channel-aliases.json`; the generator never invents IPTV stream URLs.

The free API returns limited coverage. Missing events or channels are omitted rather than guessed. More permitted sources can be added later behind the same validation rules.

## Local verification

```sh
npm test
npm run build
```
