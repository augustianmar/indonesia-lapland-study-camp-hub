import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const usersFile = path.join(dataDir, 'users.json');
const contactsFile = path.join(dataDir, 'contacts.json');
const keyFile = path.join(dataDir, '.session-key');
const PORT = Number(process.env.PORT || 8080);
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const usersConfig = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
const sessions = new Map();
const failures = new Map();

fs.mkdirSync(dataDir, {recursive:true});
if(!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), {mode:0o600});

function json(res, status, payload){
  const body = JSON.stringify(payload);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'}); res.end(body);
}
function securityHeaders(res){
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
}
function parseCookies(req){
  const out={}; for(const part of (req.headers.cookie || '').split(';')){ const i=part.indexOf('='); if(i>0) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim()); } return out;
}
function getSession(req){
  const token = parseCookies(req).crm_session; if(!token) return null;
  const s = sessions.get(token); if(!s || s.expiresAt < Date.now()){ if(token) sessions.delete(token); return null; }
  s.expiresAt = Date.now() + SESSION_TTL; return {token, ...s};
}
function setSessionCookie(res, token){
  res.setHeader('Set-Cookie', `crm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL/1000}${IS_PROD?'; Secure':''}`);
}
function clearSessionCookie(res){ res.setHeader('Set-Cookie', `crm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${IS_PROD?'; Secure':''}`); }
function csrfOk(req, s){ const got=req.headers['x-csrf-token']; return typeof got==='string' && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(s.csrf)); }
function readBody(req){
  return new Promise((resolve,reject)=>{ let size=0, chunks=[]; req.on('data',c=>{ size+=c.length; if(size>MAX_BODY){ reject(Object.assign(new Error('Request too large'),{status:413})); req.destroy(); return;} chunks.push(c); }); req.on('end',()=>{ try{ resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}); }catch{ reject(Object.assign(new Error('Invalid JSON'),{status:400})); }}); req.on('error',reject); });
}
function passwordMatches(password){
  const actual = crypto.scryptSync(String(password), usersConfig.salt, 64);
  const expected = Buffer.from(usersConfig.hash,'hex'); return actual.length===expected.length && crypto.timingSafeEqual(actual, expected);
}
function safeText(v,max=200){ return String(v ?? '').trim().slice(0,max); }
function validateContact(x){
  const contact = {name:safeText(x.name,120),organisation:safeText(x.organisation,160),type:safeText(x.type,40),country:safeText(x.country,60),status:safeText(x.status,30),owner:safeText(x.owner,60),email:safeText(x.email,254),notes:safeText(x.notes,4000)};
  if(!contact.name) throw Object.assign(new Error('Name is required.'),{status:400});
  if(contact.owner && !usersConfig.users.includes(contact.owner)) throw Object.assign(new Error('Invalid owner.'),{status:400});
  if(contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw Object.assign(new Error('Invalid email.'),{status:400});
  return contact;
}
function loadContacts(){ try{return JSON.parse(fs.readFileSync(contactsFile,'utf8'));}catch{return [];} }
function saveContacts(items){ const tmp=contactsFile+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(items,null,2)); fs.renameSync(tmp,contactsFile); }
function clientIp(req){ return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim(); }
function rateKey(req,user){ return `${clientIp(req)}|${user}`; }
function loginAllowed(req,user){ const key=rateKey(req,user), f=failures.get(key); if(!f) return {ok:true,key}; if(f.lockUntil && f.lockUntil>Date.now()) return {ok:false,key,retry:Math.ceil((f.lockUntil-Date.now())/1000)}; if(f.resetAt<Date.now()) failures.delete(key); return {ok:true,key}; }
function failLogin(key){ const now=Date.now(), old=failures.get(key); const f=!old||old.resetAt<now?{count:0,resetAt:now+15*60*1000,lockUntil:0}:old; f.count++; if(f.count>=5) f.lockUntil=now+15*60*1000; failures.set(key,f); }
function mime(file){ return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'}[path.extname(file)] || 'application/octet-stream'); }
function serveStatic(req,res){
  const u = new URL(req.url,'http://localhost'); const reqPath = u.pathname==='/'?'/index.html':u.pathname;
  const file = path.join(publicDir, path.normalize(reqPath).replace(/^([.][.][/\\])+/,''));
  if(!file.startsWith(publicDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ json(res,404,{error:'Not found'}); return; }
  res.setHeader('Content-Type',mime(file)); res.setHeader('Cache-Control',reqPath==='/index.html'?'no-store':'private, max-age=300'); fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async (req,res)=>{
  securityHeaders(res);
  const u=new URL(req.url,'http://localhost');
  try{
    if(u.pathname==='/api/login' && req.method==='POST'){
      const body=await readBody(req); const user=safeText(body.user,60); const gate=loginAllowed(req,user);
      if(!gate.ok){ res.setHeader('Retry-After',String(gate.retry)); return json(res,429,{error:'Too many failed attempts. Try again later.'}); }
      if(!usersConfig.users.includes(user) || !passwordMatches(body.password || '')){ failLogin(gate.key); return json(res,401,{error:'Incorrect user or password.'}); }
      failures.delete(gate.key); const token=crypto.randomBytes(32).toString('base64url'); const csrf=crypto.randomBytes(24).toString('base64url');
      sessions.set(token,{user,csrf,expiresAt:Date.now()+SESSION_TTL}); setSessionCookie(res,token); return json(res,200,{user,csrf});
    }
    if(u.pathname.startsWith('/api/')){
      const s=getSession(req); if(!s) return json(res,401,{error:'Authentication required.'});
      if(u.pathname==='/api/session' && req.method==='GET') return json(res,200,{user:s.user,csrf:s.csrf});
      if(req.method!=='GET' && !csrfOk(req,s)) return json(res,403,{error:'Security token mismatch. Refresh and try again.'});
      if(u.pathname==='/api/logout' && req.method==='POST'){ sessions.delete(s.token); clearSessionCookie(res); return json(res,200,{ok:true}); }
      if(u.pathname==='/api/contacts' && req.method==='GET') return json(res,200,{contacts:loadContacts()});
      if(u.pathname==='/api/contacts' && req.method==='POST'){
        const c=validateContact(await readBody(req)); const contacts=loadContacts(); contacts.unshift({id:'c_'+crypto.randomUUID(),...c,createdBy:s.user,createdAt:new Date().toISOString()}); saveContacts(contacts); return json(res,201,{ok:true});
      }
      const match=u.pathname.match(/^\/api\/contacts\/([^/]+)$/);
      if(match && req.method==='PUT'){
        const id=decodeURIComponent(match[1]), c=validateContact(await readBody(req)), contacts=loadContacts(), idx=contacts.findIndex(x=>x.id===id); if(idx<0) return json(res,404,{error:'Contact not found.'}); contacts[idx]={...contacts[idx],...c,updatedBy:s.user,updatedAt:new Date().toISOString()}; saveContacts(contacts); return json(res,200,{ok:true});
      }
      return json(res,404,{error:'API route not found.'});
    }
    if(req.method!=='GET' && req.method!=='HEAD') return json(res,405,{error:'Method not allowed.'});
    serveStatic(req,res);
  } catch(err){ json(res,err.status||500,{error:err.status?err.message:'Server error.'}); }
});
server.listen(PORT,()=>console.log(`Study Camp Hub running at http://localhost:${PORT}`));
