# Reviewed all-match service catalog

The authoritative editable data is `config/official-event-broadcasters.json`.
These rules are evidence level B: an official source explicitly covers every
match of a named competition, season and territory. They do not allocate a
numbered television channel. Keep event-specific channel evidence separate.

On 18 October 2026, 30 active rules cover 16 territories. Exact rule evidence
URLs are embedded beside each assignment. Audio is supplied only where the
same official source explicitly confirms it. Availability in a country must
not be inferred from commentary language.

Both `attachAllEventDestinations` (the Android-compatible events v1 producer)
and `activeAllEventDestinations` (the website sidecar) retain optional
`languages`, `languageEvidence` and `viewingUrl` fields. Existing required v1
fields and the top-level version remain unchanged.

For a reviewed consumer release without publishing a newly generated feed:

```sh
node scripts/export-reviewed-destinations.mjs ../whoplaysnow-clean/lib/matches/reviewed-destinations.json
npm test
```

The export includes the repository, catalog path and SHA-256 so the consumer
artifact is traceable and reproducible. Never hand-edit the generated website
copy. Exporting does not update `lastVerified` or prove that a source was
reviewed again. WHOPLAYSNOW validates these exported/sidecar rules against a
90-day source-review limit, as well as the season, fixture date and fresh cache
expiry. A newer source review requires checking the primary page and editing
the catalog deliberately.

The catalog export makes no network requests and does not publish the events
feed, modify refresh schedules, purchase API access or grant redistribution
rights. Source-owned rights for competitions outside the catalog (such as F1)
are retained; expired cycles for catalog-managed competitions are removed.

Pending expansion: DAZN's announced 48-market Sub-Saharan Africa LaLiga deal
needs a verified territory list. Do not expand the generic Africa region into
all-match destinations without confirming its membership and exceptions.
