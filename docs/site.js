 'use strict';
// No credential persistence, analytics or token-bearing URLs.
(async function () {
 const form=document.getElementById('installer'),fs=form.querySelector('fieldset'),token=document.getElementById('token');
 const status=document.createElement('p'); status.setAttribute('role','status');status.setAttribute('aria-live','polite');form.append(status);
 let cfg;try{cfg=await(await fetch('installer-config.json',{cache:'no-store'})).json();}catch{status.textContent='تنظیمات نصب در دسترس نیست؛ نصب آنلاین غیرفعال ماند.';return;}
 if(!cfg.enabled||!cfg.relay){form.addEventListener('submit',e=>e.preventDefault());return;}
 let endpoint;try{endpoint=new URL(cfg.relay);if(endpoint.protocol!=='https:')throw Error();}catch{status.textContent='مقصد نصب امن نیست؛ دریافت توکن غیرفعال است.';return;}
 const box=document.createElement('select');box.id='account';box.hidden=true;box.setAttribute('aria-label','حساب کلادفلر');form.insertBefore(box,fs);
 fs.disabled=false;token.placeholder='توکن موقت Cloudflare';const button=form.querySelector('button');button.textContent='بررسی حساب و نصب';
 const pill=document.querySelector('.install-card .pill');pill.textContent='مقصد سرویس: '+endpoint.origin;
 let busy=false,accounts=null,run=null;
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  if(!form.querySelector('[type=checkbox]').checked){status.textContent='ارسال توکن به سرویس مشخص‌شده نیاز به تأیید شما دارد.';return;}
  const name=document.getElementById('project').value.trim();const password=document.getElementById('password').value.trim();
  if(!/^sabi-[a-z0-9-]{3,38}$/.test(name)||password.length<12){status.textContent='نام پروژه یا رمز مدیریت معتبر نیست.';return;}
  busy=true;button.disabled=true;
  async function call(action,extra={}){
   const r=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token.value.trim()},body:JSON.stringify({action,account:box.value,project:name,...extra}),signal:AbortSignal.timeout(90000)});
   const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'خطای سرویس نصب');return d;
  }
  try{
   if(!accounts){status.textContent='در حال بررسی حساب‌ها...';const d=await call('accounts');accounts=d.accounts||[];
    if(!accounts.length)throw Error('حساب قابل دسترسی یافت نشد');box.replaceChildren();for(const a of accounts){const o=document.createElement('option');o.value=a.id;o.textContent=a.name;box.append(o);}box.hidden=false;
    status.textContent='حساب مقصد را انتخاب کنید، سپس دوباره دکمهٔ نصب را بزنید.';button.textContent='نصب روی حساب انتخاب‌شده';return;
   }
   if(run)throw Error('این تلاش قبلاً منابع ایجاد کرده است؛ پیش از شروع مجدد وضعیت را در داشبورد کلادفلر بررسی کنید.');
   run={};status.textContent='۱/۴ — ساخت دیتابیس تازه...';run.database=(await call('database')).database_id;
   status.textContent='۲/۴ — تنظیم رمز و اسکیمای دیتابیس...';await call('initialize',{database:run.database,password});
   status.textContent='۳/۴ — ساخت پروژهٔ Pages و اتصال دیتابیس...';await call('project',{database:run.database});
   status.textContent='۴/۴ — انتشار سورس تأییدشده...';const d=await call('deploy',{database:run.database});run.deployment=d.deployment_id;
   for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,3000));const poll=await call('status',{database:run.database,deployment:run.deployment});
    if(poll.status==='failure')throw Error('انتشار ناموفق؛ داشبورد کلادفلر را بررسی کنید.');
    if(poll.stage?.name==='deploy'&&poll.status==='success'){
     status.textContent='انتشار انجام شد. با رمز انتخابی خود وارد شوید؛ سپس توکن نصب را لغو کنید. ';
     const link=document.createElement('a');link.href='https://'+name+'.pages.dev/panel';link.textContent='باز کردن پنل ↗';link.target='_blank';link.rel='noopener noreferrer';status.append(link);token.value='';document.getElementById('password').value='';return;
    }
   }
   throw Error('انتشار هنوز تأیید نشده است؛ داشبورد کلادفلر را بررسی کنید.');
  }catch(err){status.textContent=String(err.message)+(run?.database?' | شناسهٔ دیتابیس باقی‌مانده: '+run.database:'');}
  finally{busy=false;button.disabled=false;}
 });
 window.addEventListener('pagehide',()=>{token.value='';document.getElementById('password').value='';});
})();
