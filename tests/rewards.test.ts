import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readingDay,suggestReward,wordCountBase,questionCount,passingScore} from '../shared/rewards.ts';

test('word-count boundaries, capped multipliers, rounding and missing metadata',()=>{
  const boundaries=[1499,1500,7499,7500,14999,15000,29999,30000,49999,50000,74999,75000,99999,100000];
  assert.deepEqual(boundaries.map(wordCountBase),[1,2,2,3,3,4,4,5,5,7,7,9,9,11]);
  for(const words of [0,-1,1.5,NaN,10_000_001,null,undefined])assert.equal(wordCountBase(words),null);
  const book={band:4,workload:'long' as const,words:87223,review:false};
  assert.equal(suggestReward(book,2).stars,13);
  assert.equal(suggestReward(book,3).stars,11);
  assert.equal(suggestReward(book,2).needsParent,false);
  assert.equal(suggestReward({...book,band:5},1).multiplier,1.4);
  assert.equal(suggestReward({...book,band:1},5).multiplier,0.6);
  assert.equal(suggestReward({...book,band:1,words:420},5).stars,1);
  assert.equal(suggestReward(book,3,'easy').stars,11,'Effort input cannot replace saved bands');
  assert.equal(suggestReward({...book,words:null},3).stars,null);
  assert.equal(suggestReward({...book,words:null},3).needsParent,true);
  assert.equal(suggestReward({...book,review:true},3).needsParent,true);
  assert.equal(suggestReward(book,null).needsParent,true);
  assert.equal(suggestReward({...book,band:null},3).needsParent,true);
  assert.equal(questionCount(49999),5);assert.equal(questionCount(50000),10);
  assert.equal(passingScore(5),4);assert.equal(passingScore(10),8);
});
test('daily boundaries use Arizona midnight throughout the year',()=>{
  assert.equal(readingDay(new Date('2026-10-21T06:59:59Z'),"America/Phoenix"),'2026-10-20');
  assert.equal(readingDay(new Date('2026-10-21T07:00:00Z'),"America/Phoenix"),'2026-10-21');
  assert.equal(readingDay(new Date('2026-01-21T07:00:00Z'),"America/Phoenix"),'2026-01-21');
});
