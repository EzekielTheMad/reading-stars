import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityRows,activityTime,activityDate,attemptResult} from '../shared/activity.ts';

test('parent activity keeps retry results separate and sorts by latest activity',()=>{
  const questions=Array.from({length:5},(_,i)=>({id:String(i)}));
  const rows=activityRows([
    {id:'open',assignment_id:'other',created:'2026-10-21 07:05:00',submitted:null,score:null,questions,answers:{'0':'1'}},
    {id:'retry',assignment_id:'story',created:'2026-10-21 06:30:00',submitted:'2026-10-21 07:10:00',score:4,questions,answers:{}},
    {id:'first',assignment_id:'story',created:'2026-10-20 20:00:00',submitted:'2026-10-20 20:05:00',score:3,questions,answers:{}},
  ]);
  assert.deepEqual(rows.map(a=>[a.id,a.attemptNumber,a.result]),[['retry',2,'passed'],['open',1,'progress'],['first',1,'failed']]);
  assert.equal(attemptResult({...rows[1],score:5}), 'progress','Saved work has no result until submitted');
  assert.equal(activityDate('2026-10-21 06:59:00').toISOString(),'2026-10-21T06:59:00.000Z');
  assert.equal(activityDate('2026-10-21T06:59:00Z').toISOString(),'2026-10-21T06:59:00.000Z');
  assert.match(activityTime('2026-10-21 06:59:00','America/Phoenix'),/Oct 20, 2026, 11:59 PM/);
});
