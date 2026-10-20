import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const excluded=new Set(['node_modules','.git','dist','data','backups','artifacts','.qa']);
function walk(dir='') {
  return readdirSync(dir || '.',{withFileTypes:true}).flatMap(e=>{
    if(excluded.has(e.name)||e.name.startsWith('.demo')||e.name==='.env')return [];
    const p=join(dir,e.name);return e.isDirectory()?walk(p):[p.replaceAll('\\','/')];
  });
}
let files;
try {files=execFileSync('git',['ls-files','-z'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);}
catch {files=walk();}
if(!files.length)files=walk();
const rules=[
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_\-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}/,
  /(?:C:[\\/]Users[\\/]|\/mnt\/user\/appdata\/)/i,
  // Deployment domains, family names and logs do not belong in this release.
  new RegExp(['reading','rubykeep','com'].join('\.').replace('reading.','reading\\.')),
  new RegExp('\\b'+['Spenc','er'].join('')+'\\b','i'),
  new RegExp('\\b'+['Hay','den'].join('')+'\\b','i'),
];
const failures=[];
for(const f of files) {
  if(/(?:^|\/)(?:\.env(?:\..*)?|data|backups|artifacts|\.qa)(?:\/|$)/.test(f)&&f!=='.env.example')failures.push(f+': private/runtime path');
  if(/\.(?:sqlite(?:-wal|-shm)?|db|pem|key|zip)$/i.test(f))failures.push(f+': private/archive extension');
  if(/\.(?:png|jpe?g|webp)$/i.test(f))continue;
  const text=readFileSync(f,'utf8');
  if(rules.some(r=>r.test(text)))failures.push(f+': possible secret or household identifier');
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Public-package check passed (${files.length} files). This check complements human review; it is not a secret-scanning guarantee.`);
