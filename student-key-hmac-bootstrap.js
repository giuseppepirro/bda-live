(() => {
  'use strict';
  const C = window.BDA_CONFIG || {};
  const KEY = 'bdaLive.matricola.v1';
  const NICK = 'bdaLive.nickname.v1';
  const NS = 'BDA-LIVE|UNICAL|2026-27|';
  const norm = s => String(s || '').trim().toLowerCase();
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function csv(text){
    const out=[]; let row=[], cell='', q=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){ if(q&&n==='"'){cell+='"';i++;} else q=!q; }
      else if(c===','&&!q){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(x=>x!==''))out.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(cell||row.length){row.push(cell);if(row.some(x=>x!==''))out.push(row);}
    return out;
  }

  function parse(raw){
    const p=String(raw||'').trim(), pre=`${C.protocolPrefix||'BDA1'}|||`;
    if(!p.startsWith(pre)) return null;
    try{return JSON.parse(decodeURIComponent(p.slice(pre.length)));}catch(_){return null;}
  }

  async function localSha(raw){
    const bytes=new TextEncoder().encode(NS+String(raw).trim());
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return 'sha256:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }

  function serverHmac(raw){
    return new Promise((resolve,reject)=>{
      const endpoint=String(C.studentKeyEndpoint||'').trim();
      if(!endpoint) return reject(new Error('No HMAC endpoint'));
      const token='bda-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      const frameName='bda-hmac-'+Math.random().toString(36).slice(2);
      const frame=document.createElement('iframe');
      frame.name=frameName;
      frame.style.display='none';
      const form=document.createElement('form');
      form.method='POST';
      form.action=endpoint;
      form.target=frameName;
      form.style.display='none';
      const add=(name,value)=>{const i=document.createElement('input');i.type='hidden';i.name=name;i.value=value;form.appendChild(i);};
      add('op','studentKey');
      add('matricola',String(raw).trim());
      add('token',token);
      let done=false;
      const cleanup=()=>{window.removeEventListener('message',onMessage);form.remove();frame.remove();};
      const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);cleanup();fn(value);};
      const onMessage=event=>{
        const d=event.data;
        if(!d||d.source!=='BDA_HMAC'||d.token!==token)return;
        if(d.ok&&/^hmac256:[0-9a-f]{64}$/.test(String(d.key||''))) finish(resolve,String(d.key));
        else finish(reject,new Error(d.error||'HMAC service error'));
      };
      window.addEventListener('message',onMessage);
      const timer=setTimeout(()=>finish(reject,new Error('HMAC service timeout')),Number(C.studentKeyTimeoutMs)||4500);
      document.body.appendChild(frame);
      document.body.appendChild(form);
      form.submit();
    });
  }

  async function studentKey(raw){
    try{return await serverHmac(raw);}catch(error){
      console.warn('BDA LIVE: HMAC unavailable, using local SHA-256 fallback.',error.message);
      return localSha(raw);
    }
  }

  async function registry(){
    const u=new URL(C.responsesCsv,location.href); u.searchParams.set('_bda',Date.now());
    const r=await fetch(u,{cache:'no-store'}); if(!r.ok) throw new Error('registry');
    const rows=csv(await r.text()).slice(1), col=Number.isInteger(C.combinedResponseColumn)?C.combinedResponseColumn:1;
    const byKey=new Map(), byNick=new Map();
    rows.forEach(row=>{
      const e=parse(row[col]); if(!e||e.type!=='REGISTER'||!e.nickname)return;
      const k=String(e.identityHash||e.studentKey||e.matricola||e.studentId||'').trim();
      if(!/^(hmac256|sha256):[0-9a-f]{64}$/.test(k))return;
      if(!byKey.has(k))byKey.set(k,e.nickname);
      if(!byNick.has(norm(e.nickname)))byNick.set(norm(e.nickname),k);
    });
    return {byKey,byNick};
  }

  function save(k,n){localStorage.setItem(KEY,k);localStorage.setItem(NICK,n);localStorage.removeItem('bdaLive.registerAttempt.v2');}
  function loadApp(){if(document.querySelector('script[data-bda-app]'))return;const s=document.createElement('script');s.src='app.js?v=20260915-hmac-ready';s.dataset.bdaApp='1';document.body.appendChild(s);}

  function gate(reg,msg=''){
    const app=document.getElementById('app');
    app.innerHTML=`<div class="page student"><header class="site-header"><div class="brand">BDA LIVE</div><div class="kicker">CLASSROOM LIVE</div></header><div class="redline"></div><main class="main-area"><section class="student-card nickname-card"><div class="eyebrow">JOIN BDA LIVE</div><h2>Enter your matricola</h2><p class="muted">Your matricola is converted to a pseudonymous student key before BDA LIVE writes anything to the response log.</p>${msg?`<div class="inline-error">${esc(msg)}</div>`:''}<form id="keyForm"><input id="m" class="text-answer" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="Matricola"><input id="n" class="text-answer" maxlength="24" autocomplete="off" placeholder="Nickname — only the first time"><button class="primary" type="submit">JOIN</button></form></section></main></div>`;
    document.getElementById('keyForm').onsubmit=async ev=>{
      ev.preventDefault(); const raw=document.getElementById('m').value.trim(), nick=document.getElementById('n').value.trim();
      if(!/^\d{4,12}$/.test(raw)) return gate(reg,'Enter a valid matricola.');
      const k=await studentKey(raw), known=reg.byKey.get(k);
      if(known){save(k,known);loadApp();return;}
      if(!/^[\p{L}\p{N}_.-]{2,24}$/u.test(nick)) return gate(reg,'New student: choose a nickname.');
      const owner=reg.byNick.get(norm(nick)); if(owner&&owner!==k) return gate(reg,'Nickname already used.');
      save(k,nick); loadApp();
    };
  }

  async function boot(){
    const old=(localStorage.getItem(KEY)||'').trim();
    if(old&&!/^(hmac256|sha256):[0-9a-f]{64}$/.test(old)){localStorage.removeItem(KEY);localStorage.removeItem(NICK);}
    try{
      const reg=await registry(), k=(localStorage.getItem(KEY)||'').trim(), n=(localStorage.getItem(NICK)||'').trim();
      if(/^(hmac256|sha256):/.test(k)&&reg.byKey.has(k)){save(k,reg.byKey.get(k));loadApp();return;}
      if(/^(hmac256|sha256):/.test(k)&&n&&!reg.byKey.has(k)){const owner=reg.byNick.get(norm(n));if(!owner||owner===k){loadApp();return;}}
      gate(reg);
    }catch(_){gate({byKey:new Map(),byNick:new Map()},'Connection problem. Reload if registration fails.');}
  }

  window.BDA_STUDENT_KEY=studentKey;
  boot();
})();
