/** SABI-RUN Pages installer. No storage bindings; no credential logging. */
const REPO = 'https://raw.githubusercontent.com/sabi-karami/SABI-RUN/main/';
const CF = 'https://api.cloudflare.com/client/v4';
const sha = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
function validId(s) { return /^[a-f0-9-]{32,36}$/.test(String(s||'')); }
function project(s) { if(!/^sabi-[a-z0-9-]{3,38}$/.test(s||'')) throw Error('Project name must start with sabi- and contain lowercase letters, digits, hyphens.');return s; }
export default {
 async fetch(request,env) {
  const origin=request.headers.get('Origin');
  const permitted=env.ALLOWED_ORIGIN||'https://sabi-karami.github.io';
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(origin===permitted){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='Content-Type, Authorization';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
  const send=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
  if(new URL(request.url).pathname!='/install') return send({error:'Not found'},404);
  if(origin!==permitted) return send({error:'Origin not allowed'},403);
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(request.method!=='POST') return send({error:'POST required'},405);
  if(env.ENABLE_INSTALL!=='1') return send({error:'Installer is not enabled; no credentials processed.'},503);
  if(Number(request.headers.get('Content-Length')||0)>8192) return send({error:'Request too large'},413);
  const auth=request.headers.get('Authorization')||'';
  if(!/^Bearer [A-Za-z0-9_.-]{20,200}$/.test(auth)) return send({error:'API token required'},401);
  let body;try{const txt=await request.text();if(txt.length>8192)return send({error:'Request too large'},413);body=JSON.parse(txt);}catch{return send({error:'Invalid JSON'},400);}
  async function cf(path,method='GET',data) {
   const h={Authorization:auth};let payload;
   if(data instanceof FormData)payload=data;else if(data!==undefined){payload=JSON.stringify(data);h['Content-Type']='application/json';}
   const r=await fetch(CF+path,{method,headers:h,body:payload,signal:AbortSignal.timeout(25000)});const j=await r.json();
   if(!r.ok||!j.success){const code=j.errors?.[0]?.code;throw Error(code===8000119?'Cloudflare blocked this project (8000119). Stop and contact abusereply@cloudflare.com; do not rename/recreate to bypass.':'Cloudflare rejected request: HTTP '+r.status+' / code '+(code||'unknown'));}
   return j.result;
  }
  try {
   if(body.action==='accounts'){const a=await cf('/accounts?per_page=50');return send({accounts:a.map(x=>({id:x.id,name:x.name}))});}
   if(!validId(body.account))return send({error:'Invalid account ID'},400);
   const name=project(body.project),root='/accounts/'+body.account;
   if(body.action==='database'){
    // Fresh database, never reuse or overwrite another installation.
    const d=await cf(root+'/d1/database','POST',{name:name+'-db'});return send({database_id:d.uuid});
   }
   if(!validId(body.database))return send({error:'Database ID required'},400);
   if(body.action==='initialize'){
    if(String(body.password||'').trim().length<12)return send({error:'Password must contain at least 12 characters'},400);
    const m=await (await fetch(REPO+'release.json')).json();const sr=await fetch(REPO+'schema.sql');if(!sr.ok)throw Error('Schema unavailable');const schema=await sr.text();
    if(await sha(schema)!==m.schema_sha256)throw Error('Schema checksum mismatch');
    await cf(root+'/d1/database/'+body.database+'/query','POST',{sql:schema});
    const salt=crypto.randomUUID()+crypto.randomUUID();
    const q=await cf(root+'/d1/database/'+body.database+'/query','POST',{sql:"INSERT OR IGNORE INTO settings(key,value) VALUES('panel_password',?);",params:[await sha(body.password.trim())]});
    if(q[0]?.meta?.changes!==1)throw Error('Database already initialized; password was NOT overwritten.');
    await cf(root+'/d1/database/'+body.database+'/query','POST',{sql:"INSERT INTO settings(key,value) VALUES('sabi_session_salt',?),('gfx_enabled','1')",params:[salt]});
    return send({initialized:true});
   }
   if(body.action==='project'){
    await cf(root+'/pages/projects','POST',{name,production_branch:'main'});
    const c={compatibility_date:'2026-10-14',compatibility_flags:['nodejs_compat'],d1_databases:{DB:{id:body.database}},env_vars:{CF_ACCOUNT_ID:{type:'plain_text',value:body.account},WORKER_NAME:{type:'plain_text',value:name}}};
    await cf(root+'/pages/projects/'+name,'PATCH',{deployment_configs:{production:c,preview:c}});return send({project:name});
   }
   if(body.action==='deploy'){
    const mr=await fetch(REPO+'release.json');if(!mr.ok)throw Error('Release unavailable');const m=await mr.json();
    const rr=await fetch(REPO+'_worker.js');if(!rr.ok)throw Error('Source unavailable');const code=await rr.text();
    if(await sha(code)!==m.sha256)throw Error('Release checksum mismatch');
    const f=new FormData();f.set('manifest','{}');f.set('branch','main');f.set('_worker.js',new File([code],'_worker.js',{type:'application/javascript+module'}));
    const d=await cf(root+'/pages/projects/'+name+'/deployments','POST',f);return send({deployment_id:d.id,url:d.url,status:d.latest_stage?.status,project_url:'https://'+name+'.pages.dev/panel'});
   }
   if(body.action==='status'){
    if(!validId(body.deployment))throw Error('Invalid deployment ID');
    const d=await cf(root+'/pages/projects/'+name+'/deployments/'+body.deployment);return send({stage:d.latest_stage,status:d.latest_stage?.status,url:d.url});
   }
   return send({error:'Unknown action'},400);
  }catch(e){return send({error:String(e.message).slice(0,450)},400);}
 }
};
