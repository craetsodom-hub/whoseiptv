import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEuropeanFixtures,collectEuropeanFixtures} from './european-fixtures.mjs';
import {eventIdentityEvidence} from './broadcast/identity.mjs';
const now=Date.parse('2026-10-19T00:00:00Z')/1000;
const fixture={id:'401915403',date:'2026-10-20T16:45Z',competitions:[{id:'401915403',timeValid:true,status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},competitors:[{homeAway:'home',team:{id:'436',displayName:'Fenerbahce'}},{homeAway:'away',team:{id:'494',displayName:'Slavia Prague'}}],geoBroadcasts:[{region:'us',media:{shortName:'Paramount+'}}]}]};
const payload={leagues:[{slug:'uefa.champions'}],events:[fixture]};
test('European fixtures retain identity and kickoff without manufacturing destination evidence',()=>{
 const [event]=parseEuropeanFixtures(payload,'uefa.champions','UEFA Champions League',now);
 assert.equal(event.id,'espn-401915403'); assert.deepEqual(event.broadcasts,[]);
 const candidate={sport:'football',competition:event.competition,homeTeam:'Fenerbahçe',awayTeam:'Slavia Praha',startUtcEpochSeconds:event.startUtcEpochSeconds};
 assert(eventIdentityEvidence(event,candidate));
 assert.equal(eventIdentityEvidence(event,{...candidate,startUtcEpochSeconds:candidate.startUtcEpochSeconds+86400}),null);
 assert.equal(eventIdentityEvidence(event,{...candidate,awayTeam:'Sparta Praha'}),null);
 assert.deepEqual(parseEuropeanFixtures({...payload,events:[{...fixture,competitions:[{...fixture.competitions[0],timeValid:false}]}]},'uefa.champions','UEFA Champions League',now),[]);
});
test('European provider slices isolate failure and never cross competition identities',async()=>{
 const failures=[];const events=await collectEuropeanFixtures({nowEpochSeconds:now,onFailure:x=>failures.push(x),fetchText:async url=>{if(!url.includes('/uefa.champions/'))throw Error('unavailable');return JSON.stringify(payload)}});
 assert.equal(events.length,1);assert.equal(failures.length,2);
 assert.throws(()=>parseEuropeanFixtures(payload,'uefa.europa','UEFA Europa League',now));
});
