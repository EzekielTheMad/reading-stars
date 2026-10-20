import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bookSeries,compareBooks,matchesBook} from '../shared/library.ts';
test('series search handles punctuation, author identity and numeric reading order',()=>{
  const percy={title:'The Titan’s Curse',author:'Rick Riordan'};
  assert.deepEqual(bookSeries(percy),{name:'Percy Jackson',order:3});
  assert.equal(matchesBook(percy,"percy riordan"),true);
  assert.equal(matchesBook(percy,"titan's"),true);
  assert.equal(matchesBook(percy,'Narnia'),false);
  assert.equal(bookSeries({title:'Into the Game!',author:'FGTeeV'}),null);
  const books=[11,2,6,1].map(n=>({title:`Magic Tree House #${n}: Example`,author:'Mary Pope Osborne'}));
  assert.deepEqual(books.sort(compareBooks).map(b=>bookSeries(b)!.order),[1,2,6,11]);
  assert.equal(bookSeries({title:"The Magician's Nephew",author:'C. S. Lewis'})?.order,6);
  const mixed=[...books,percy,{title:'The Lightning Thief',author:'Rick Riordan'},{title:'The Chalice of the Gods',author:'Rick Riordan'},{title:'Another story',author:'Other author'}].sort(compareBooks);
  assert.deepEqual(mixed.filter(b=>bookSeries(b)?.name==='Percy Jackson').map(b=>bookSeries(b)!.order),[1,3,6]);
});
