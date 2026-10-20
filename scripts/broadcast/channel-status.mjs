import status from '../../config/channel-status.json' with { type: 'json' };
const key = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
export function isUnconfirmedLegacyChannel(channel, territory, startsAt) {
  const day = typeof startsAt === 'number' ? new Date(startsAt * 1000).toISOString().slice(0, 10) : String(startsAt).slice(0, 10);
  return territory === status.territory && day >= status.reviewedAt && status.unconfirmedLegacyNames.some(name => key(name) === key(channel));
}
