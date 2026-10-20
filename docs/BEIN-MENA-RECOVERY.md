# beIN MENA programme listings — 18 October 2026

The live first-party TV-event endpoint returned 5,664 rows. Many current live programmes had blank Opta teams, competition and kickoff fields, but an explicit event title, channel, provider and UTC programme start. The old parser yielded one structured candidate and no upcoming candidate from that window. A corrected collection yielded 53 candidates; only independently matched fixtures with applicable country rights receive broadcasts.

The endpoint also returned Australian/APAC providers despite `region=en-mena`. A shared channel name is not a shared regional feed. Those rows are rejected by this MENA adapter.

## Matching contract

- Structured match rows retain their original match kickoff. A missing UTC offset is rejected.
- Programme-title fallback requires the `epg.bein` provider, matching channel name/code, explicit live flags, no replay, a strict two-team/competition/season title and matching competition category.
- The programme duration must be 90 minutes to five hours. The independently obtained football kickoff must fall after programme start, at most 90 minutes into it, with at least 80 minutes remaining. Programme start is never published as kickoff.
- Both team identities need strong matches. Conflicting IDs, competitions, seasons, rescheduling outside the programme, ambiguous fixtures and unsupported titles remain unmatched.
- The existing rights catalog restricts regional broadcasts to its applicable MENA countries. No rights relationship manufactures a channel assignment.
- The parser retains numbered channels and EN feeds separately. Audio for EN 1/2 uses the reviewed primary beIN language FAQ in `config/channel-audio-evidence.json`; numbered channels receive no inferred Arabic audio. The cross-domain FAQ exception is tied to exact channel, region, language, source host, review timestamp and 90-day review expiry.
- Failed middle pages no longer suppress later pages. HTTP 429 stops pagination. Partial failures remain visible in source health while successful candidates survive.

## Local review workflow

`node scripts/refresh-bein-preview.mjs .preview-bein` refreshes the current valid public baseline, organizer LaLiga fixtures and beIN schedules without TheSportsDB requests. It writes Android-compatible v1 JSON plus a coverage report into a dedicated local preview directory. It refuses expired baselines, does not extend inherited data beyond its original expiry, and caps the result at six hours. Files are validated before atomic replacement. It never writes the published feed directory or pushes to GitHub.

`node scripts/serve-local-feed.mjs .preview-bein 8766` serves only events and coverage on loopback. In WHOPLAYSNOW, `node scripts/matches-v2-preview.cjs --shared-feed-preview` selects that local feed for the local preview only. Production continues to use the existing public feed URL.

Export the shared catalog after audio-rule edits with `node scripts/export-reviewed-destinations.mjs ../whoplaysnow-clean/lib/matches/reviewed-destinations.json`.

## Limits

The normal scheduled generator already imports the corrected adapter, but these local changes have not been published. Its separate TheSportsDB success threshold can still prevent a full run before official-source collection; the independent review command is not a claim that this orchestration problem is solved. Full scheduled generation and publication require further validation. French MENA feeds and additional title formats need their own identity, territorial and language checks before inclusion. Public first-party availability is not proof of an unrestricted redistribution license; no commercial API or license was purchased.

Examples recovered from actual schedules: Real Madrid–Sevilla on beIN SPORTS 1 and EN 1, Getafe–Rayo Vallecano on beIN SPORTS 3, and Stuttgart–Atlético Madrid on beIN SPORTS 5. Each passed the existing 17-country MENA rights gate. See the consumer report for current event and event-country counts rather than treating the configured territory list as complete coverage.
