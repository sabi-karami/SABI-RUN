#!/usr/bin/env python3
"""SABI-RUN Pages installer. Python 3.10+, standard library only.
Credentials are read with getpass and are never written to files.
Do not use new projects to bypass Cloudflare restrictions.
"""
import getpass, hashlib, json, re, secrets, sys, time, urllib.error, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://api.cloudflare.com/client/v4'

def main():
    print('SABI-RUN • Cloudflare Pages installer')
    print('Stop if Cloudflare has blocked your project/account. Resolve the restriction with Cloudflare first.')
    if input('Is this deployment permitted by your provider? Type YES: ').strip() != 'YES': return
    token = getpass.getpass('Cloudflare API token (hidden): ').strip()
    if not token: raise RuntimeError('Token required')
    def api(path, method='GET', data=None, content_type=None):
        headers={'Authorization':'Bearer '+token,'User-Agent':'SABI-RUN-Installer/2.0'}
        if data is not None and not isinstance(data,bytes):
            data=json.dumps(data).encode(); content_type='application/json'
        if content_type: headers['Content-Type']=content_type
        req=urllib.request.Request(BASE+path,data=data,headers=headers,method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r: j=json.load(r)
        except urllib.error.HTTPError as e:
            try: j=json.load(e)
            except Exception: raise RuntimeError('Cloudflare HTTP '+str(e.code)) from None
        if not j.get('success'):
            code=(j.get('errors') or [{}])[0].get('code')
            if code==8000119: raise RuntimeError('Project blocked (8000119). Contact abusereply@cloudflare.com. Do not recreate under another name.')
            raise RuntimeError('Cloudflare rejected operation; code '+str(code)+'. Inspect the Cloudflare dashboard. No automatic retry.')
        return j['result']
    accounts=api('/accounts?per_page=50')
    if not accounts: raise RuntimeError('No accessible account')
    for i,a in enumerate(accounts,1): print(str(i)+'. '+a['name'])
    idx=int(input('Account number: '))-1
    if idx<0 or idx>=len(accounts): raise RuntimeError('Invalid account')
    account=accounts[idx]['id']; root='/accounts/'+account
    name=input('New Pages project name (sabi-...): ').strip()
    if not re.fullmatch(r'sabi-[a-z0-9-]{3,38}',name): raise RuntimeError('Use sabi- followed by 3–38 lowercase letters, numbers or hyphens')
    password=getpass.getpass('New panel admin password, at least 12 characters (hidden): ').strip()
    if len(password)<12 or getpass.getpass('Repeat password: ')!=password: raise RuntimeError('Passwords do not match or too short')
    code=(ROOT/'_worker.js').read_bytes();schema=(ROOT/'schema.sql').read_bytes();release=json.loads((ROOT/'release.json').read_text())
    if hashlib.sha256(code).hexdigest()!=release['sha256'] or hashlib.sha256(schema).hexdigest()!=release['schema_sha256']: raise RuntimeError('Release checksum mismatch')
    print('Creating a NEW database. Existing resources will not be overwritten.')
    db=api(root+'/d1/database','POST',{'name':name+'-db'})['uuid']
    print('Database created: '+db+' (keep this ID if a later step fails)')
    query=root+'/d1/database/'+db+'/query'
    api(query,'POST',{'sql':schema.decode()})
    api(query,'POST',{'sql':"INSERT INTO settings(key,value) VALUES('panel_password',?),('sabi_session_salt',?),('gfx_enabled','1')",'params':[hashlib.sha256(password.encode()).hexdigest(),secrets.token_hex(24)]})
    del password
    api(root+'/pages/projects','POST',{'name':name,'production_branch':'main'})
    conf={'compatibility_date':'2026-10-14','compatibility_flags':['nodejs_compat'],'d1_databases':{'DB':{'id':db}},'env_vars':{'CF_ACCOUNT_ID':{'type':'plain_text','value':account},'WORKER_NAME':{'type':'plain_text','value':name}}}
    api(root+'/pages/projects/'+name,'PATCH',{'deployment_configs':{'production':conf,'preview':conf}})
    boundary='sabi-'+secrets.token_hex(16);parts=[]
    for key,value in [('manifest',b'{}'),('branch',b'main'),('_worker.js',code)]:
        disp='Content-Disposition: form-data; name="'+key+'"'
        if key=='_worker.js':disp+='; filename="_worker.js"\r\nContent-Type: application/javascript+module'
        parts.append(('--'+boundary+'\r\n'+disp+'\r\n\r\n').encode()+value+b'\r\n')
    data=b''.join(parts)+('--'+boundary+'--\r\n').encode()
    deploy=api(root+'/pages/projects/'+name+'/deployments','POST',data,'multipart/form-data; boundary='+boundary)
    for _ in range(24):
        d=api(root+'/pages/projects/'+name+'/deployments/'+deploy['id']);stage=d.get('latest_stage') or {}
        print('Deployment: '+str(stage.get('name'))+' / '+str(stage.get('status')))
        if stage.get('status')=='failure':raise RuntimeError('Deployment failed. Inspect Cloudflare deployment logs.')
        if stage.get('name')=='deploy' and stage.get('status')=='success':
            print('Published: https://'+name+'.pages.dev/panel');print('Log in with the password you chose. Revoke the installation API token now.');return
        time.sleep(3)
    print('Deployment still pending; check Cloudflare dashboard. This is not confirmed success.')
if __name__=='__main__':
    try:main()
    except (KeyboardInterrupt,EOFError):print('\nCancelled. Created resources may remain.')
    except Exception as e:print('STOP: '+str(e));sys.exit(1)
