import {plugin} from 'bun'; import {Database} from 'bun:sqlite';
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
await (await import('node:fs/promises')).mkdir(root+'/private',{recursive:true});

plugin({name:'cf-test',setup(b){b.module('cloudflare:sockets',()=>({exports:{connect(){throw Error('Network sockets intentionally disabled in local tests');}},loader:'object'}));}});
globalThis.fetch=async()=>new Response('Offline test: external requests disabled',{status:503});
const source=await Bun.file(root+'/_worker.js').text(); new Bun.Transpiler({loader:'js'}).transformSync(source);
await Bun.write('/tmp/sabi-test.mjs',source+'\nexport {DbService,Router,SubscriptionService,HTML_TEMPLATES};');
const M=await import('/tmp/sabi-test.mjs');const W=M.default; const sq=new Database(':memory:');
function stmt(sql:string,args:any[]=[]):any { return {bind:(...a:any[])=>stmt(sql,a.map(x=>x===undefined?null:x)),first:async(col?:string)=>{const r:any=sq.query(sql).get(...args);return col?r?.[col]??null:r;},all:async()=>({results:sq.query(sql).all(...args),success:true}),run:async()=>{const r=sq.query(sql).run(...args);return {success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}};},raw:async()=>sq.query(sql).values(...args),_sql:sql,_args:args}; }
const DB={prepare:(s:string)=>stmt(s),exec:async(s:string)=>{sq.exec(s);return {};},batch:async(arr:any[])=>{const txn=sq.transaction(()=>arr.map(x=>{const q=sq.query(x._sql);if(/^\s*(SELECT|PRAGMA|WITH)/i.test(x._sql))return {success:true,results:q.all(...x._args)};const r=q.run(...x._args);return {success:true,meta:{changes:r.changes}};}));return txn();}};
const env={DB,CF_ACCOUNT_ID:'test',WORKER_NAME:'sabi-run'};const ctx={waitUntil(p:any){Promise.resolve(p).catch(()=>{});}};let cookie='';const tests:any[]=[];
function check(name:string,ok:boolean,details:any=''){tests.push({name,passed:!!ok,details});console.log(ok?'PASS':'FAIL',name,details);}
async function req(path:string,method='GET',body?:any,auth=true){const h:any={'Host':'sabi.test','User-Agent':'Mozilla/5.0 Chrome/129.0','CF-Connecting-IP':'192.0.2.20'};if(auth&&cookie)h.Cookie=cookie;if(body)h['Content-Type']='application/json';return await W.fetch(new Request('https://sabi.test'+path,{method,headers:h,body:body?JSON.stringify(body):undefined}),env,ctx);}
let r=await req('/panel');check('Setup page',r.status===200&&(await r.text()).includes('handleSetup(event)'));
r=await req('/api/studio');check('Uninitialized management is closed',r.status===401,r.status);
const password='OnlyLocal-Example-Password-987!';r=await req('/api/setup-password','POST',{password});check('Initial setup',r.status===200,r.status);cookie=r.headers.get('set-cookie')?.split(';')[0]||'';
r=await req('/api/setup-password','POST',{password});check('Second setup refused',r.status===400||r.status===409,r.status);
r=await req('/api/login','POST',{password:'bad'},false);check('Wrong password refused',r.status===401,r.status);
r=await req('/api/login','POST',{password},false);check('Admin login',r.status===200);cookie=r.headers.get('set-cookie')?.split(';')[0]||'';check('Session cookie flags',/HttpOnly/.test(r.headers.get('set-cookie')||'')&&/Secure/.test(r.headers.get('set-cookie')||''));
for(const path of ['/api/backup-json','/api/backup','/api/restore','/api/studio','/api/settings/bulk','/api/analytics','/api/users','/api/telegram-info','/api/test-proxy']){r=await req(path,'GET',undefined,false);check('Auth gate '+path,r.status===401,r.status);}
const cross=await W.fetch(new Request('https://sabi.test/api/studio',{method:'POST',headers:{Origin:'https://other.test','User-Agent':'Mozilla/5.0',Host:'sabi.test',Cookie:cookie,'Content-Type':'application/json'},body:'{}'}),env,ctx);check('Cross-origin write refused',cross.status===403);
const makeUser={username:'sabi-demo',limit_gb:25,expiry_days:30,ips:'104.16.0.1',tls:'tls',port:443,ech_enabled:false,user_proxy_ip:'SABI_NODES:ALL',auto_rotate_ip:0};r=await req('/api/users','POST',makeUser);const u=await r.json();check('Create user',r.status===200&&u.success,u.error||'');
let row:any=sq.query('SELECT * FROM users WHERE username=?').get('sabi-demo');check('Custom entry IP saved',row?.ips==='104.16.0.1');
r=await req('/api/studio','POST',{brand:'SABI-RUN',remark_tpl:'{flag} {country} │ {emoji} {brand} │ {user}',nodes_mode:'only',nodes_text:'1.2.3.4:443 DE\n5.6.7.8:443 NL',links:{site:'https://github.com/sabi-karami/SABI-RUN'}});let st=await r.json();check('Studio save',st.ok&&st.nodes_count===2,st.error||'');
r=await req('/sub/'+row.uuid,'GET',undefined,false);let txt=await r.text();let decoded='';try{decoded=Buffer.from(txt,'base64').toString('utf8');}catch{} check('Subscription generated',r.status===200&&decoded.includes('vless://'),r.status);check('Flag and brand in subscription',decodeURIComponent(decoded).includes('🇩🇪')&&decodeURIComponent(decoded).includes('SABI-RUN'));
await Bun.write(root+'/private/local-sub.txt',decoded);
r=await req('/api/backup-json');const backup=await r.json();check('Backup excludes auth secrets',!(backup.settings||[]).some((x:any)=>['panel_password','sabi_session_salt','cf_token','tg_bot_token'].includes(x.key)));
r=await req('/api/backup');const full=await r.json();check('Full backup excludes auth secrets',!(full.settings||[]).some((x:any)=>['panel_password','sabi_session_salt','cf_token','tg_bot_token'].includes(x.key)));
r=await req('/api/settings/bulk');const settings=await r.json();check('Settings excludes session salt',!settings.sabi_session_salt&&!settings.panel_password);
r=await req('/api/telegram-webhook','POST',{message:{text:'/start'}},false);check('Forged Telegram webhook refused',r.status===403||r.status===401,r.status);
const oldCookie=cookie;r=await req('/api/sessions/revoke-all','POST',{});check('Session revocation',r.status===200);cookie=oldCookie;r=await req('/api/studio');check('Old cookie revoked',r.status===401);r=await req('/api/login','POST',{password},false);cookie=r.headers.get('set-cookie')?.split(';')[0]||'';
await req('/api/users/sabi-demo','PUT',{toggle_only:true});r=await req('/sub/'+row.uuid,'GET',undefined,false);txt=Buffer.from(await r.text(),'base64').toString();check('Inactive subscription blocked',txt.includes('127.0.0.1:1'));
await req('/api/users/sabi-demo','PUT',{toggle_only:true});
sq.query("INSERT INTO resellers(username,password_hash,credit_gb,max_users) VALUES(?,?,100,10)").run('reseller-test',await M.DbService.sha256('Reseller-Example-123!'));
const adminCookie=cookie;r=await req('/api/login','POST',{password:'Reseller-Example-123!'},false);const rs=await r.json();check('Reseller login',rs.role==='reseller',rs.error||'');cookie=r.headers.get('set-cookie')?.split(';')[0]||'';
r=await req('/api/settings/bulk');check('Reseller cannot read administration',r.status===403);r=await req('/api/users/sabi-demo','PUT',{toggle_only:true});check('Reseller cannot edit admin-owned user',r.status===403);
cookie=adminCookie;
r=await req('/panel');const html=await r.text();await Bun.write(root+'/private/local-panel.html',html);check('Dashboard template',html.includes('sabiStudioBtn'));
let scripts=0,bad=0;for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){if(!m[1].trim())continue;scripts++;try{new Bun.Transpiler({loader:'js'}).transformSync(m[1]);}catch(e){bad++;console.log(String(e).slice(0,200));}}check('Rendered JS parses',bad===0,{scripts,bad});
const mock:any={};for(const path of ['/api/users','/api/studio','/api/session','/api/settings/bulk','/api/central-nodes','/api/update-check','/api/myip']){try{const rr=await req(path);mock[path]={status:rr.status,body:await rr.text(),contentType:rr.headers.get('content-type')};}catch{}}
await Bun.write(root+'/private/browser-mocks.json',JSON.stringify(mock));await Bun.write(root+'/private/local-login.html',M.HTML_TEMPLATES.login.replaceAll('/*{{GFX_SETTING}}*/','true'));
const report={at:new Date().toISOString(),scope:'Local Bun + SQLite adapter; network/socket access stubbed. Not a Cloudflare/VLESS transport test.',passed:tests.filter(x=>x.passed).length,total:tests.length,tests};await Bun.write(root+'/TEST-RESULTS.json',JSON.stringify(report,null,2));console.log('TOTAL',report.passed+'/'+report.total);process.exit(0);