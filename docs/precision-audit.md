# Broadcast precision audit — reconciled 2026-08-24

## Reconciled lineage

The final feature branch starts from the complete published PR branch `origin/codex/improve-today-s-events-backend-ranking` (`9c5a177`) and preserves the internet-enabled live-source work through reconciled descendants of `831b44e` and `0676855`. The pre-reconciliation internet work is also preserved at local branch `internet-live-work`.

## Regression suite

`node --test tests/*.test.mjs` executes 55 tests across the ranking, broadcast adapter/resolver, feed core, Formula 1, live official football, NBA, multi-competition rights, sport-country, and territory suites. This includes `scripts/football-ranking.mjs` and `tests/football-ranking.test.mjs` from the published PR alongside the real-source snapshots and precision tests.

## Territory correction

The internet-enabled feed previously exposed two non-current region codes through legacy `Intl.DisplayNames` values: `DD` for a current Germany row and `CS` for a current Serbia row. Current source labels `Germany` and `Serbia` map explicitly to `DE` and `RS`; historical labels remain rejected. A current ISO 3166-1 alpha-2 allowlist is enforced, with `XK` separately supported as an intentional non-ISO Kosovo extension.

## Rights status

The reconciled version 3 catalog covers FIFA World Cup, Premier League, UEFA Champions League, LaLiga, Bundesliga, and Ligue 1. Season-valid rights remain in `broadcastRights[]`; exact event destinations remain in `broadcasts[]`. Rights metadata never becomes a playlist-match broadcast. Valid all-event service destinations remain exact broadcasts only for their declared seasons and date ranges.

## Precision guarantees

Every emitted exact assignment carries source type, source URL, and matching method after normalization. Official evidence wins an identical weaker source-event assignment. The coverage audit reports official exact-linear, source-event exact-linear, official exact-service, and source-event service assignments separately, and rejects invalid territories, duplicate territory/channel pairs, duplicate aliases, and numbered-channel alias collisions.
