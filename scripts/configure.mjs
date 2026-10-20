import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const template=readFileSync(new URL('../.env.example',import.meta.url),'utf8');
const contents=template.replace(/^SETUP_TOKEN=$/m,'SETUP_TOKEN='+randomBytes(32).toString('hex'));
writeFileSync(resolve('.env'),contents,{flag:'wx',mode:0o600});
console.log('Created private .env with a unique setup token. Existing configuration is never overwritten. Read the token privately from .env when first-run setup asks for it.');
