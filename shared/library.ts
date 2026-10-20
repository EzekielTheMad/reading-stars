// Curated series identity; a title is paired with its author to avoid mixing works.
export interface Series { name: string; order?: number }
const normalize = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const percy = ["The Lightning Thief", "The Sea of Monsters", "The Titan's Curse", "The Battle of the Labyrinth", "The Last Olympian", "The Chalice of the Gods", "Wrath of the Triple Goddess"];
// Publication order, consistent with the existing catalog and quiz sources.
const narnia = ["The Lion, the Witch and the Wardrobe", "Prince Caspian", "The Voyage of the Dawn Treader", "The Silver Chair", "The Horse and His Boy", "The Magician's Nephew", "The Last Battle"];
export function bookSeries(book: {title: string; author: string}): Series | null {
  const title=normalize(book.title), author=normalize(book.author);
  const numbered=(titles: string[], name: string) => {
    const i=titles.findIndex(t=>normalize(t)===title);
    return i<0 ? null : {name,order:i+1};
  };
  if(author.includes("rickriordan"))return numbered(percy,"Percy Jackson");
  if(author.includes("cslewis"))return numbered(narnia,"Narnia");
  if(author.includes("marypopeosborne") && /magic tree house/i.test(book.title))
    return {name:"Magic Tree House",order:Number(book.title.match(/#(\d+)/)?.[1]) || undefined};
  if(author.includes("barbarapark") && title.startsWith("junieb"))return {name:"Junie B. Jones"};
  if(author.includes("meganmcdonald") && title.startsWith("judymoody"))return {name:"Judy Moody"};
  if(author.includes("ianfalconer") && title.startsWith("olivia"))return {name:"Olivia"};
  if(author.includes("bonastretur") && title.startsWith("hooky"))return {name:"Hooky",order:Number(book.title.match(/(?:volume|book)\s*(\d+)/i)?.[1]) || undefined};
  if(author.includes("nickeliopulos"))return numbered(["Into the Game!","Night of the Bats!","Deep Dive!"],"Minecraft: Woodsword Chronicles");
  return null;
}
export function matchesBook(book: {title:string;author:string}, query:string) {
  const haystack=normalize(book.title+" "+book.author+" "+(bookSeries(book)?.name || ""));
  return query.trim().split(/\s+/).every(word=>haystack.includes(normalize(word)));
}
export function compareBooks(a:{title:string;author:string}, b:{title:string;author:string}) {
  const sa=bookSeries(a),sb=bookSeries(b);
  const group=(sa?.name || "More adventures").localeCompare(sb?.name || "More adventures");
  if(group)return group;
  if(sa?.order || sb?.order)return (sa?.order ?? Infinity)-(sb?.order ?? Infinity);
  return a.title.localeCompare(b.title,undefined,{numeric:true});
}
