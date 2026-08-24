# Live official football source validation

Validated with ordinary GET requests following redirects on 2026-08-23 UTC.

| Source | Live result | Observed fixture broadcaster contract |
| --- | --- | --- |
| Sky Sports Premier League | HTTP 200 | Server-rendered `.event-group` rows contain both teams and kickoff; the sibling `.event-detail` contains exact `Sky Sports Main Event`, `Sky Sports Premier League`, and `Sky Sports+` destinations. |
| LaLiga results | HTTP 200 | `__NEXT_DATA__.props.pageProps.matches[]` keeps `time`, `home_team`, `away_team`, and `channels[]` in one match object. Observed operators were `DAZN`, `DAZN EN ABIERTO`, `Movistar LALIGA`, `Movistar Plus+`, and `Orange Fútbol 1`. |
| Premier League fixtures | HTTP 200 after redirect to `/en/matches/premier-league/2026-27` | The response provides a client-side match-list root and first-party SDP API base, but no fixture broadcaster selections in the fetched body. No exact channel is inferred. |
| Ligue 1 | The requested `/en/fixtures-results` returned HTTP 404; the discoverable official `/en/calendar/ligue1` returned HTTP 200 | The calendar JavaScript identifies the first-party `ma-api.ligue1.fr/championship-calendar` and `/championship-match/{id}` contract. Match objects contain teams, UTC date, and row-local `broadcasters.local[]`; numbered `Ligue 1+ 2` through `Ligue 1+ 6` destinations were observed and are parsed exactly. |
| Bundesliga matchday | HTTP 200 | Angular transfer state contains match ID, kickoff, and teams. The upcoming match records inspected contained no active broadcaster field, so no channel is inferred from rights. |
| beIN MENA TV guide | HTTP 200 with ordinary browser-compatible headers | Hydration exposed an empty `channelApi` cache and no schedule rows in the response body. The live schedule contract remains **UNVERIFIED**; no access controls were bypassed and no contract is fabricated. |
| TheSportsDB `eventstv.php` | HTTP 200 | `tvevents[]` contains `idEvent`, `strEvent`, `strTimeStamp`, territory query context, and exact `strChannel`; `lookupevent.php` supplies event/team details used by the resolver. |

The committed snapshots are deliberately reduced to the fields and markup necessary to preserve these observed contracts; they do not contain page chrome, tracking data, or hardcoded production behavior.
