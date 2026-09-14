import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const file=path.join(__dirname,'data','users.json');
const pwd=process.argv[2];
if(!pwd || pwd.length<10){ console.error('Usage: node set-password.mjs "a-strong-password"  (10+ characters)'); process.exit(1); }
const cfg=JSON.parse(fs.readFileSync(file,'utf8')); cfg.salt=crypto.randomBytes(16).toString('hex'); cfg.hash=crypto.scryptSync(pwd,cfg.salt,64).toString('hex'); fs.writeFileSync(file,JSON.stringify(cfg,null,2)); console.log('Shared CRM password updated.');
