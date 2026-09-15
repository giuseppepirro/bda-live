(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const isPresenter = new URLSearchParams(location.search).get('view') === 'present';
  const MATRICOLA_KEY = 'bdaLive.matricola.v1';
  const NICKNAME_KEY = 'bdaLive.nickname.v1';
  const APP_VERSION = '20260915-matricola-key';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

  function loadApp() {
    if (document.querySelector('script[data-bda-app]')) return;
    const script = document.createElement('script');
    script.src = `app.js?v=${APP_VERSION}`;
    script.dataset.bdaApp = '1';
    document.body.appendChild(script);
  }

  function csvRows(text) {
    const rows=[];
    let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"'){
        if(quoted&&n==='"'){cell+='"';i++;}else quoted=!quoted;
      }else if(c===','&&!quoted){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!quoted){
        if(c==='\r'&&n==='\n')i++;
        row.push(cell);
        if(row.some(v=>v!==''))rows.push(row);
        row=[];cell='';
      }else cell+=c;
    }
    if(cell||row.length){row.push(cell);if(row.some(v=>v!==''))rows.push(row);}
    return rows;
  }

  function parseEvent(raw) {
    const payload=String(raw||'').trim();
    const prefix=`${CFG.protocolPrefix||'BDA1'}|||`;
    if(!payload.startsWith(prefix))return null;
    try{return JSON.parse(decodeURIComponent(payload.slice(prefix.length)));}
    catch(_){return null;}
  }

  async function loadRegistry() {
    const u=new URL(CFG.responsesCsv,location.href);
    u.searchParams.set('_bda',`${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
    const r=await fetch(u.toString(),{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const rows=csvRows(await r.text()).slice(1);
    const payloadCol=Number.isInteger(CFG.combinedResponseColumn)?CFG.combinedResponseColumn:1;
    const byMatricola=new Map();
    const byNickname=new Map();
    rows.forEach(row=>{
      const e=parseEvent(row[payloadCol]);
      if(!e||e.type!=='REGISTER'||!e.nickname)return;
      const matricola=String(e.matricola||e.studentId||'').trim();
      if(!matricola||String(e.studentId||'').startsWith('stu-'))return;
      if(!byMatricola.has(matricola))byMatricola.set(matricola,e.nickname);
      if(!byNickname.has(norm(e.nickname)))byNickname.set(norm(e.nickname),matricola);
    });
    return {byMatricola,byNickname};
  }

  function saveIdentity(matricola,nickname){
    localStorage.setItem(MATRICOLA_KEY,matricola);
    localStorage.setItem(NICKNAME_KEY,nickname);
  }

  function renderGate(registry,message=''){
    const app=document.getElementById('app');
    const savedMatricola=(localStorage.getItem(MATRICOLA_KEY)||'').trim();
    app.innerHTML=`<div class="page student"><header class="site-header"><div class="header-row"><div class="brand">BDA LIVE</div></div><div class="kicker">CLASSROOM LIVE</div></header><div class="redline"></div><main class="main-area"><section class="student-card nickname-card"><div class="eyebrow">JOIN BDA LIVE</div><h2>Enter your matricola</h2><p class="muted">Your matricola is the key. If you have joined before, BDA LIVE restores your nickname automatically. Only a new matricola must choose a nickname.</p>${message?`<div class="inline-error">${esc(message)}</div>`:''}<form id="identityBootstrapForm"><input id="bootstrapMatricola" class="text-answer" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="Matricola" value="${esc(savedMatricola)}"><input id="bootstrapNickname" class="text-answer" maxlength="24" autocomplete="off" placeholder="Nickname — only the first time"><button class="primary" type="submit">JOIN</button></form></section></main><footer><span>Big Data Analytics and Reasoning</span><span class="live"><span class="dot"></span>LIVE</span></footer></div>`;

    document.getElementById('identityBootstrapForm').addEventListener('submit',event=>{
      event.preventDefault();
      const matricola=document.getElementById('bootstrapMatricola').value.trim();
      const nickname=document.getElementById('bootstrapNickname').value.trim();
      if(!/^\d{4,12}$/.test(matricola))return renderGate(registry,'Enter a valid matricola using digits only.');

      const canonicalNickname=registry.byMatricola.get(matricola);
      if(canonicalNickname){
        saveIdentity(matricola,canonicalNickname);
        loadApp();
        return;
      }

      if(!/^[\p{L}\p{N}_.-]{2,24}$/u.test(nickname)){
        localStorage.setItem(MATRICOLA_KEY,matricola);
        return renderGate(registry,'This matricola is new. Choose a nickname (2–24 letters, numbers, dots, underscores or hyphens).');
      }
      const nicknameOwner=registry.byNickname.get(norm(nickname));
      if(nicknameOwner&&nicknameOwner!==matricola){
        localStorage.setItem(MATRICOLA_KEY,matricola);
        return renderGate(registry,'That nickname is already associated with another matricola. Choose another one.');
      }
      saveIdentity(matricola,nickname);
      loadApp();
    });
  }

  async function boot(){
    if(isPresenter){loadApp();return;}
    try{
      const registry=await loadRegistry();
      const savedMatricola=(localStorage.getItem(MATRICOLA_KEY)||'').trim();
      if(savedMatricola&&registry.byMatricola.has(savedMatricola)){
        saveIdentity(savedMatricola,registry.byMatricola.get(savedMatricola));
        loadApp();
        return;
      }
      const savedNickname=(localStorage.getItem(NICKNAME_KEY)||'').trim();
      if(savedMatricola&&savedNickname&&!registry.byMatricola.has(savedMatricola)){
        const owner=registry.byNickname.get(norm(savedNickname));
        if(!owner||owner===savedMatricola){loadApp();return;}
      }
      renderGate(registry);
    }catch(error){
      console.error(error);
      loadApp();
    }
  }

  boot();
})();
