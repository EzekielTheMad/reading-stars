import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {createApp} from '../server/app.ts';
import {seedDemo} from './demo-seed.ts';

// Never loads .env, accepts a bind address, or enables optional paid AI.
const {values}=parseArgs({options:{'data-dir':{type:'string'},port:{type:'string'}}});
const directory=resolve(values['data-dir'] || '.demo'), marker=join(directory,'DEMO-ONLY.json');
const existing=existsSync(directory);
if(existing && (!existsSync(marker) || JSON.parse(readFileSync(marker,'utf8')).demo!==true))throw new Error('Refusing an existing directory without a demo marker. Choose a new --data-dir.');
const port=Number(values.port || 8790);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose an unprivileged port from 1024 to 65535.');
mkdirSync(directory,{recursive:true,mode:0o700});
const origin=`http://127.0.0.1:${port}`;
const {app,db}=createApp({dataDir:directory,origin,ai:null,timeZone:'UTC'});
if(!existing){seedDemo(db,directory);writeFileSync(marker,JSON.stringify({demo:true}),{flag:'wx',mode:0o600});}
const server=app.listen(port,'127.0.0.1',()=>{
  console.log(`Reading Stars LOCAL DEMO: ${origin}\nPublic demo password/PIN: see README. Do not expose this demo to a network.`);
  console.log(JSON.stringify({pid:process.pid,parent:process.ppid,cwd:process.cwd(),listen:origin,started:new Date().toISOString(),dataDir:directory}));
});
function stop(){server.close(()=>{db.close();process.exit(0);});server.closeIdleConnections();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
server.on('error',error=>{db.close();throw error;});
