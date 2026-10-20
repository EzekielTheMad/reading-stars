import {readFileSync} from 'node:fs';
import type {Quiz} from '../shared/schema.ts';

function question(id:string,prompt:string,options:string[],skill:'events'|'cause'|'motives'|'inference',explanation:string,reference:string) {
  return {id,prompt,options,correct:0,skill,explanation,reference};
}
export const demoBooks = [
  {id:'lantern',title:'The Lantern Bridge',band:2,format:'early',story:'the-lantern-bridge.md',quiz:{
    questions:[
      question('purpose','Why did Mara hold the lantern near the stream?',['To help Leo see where to step','To look for a lost coin','To signal a train','To warm the water'],'motives','Mara wanted Leo to see the stepping stones.','Mara says, “Then you can see where to step.”'),
      question('wind','What made the lantern go dark?',['A gust of wind','A splash from Leo','An empty battery','Mara closed its door'],'cause','Wind swept through the reeds just before the light went out.','A gust of wind swept through the reeds. The lantern went dark.'),
      question('moon','What did Leo notice that helped them cross?',['Moonlight on the stones','A boat under the bridge','A new path through the woods','A second lantern in his bag'],'events','The moon emerged and lit the tops of the stones.','Its light shone on the tops of the stones.'),
      question('care','Which action shows that they crossed carefully?',['Testing a stone and crossing one at a time','Jumping across all three stones','Walking with their eyes closed','Running as fast as possible'],'inference','Testing the stone and leaving room reduced their risk of slipping.','Mara tested the first stone; they crossed one stone at a time.'),
      question('help','What does Mara understand at the end?',['Both friends can help in different ways','Only the person with a lantern can help','It is best never to ask for help','The stream is always safe'],'inference','Leo contributed by noticing the moonlight when Mara felt stuck.','Leo had helped by noticing something she had missed.')
    ],discussion:'How did each friend help? Tell about a time someone noticed a solution you had missed.'} as Quiz},
  {id:'garden',title:'The Pocket Garden',band:3,format:'early',story:'the-pocket-garden.md',quiz:{
    questions:[
      question('place','Where does Nia grow her garden?',['In a pot on a windowsill','In the village park','Behind the shop','On the railway platform'],'events','The family has no yard, so she uses the windowsill.','There was only a narrow windowsill and a pot.'),
      question('patience','Why does her grandfather tell her about roots?',['To explain why growth may not be visible yet','To tell her the seeds are broken','To tell her plants do not need water','To ask her to move the pot outside'],'motives','Nia wants to dig up the seeds before they sprout.','Roots grow before leaves; some work happens where we cannot see it.'),
      question('string','What problem does the tight string cause?',['The stem looks bent where the string touches it','The plant loses its soil','The pot falls off the sill','The leaves turn into beans'],'cause','The tight tie presses against the growing stem.','The stem looked bent where the string touched it.'),
      question('change','How do they change the support?',['They replace the tight tie with a loose loop','They remove all the soil','They tie the plant to the window handle','They put the pot in a dark cupboard'],'events','A loose loop provides support and room to grow.','They made a loose loop instead.'),
      question('ending','How has Nia changed by the time the first bean appears?',['She understands that waiting is part of caring for a plant','She thinks small gardens are useless','She no longer wants to water the pot','She refuses to ask for help'],'inference','At first she wants to dig up the seeds; later she waits for the bean to grow.','This time, waiting felt like part of the work.')
    ],discussion:'Why was the loose loop more helpful than the tight string? How did Nia learn to be patient?'} as Quiz},
  {id:'clock',title:'The Station Clock',band:4,format:'chapter',story:'the-station-clock.md',quiz:{
    questions:[
      question('job','What is Arun’s regular Saturday job?',['Winding the station clock','Repairing train engines','Cleaning the museum roof','Driving the first train'],'events','Arun helps his aunt open the museum and winds its clock.','His job was to wind the old station clock.'),
      question('worry','Why does Arun worry about seeing Ivo?',['He said the clock always worked and fears being laughed at','He lost Ivo’s ticket','He forgot to invite Ivo','He broke Ivo’s paper clock'],'motives','The stopped clock contradicts Arun’s confident claim.','He had told his friend Ivo that the clock always worked.'),
      question('photo','What does the photograph help the friends establish?',['The scratch was old, but the case had stood straight','The clock had always leaned left','Ivo made the scratch','The map was a hundred years old'],'inference','The photograph lets them distinguish an old mark from a new change.','The scratch was already there. The case, however, had stood straight.'),
      question('cause','What explanation does the repairer give for the stopped clock?',['An uneven case can interrupt the pendulum’s swing','Paper maps always damage clock gears','The clock had run out of electricity','The scratch had stopped the hands'],'cause','The map left the case uneven; steadying it addressed the problem.','An uneven case can interrupt a pendulum’s regular swing.'),
      question('certain','Why does Arun decide to say the clock “usually” works?',['He has learned to make a more accurate claim','He wants people to stop visiting','The repairer says it will never work again','Ivo asks him to keep the repair secret'],'inference','He recognizes that “always” was more certain than the evidence allowed.','“It was too certain,” Arun said.')
    ],discussion:'Which clues were useful, and which did not prove what Arun first thought? Why was asking the repairer a good choice?'} as Quiz}
] as const;

export function storyText(file:string) {
  return readFileSync(new URL('./stories/'+file,import.meta.url),'utf8').split('\n').filter(line=>!line.startsWith('#')&&!line.startsWith('An original Reading Stars')).join('\n').trim();
}
export function countWords(text:string) {return text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;}
