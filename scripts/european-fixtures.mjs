// Fixture identities only. ESPN's default US television list is never reused
// as evidence for another territory. The shared resolver adds broadcasts later.
export const EUROPEAN_LEAGUES = [
  ['uefa.champions', 'UEFA Champions League'],
  ['uefa.europa', 'UEFA Europa League'],
  ['uefa.europa.conf', 'UEFA Conference League']
];
export function parseEuropeanFixtures(data, slug, competition, nowEpochSeconds) {
  if (!data?.leagues?.some(league => league.slug === slug) || !Array.isArray(data.events) || data.events.length > 300) throw new Error('Invalid European fixture response');
  return data.events.flatMap(event => {
    const fixture = event.competitions?.[0], start = Date.parse(event.date) / 1000;
    if (!/^\d{5,12}$/.test(String(event.id)) || String(fixture?.id) !== String(event.id) || fixture.timeValid !== true || fixture.status?.type?.name !== 'STATUS_SCHEDULED' || fixture.status.type.state !== 'pre' || !String(event.date).endsWith('Z') || !Number.isInteger(start) || start < nowEpochSeconds || start > nowEpochSeconds + 7 * 86400) return [];
    const team = side => {
      const t = fixture.competitors?.find(item => item.homeAway === side)?.team;
      return t?.displayName && /^\d+$/.test(String(t.id)) ? { name:t.displayName, aliases:[t.shortDisplayName,t.name].filter(Boolean), sourceIds:{espn:String(t.id)} } : null;
    };
    const homeTeam=team('home'),awayTeam=team('away');
    if(!homeTeam || !awayTeam) return [];
    return [{id:`espn-${event.id}`,sourceIds:{espn:String(event.id)},title:`${homeTeam.name} vs ${awayTeam.name}`,sport:'football',competition,startUtcEpochSeconds:start,status:'confirmed',homeTeam,awayTeam,broadcasts:[]}];
  });
}
export async function collectEuropeanFixtures({fetchText,nowEpochSeconds,onFailure=()=>{}}) {
  const months=[...new Set([nowEpochSeconds,nowEpochSeconds+7*86400].map(t=>new Date(t*1000).toISOString().slice(0,7).replace('-','')))];
  const events=[];
  // Sequential and bounded; one league failure never discards another league.
  for(const [slug,name] of EUROPEAN_LEAGUES) for(const month of months) {
    try { events.push(...parseEuropeanFixtures(JSON.parse(await fetchText(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${month}&limit=300`)),slug,name,nowEpochSeconds)); }
    catch(error){onFailure({source:slug,error:String(error.message).slice(0,160)});}
  }
  return [...new Map(events.map(e=>[e.id,e])).values()];
}
