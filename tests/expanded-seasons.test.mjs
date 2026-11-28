import assert from 'node:assert/strict'
import test from 'node:test'
import { addClassicAirings } from '../scripts/catalog/us-leagues.mjs'
import { addMlsViewing, addStanViewing } from '../scripts/catalog/european-broadcasts.mjs'

function batch(competition, fixture) {
  return {
    competitions: [{ id: competition, name: competition }],
    seasons: [{ markets: [] }],
    organizations: [],
    fixtures: [
      {
        id: 'first',
        participants: [],
        broadcasts: [],
        startStatus: 'scheduled',
        ...fixture
      }
    ]
  }
}

test('MLB requires the current game and announcement to agree before quoting either airtime', () => {
  const article =
    'The Toronto Blue Jays and the Chicago Cubs play on Thursday, August 19, 2027, will air exclusively on ESPN and in Canada on Sportsnet at 7:10 p.m. (ET)'
  const record = batch('mlb', {
    date: '2027-08-19',
    title: 'Chicago Cubs at Toronto Blue Jays',
    startsAt: '2027-08-20T00:00:00Z'
  })
  addClassicAirings(record, article, {})
  assert.equal(record.fixtures[0].broadcasts.length, 0)
  record.fixtures[0].startsAt = '2027-08-19T23:10:00Z'
  addClassicAirings(record, article, {})
  assert.deepEqual(
    record.fixtures[0].broadcasts.map((b) => [b.country, b.name, b.type, b.airsAt]),
    [
      ['US', 'ESPN', 'channel', '2027-08-19T23:10:00Z'],
      ['CA', 'Sportsnet', 'network', '2027-08-19T23:10:00Z']
    ]
  )
})

test('MLS quotes the recurring country price and requires local game coverage', () => {
  const record = batch('mls', {})
  const offer =
    'Watch every MLS match, including playoffs, with no blackouts. £4.99/month for the first 6 months, then £9.99⁠/⁠month'
  addMlsViewing(record, 'GB', offer, {})
  addMlsViewing(
    record,
    'CA',
    'Welcome to Apple TV. $6.99/month for the first 6 months, then $14.99/month',
    {}
  )
  assert.deepEqual(
    record.offers.map((o) => [o.country, o.amountMinor, o.currency]),
    [['GB', 999, 'GBP']]
  )
  assert.deepEqual(
    record.seasons[0].markets.map((m) => m.country),
    ['GB']
  )
})

test('Australian airtime uses the Sydney broadcast date and both teams, including across midnight UTC', () => {
  const record = batch('uefa-europa-league', {
    startsAt: '2026-12-08T17:45:00Z',
    participants: [
      { role: 'home', organizationId: 'home' },
      { role: 'away', organizationId: 'away' }
    ]
  })
  record.organizations = [
    { id: 'home', name: 'Viking' },
    { id: 'away', name: 'Feyenoord' }
  ]
  const html =
    '<li class="schedule__entry schedule__entry--event"><div class="schedule__text">Wed, 09 Dec 4:40am</div><div>Kick off 4:45am</div><div class="team team--home"><strong>Viking</strong></div><div class="team team--away"><strong>Feyenoord</strong></div></li>'
  addStanViewing(record, html.replace('Feyenoord', 'Other Club'), '', {})
  assert.deepEqual(record.fixtures[0].broadcasts, [])
  addStanViewing(
    record,
    html,
    'Add Stan Sport to any Stan plan. Stan Plans starting at $9.99 a month Stan Sport In 4K and HD $20 a month',
    {}
  )
  assert.equal(record.fixtures[0].broadcasts[0].airsAt, '2026-12-08T17:40:00.000Z')
  assert.equal(record.offers[0].amountMinor, 2999)
})
