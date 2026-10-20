import { broadcastAliases } from './normalize.mjs';

export const SKY_PREMIER_LEAGUE_URL = 'https://www.skysports.com/watch/football-on-sky/competitions/premier-league';
const london = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Sky's displayed clock is UK local time. Reject the spring gap and autumn
// repeated hour rather than silently guessing an offset or treating BST as UTC.
export function skyLocalKickoff(year, month, day, hour, minute) {
  if (![year, month, day, hour, minute].every(Number.isInteger) || year < 2000 || year > 2100 || month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const target = { year: String(year), month: String(month + 1).padStart(2, '0'), day: String(day).padStart(2, '0'), hour: String(hour).padStart(2, '0'), minute: String(minute).padStart(2, '0') };
  const naive = Date.UTC(year, month, day, hour, minute);
  const candidates = [naive, naive - 3600_000].filter(epoch => {
    const parts = Object.fromEntries(london.formatToParts(epoch).map(part => [part.type, part.value]));
    return Object.entries(target).every(([key, value]) => parts[key] === value);
  });
  return candidates.length === 1 ? Math.floor(candidates[0] / 1000) : null;
}

export function parseSkyFixtureSchedule(html, aliasesByChannel = {}, referenceDate = new Date()) {
  const candidates = [], referenceYear = referenceDate.getUTCFullYear();
  if (!Number.isFinite(referenceDate.getTime())) return candidates;
  for (const section of String(html).split(/(?=<h3\b[^>]*>)/i)) {
    const heading = clean(section.match(/^<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const date = heading.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)$/);
    if (!date) continue;
    const month = months.indexOf(date[3].toLowerCase());
    if (month < 0) continue;
    // Choose the nearest calendar year, then validate the source's weekday.
    const year = referenceYear + (month < referenceDate.getUTCMonth() - 6 ? 1 : month > referenceDate.getUTCMonth() + 6 ? -1 : 0);
    for (const block of section.split(/<div\b[^>]*class=["'][^"']*\bevent-group\b[^"']*["'][^>]*>/i).slice(1, 65)) {
      const row = block.split(/<\/p>/i)[0];
      const teams = [...row.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)].map(match => clean(match[1]));
      const kickoff = clean(row.match(/<li\b[^>]*class=["'][^"']*\bcol2\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/i)?.[1]);
      const detail = clean(row.match(/<p\b[^>]*class=["'][^"']*\bevent-detail\b[^"']*["'][^>]*>([\s\S]*)$/i)?.[1]);
      const channels = [...new Set([...detail.matchAll(/\b(Sky Sports(?:[ A-Za-z0-9+]*?))\s*\(\d{1,2}:\d{2}\)/g)].map(match => match[1].trim()))];
      if (teams.length !== 2 || teams.some(team => !team || team.length > 120) || !/^\d{1,2}:\d{2}$/.test(kickoff) || !channels.length) continue;
      const startUtcEpochSeconds = skyLocalKickoff(year, month, Number(date[2]), Number(kickoff.split(':')[0]), Number(kickoff.split(':')[1]));
      if (!startUtcEpochSeconds || london.formatToParts(startUtcEpochSeconds * 1000).find(part => part.type === 'weekday')?.value !== date[1]) continue;
      const preview = row.match(/href=["'](https:\/\/www\.skysports\.com\/football\/[a-z0-9-]+\/(\d+))["']/i);
      // Preserve existing v1 IDs, which were derived from the displayed clock.
      // Fixing the UTC instant must not invalidate Android's saved event IDs.
      const sourceId = `sky-${teams[0]}-${teams[1]}-${Date.UTC(year, month, Number(date[2]), Number(kickoff.split(':')[0]), Number(kickoff.split(':')[1]))}`;
      candidates.push({
        source: 'sky', sourceUrl: SKY_PREMIER_LEAGUE_URL, sourceId,
        ...(preview ? { sourceIds: { sky: preview[2] } } : {}),
        title: `${teams[0]} vs ${teams[1]}`, sport: 'football', competition: 'Premier League',
        homeTeam: teams[0], awayTeam: teams[1], startUtcEpochSeconds,
        broadcasts: channels.map(channelName => ({
          channelName, originalChannelName: channelName,
          aliases: broadcastAliases(channelName, aliasesByChannel[channelName] ?? [], 8),
          territory: 'GB', rightsHolder: 'Sky Sports', confirmed: true,
          sourceType: 'official-broadcaster-schedule', destinationType: 'linear', destinationPrecision: 'channel', destinationVerified: true,
          sourceUrl: SKY_PREMIER_LEAGUE_URL, matchingMethod: 'sky-fixture-row-teams-london-kickoff'
        }))
      });
    }
  }
  return candidates;
}
