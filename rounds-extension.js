(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const VIEW = new URLSearchParams(location.search).get('view') === 'present' ? 'present' : 'student';
  const STORAGE = {
    key: 'bdaLive.matricola.v1',
    nickname: 'bdaLive.nickname.v1',
    browserId: 'bdaLive.browserId.v1'
  };
  const HUGE_DURATION = 315360000;

  const state = {
    baseRoot: null,
    roundRoot: null,
    swapped: false,
    busy: false,
    activeId: '',
    round: null,
    questions: [],
    run: null,
    events: [],
    registrations: null,
    selected: new Map(),
    drafts: new Map(),
    pending: null,
    autoEnding: new Set(),
    roundsCache: null,
    roundsAt: 0,
    lastDeadline: NaN,
    lastStudentSignature: '',
    previewActiveId: '',
    lastPresenterSignature: '',
    lastPresenterRoundKey: ''
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const isRoundId = value => /^ROUND:/i.test(String(value || '').trim());
  const roundIdFrom = value => String(value || '').trim().replace(/^ROUND:/i,'').trim();

  function makeId(prefix) {
    const uuid = globalThis.crypto && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${uuid}`;
  }

  function browserId() {
    let id = localStorage.getItem(STORAGE.browserId);
    if (!id) {
      id = makeId('browser');
      localStorage.setItem(STORAGE.browserId,id);
    }
    return id;
  }

  function withBust(url, key='_round') {
    const u = new URL(url, location.href);
    u.searchParams.set(key, `${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
    return u.toString();
  }

  async function fetchText(url) {
    const r = await fetch(withBust(url), {cache:'no-store'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  function csvRows(text) {
    const rows=[]; let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i],n=text[i+1];
      if(c==='"') { if(quoted&&n==='"'){cell+='"';i++;} else quoted=!quoted; }
      else if(c===','&&!quoted){row.push(cell);cell='';}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
      else cell+=c;
    }
    if(cell||row.length){row.push(cell);if(row.some(v=>v!==''))rows.push(row);}
    return rows;
  }

  function parseTimestamp(value) {
    const s=String(value||'').trim();
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})[.:](\d{2})(?:[.,](\d{1,3}))?$/);
    if(m) return new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5],+m[6],+((m[7]||'0').padEnd(3,'0'))).getTime();
    const p=Date.parse(s); return Number.isFinite(p)?p:NaN;
  }

  function parseEvent(raw) {
    const p=String(raw||'').trim(), pre=`${CFG.protocolPrefix||'BDA1'}|||`;
    if(!p.startsWith(pre)) return null;
    try { const e=JSON.parse(decodeURIComponent(p.slice(pre.length))); return e&&e.type?e:null; }
    catch(_) { return null; }
  }

  async function submitEvent(event) {
    const body=new URLSearchParams();
    body.append(CFG.formEntry, `${CFG.protocolPrefix||'BDA1'}|||${encodeURIComponent(JSON.stringify({v:2,...event}))}`);
    await fetch(CFG.formAction,{method:'POST',mode:'no-cors',cache:'no-store',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
  }

  function presenterUnlocked(){
    return !!(window.BDA_PRESENTER_AUTH&&window.BDA_PRESENTER_AUTH.isAuthenticated&&window.BDA_PRESENTER_AUTH.isAuthenticated());
  }

  async function submitPresenterEvent(event){
    if(!window.BDA_PRESENTER_MUTATE)throw new Error('Presenter authentication is not ready.');
    return window.BDA_PRESENTER_MUTATE('event',{event:JSON.stringify({v:2,...event})});
  }

  async function loadActiveId() {
    const rows=csvRows(await fetchText(CFG.controlCsv));
    return String((rows[0]&&rows[0][1])||'').trim();
  }

  function normalizeType(raw) {
    const v=String(raw||'OPEN').trim().toUpperCase().replace(/[ -]+/g,'_');
    if(['POLL','MCQ','MULTIPLE_CHOICE','MULTIPLECHOICE','QUIZ'].includes(v)) return 'POLL';
    if(['WORDCLOUD','WORD_CLOUD','CLOUD'].includes(v)) return 'WORDCLOUD';
    return 'OPEN';
  }

  async function loadQuestions() {
    const rows=csvRows(await fetchText(CFG.questionsCsv));
    return rows.map((row,index)=>({
      order:index,
      id:String(row[0]||'').trim(),
      week:String(row[1]||'').trim(),
      type:normalizeType(row[2]),
      question:String(row[3]||'').trim(),
      options:String(row[4]||'').split('|').map(v=>v.trim()).filter(Boolean),
      correctAnswer:String(row[5]||'').trim(),
      teachingCue:String(row[6]||'').trim(),
      source:String(row[7]||'').trim(),
      duration:Number(String(row[8]||'').replace(',','.'))||20,
      roundId:String(row[9]||'').trim()
    })).filter(q=>q.id&&q.question);
  }

  async function loadRounds() {
    if(state.roundsCache&&Date.now()-state.roundsAt<10000) return state.roundsCache;
    const rows=csvRows(await fetchText(CFG.roundsCsv));
    const map=new Map();
    rows.slice(1).forEach(row=>{
      const id=String(row[0]||'').trim(); if(!id) return;
      map.set(id,{
        id,
        label:String(row[1]||id).trim()||id,
        mode:String(row[2]||'SCORED').trim().toUpperCase()==='PULSE'?'PULSE':'SCORED',
        duration:Math.max(1,Number(String(row[3]||'').replace(',','.'))||100),
        notes:String(row[4]||'').trim()
      });
    });
    state.roundsCache=map; state.roundsAt=Date.now(); return map;
  }

  async function loadEvents() {
    const rows=csvRows(await fetchText(CFG.responsesCsv));
    const tsCol=Number.isInteger(CFG.responseTimestampColumn)?CFG.responseTimestampColumn:0;
    const pCol=Number.isInteger(CFG.combinedResponseColumn)?CFG.combinedResponseColumn:1;
    return rows.slice(1).map((row,index)=>{
      const e=parseEvent(row[pCol]); if(!e) return null;
      return {...e,receiptMs:parseTimestamp(row[tsCol]),rowIndex:index+2};
    }).filter(Boolean);
  }

  function buildRegistrations(events) {
    const byKey=new Map(),byNick=new Map();
    events.filter(e=>e.type==='REGISTER'&&e.studentId&&e.nickname).sort((a,b)=>(a.receiptMs||0)-(b.receiptMs||0)||a.rowIndex-b.rowIndex).forEach(e=>{
      const key=String(e.matricola||e.studentId||'').trim(),nk=norm(e.nickname);
      if(key&&!byKey.has(key))byKey.set(key,e);
      if(nk&&!byNick.has(nk))byNick.set(nk,e);
    });
    return {byKey,byNick};
  }

  function registrationConfirmed(registrations) {
    if(VIEW!=='student') return true;
    const key=(localStorage.getItem(STORAGE.key)||'').trim();
    const nick=(localStorage.getItem(STORAGE.nickname)||'').trim();
    if(!key||!nick) return false;
    const a=registrations.byKey.get(key), b=registrations.byNick.get(norm(nick));
    if(!a||!b) return false;
    return norm(a.nickname)===norm(nick)&&String(b.matricola||b.studentId||'').trim()===key;
  }

  function roundQuestions(round,questions) {
    return questions.filter(q=>q.roundId===round.id && (round.mode==='PULSE' || (q.type==='POLL'&&!!q.correctAnswer))).sort((a,b)=>a.order-b.order);
  }

  function groupLatestRun(round, questions, events, registrations) {
    const starts=events.filter(e=>e.type==='START'&&e.roundId===round.id&&e.roundRunId&&e.sessionId&&e.questionId);
    if(!starts.length) return null;
    const groups=new Map();
    starts.forEach(s=>{const a=groups.get(s.roundRunId)||[];a.push(s);groups.set(s.roundRunId,a);});
    const all=[...groups.entries()].map(([id,a])=>({id,starts:a.sort((x,y)=>(x.roundIndex??999)-(y.roundIndex??999)||x.rowIndex-y.rowIndex),lastRow:Math.max(...a.map(x=>x.rowIndex))})).sort((a,b)=>b.lastRow-a.lastRow);
    for(const g of all){
      const sessions=g.starts.map(start=>{
        const end=events.filter(e=>e.type==='END'&&e.sessionId===start.sessionId&&Number.isFinite(e.receiptMs)&&e.receiptMs>=start.receiptMs).sort((a,b)=>a.rowIndex-b.rowIndex)[0]||null;
        const reset=events.filter(e=>e.type==='RESET'&&e.sessionId===start.sessionId&&e.rowIndex>start.rowIndex).sort((a,b)=>a.rowIndex-b.rowIndex)[0]||null;
        return {start,end,reset,question:questions.find(q=>q.id===start.questionId)||null,answers:[]};
      });
      if(sessions.length&&sessions.every(s=>s.reset)) continue;
      const startMs=Math.min(...sessions.map(s=>s.start.receiptMs).filter(Number.isFinite));
      const explicitEndMs=Math.min(...sessions.map(s=>s.end?.receiptMs).filter(Number.isFinite),Infinity);
      const deadline=round.mode==='PULSE'?Infinity:startMs+round.duration*1000;
      const endMs=Math.min(deadline,explicitEndMs);
      const seen=new Set();
      const accepted=[];
      events.filter(e=>e.type==='ANSWER'&&e.sessionId&&e.studentId).sort((a,b)=>(a.receiptMs||0)-(b.receiptMs||0)||a.rowIndex-b.rowIndex).forEach(e=>{
        const session=sessions.find(s=>s.start.sessionId===e.sessionId); if(!session||!session.question)return;
        const sid=String(e.matricola||e.studentId||'').trim(), dedup=`${e.sessionId}::${sid}`;
        if(!sid||seen.has(dedup))return;
        if(!Number.isFinite(e.receiptMs)||e.receiptMs<session.start.receiptMs||e.receiptMs>endMs)return;
        const owner=registrations.byKey.get(sid), nickOwner=registrations.byNick.get(norm(e.nickname));
        if(!owner||!nickOwner||norm(owner.nickname)!==norm(e.nickname)||String(nickOwner.matricola||nickOwner.studentId||'').trim()!==sid)return;
        seen.add(dedup); const a={...e,studentId:sid,nickname:String(e.nickname||'').trim(),answer:String(e.answer||'').trim(),question:session.question};
        session.answers.push(a); accepted.push(a);
      });
      return {...g,sessions,startMs,deadline,explicitEndMs,endMs,accepted};
    }
    return null;
  }

  function timing(round,run,now=Date.now()) {
    if(!run||!Number.isFinite(run.startMs))return {state:'PREPARED',remainingMs:0,deadline:NaN};
    if(round.mode==='PULSE'){
      const closed=Number.isFinite(run.explicitEndMs)&&run.explicitEndMs!==Infinity;
      return {state:closed?'CLOSED':'OPEN',remainingMs:Infinity,deadline:Infinity};
    }
    return {state:now<run.endMs?'OPEN':'CLOSED',remainingMs:Math.max(0,run.endMs-now),deadline:run.deadline};
  }

  function acceptedFor(session){return session?.answers||[];}
  function hasAnswered(session,studentId){return !!session&&(acceptedFor(session).some(a=>a.studentId===studentId)||localStorage.getItem(`bdaLive.submitted.${session.start.sessionId}`)==='1');}

  function normalizeCloudAnswer(value) {
    let display=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
    display=display.replace(/^[\s.,;:!?"'“”‘’()[\]{}]+|[\s.,;:!?"'“”‘’()[\]{}]+$/g,'').trim();
    const normalized=display.replace(/[-‐‑‒–—]+/g,' ').replace(/\s+/g,' ').toLocaleLowerCase();
    return {display,normalized};
  }

  function cloudItems(answers){
    const g=new Map();
    answers.forEach(a=>{const n=normalizeCloudAnswer(a.answer);if(!n.normalized)return;const r=g.get(n.normalized)||{text:n.display,normalized:n.normalized,count:0};r.count++;g.set(n.normalized,r);});
    return [...g.values()].sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text));
  }

  function renderCloudMini(answers){
    const items=cloudItems(answers); if(!items.length)return '<div class="round-empty">Waiting for responses…</div>';
    const min=Math.min(...items.map(x=>x.count)),max=Math.max(...items.map(x=>x.count));
    return `<div class="round-cloud">${items.slice(0,18).map(item=>{const size=max===min?30:Math.round(22+(Math.sqrt(item.count)-Math.sqrt(min))/(Math.sqrt(max)-Math.sqrt(min))*38);return `<span style="font-size:${size}px">${esc(item.text)}${item.count>1?`<sup>${item.count}</sup>`:''}</span>`;}).join('')}</div>`;
  }

  function renderPollMini(session,q,closed,scored){
    const answers=acceptedFor(session),total=answers.length,counts=new Map(q.options.map(o=>[o,0]));
    answers.forEach(a=>counts.set(a.answer,(counts.get(a.answer)||0)+1));
    const max=Math.max(1,...counts.values());
    return `<div class="round-poll">${q.options.map(o=>{const c=counts.get(o)||0,p=total?Math.round(c/total*100):0,good=closed&&scored&&norm(o)===norm(q.correctAnswer);return `<div class="round-poll-row${good?' correct-option':''}"><div><span>${esc(o)}</span><strong>${c} · ${p}%</strong></div><div class="bar-bg"><div class="bar" style="width:${c/max*100}%"></div></div></div>`;}).join('')}</div>`;
  }

  function getStudentId(){return (localStorage.getItem(STORAGE.key)||'').trim();}
  function getNickname(){return (localStorage.getItem(STORAGE.nickname)||'').trim();}

  function shell(content,opt={}){
    return `<div class="page ${VIEW}"><header class="site-header"><div class="header-row"><div class="brand">BDA LIVE</div>${opt.identity?`<div class="identity-chip">${esc(opt.identity)}</div>`:''}</div>${opt.kicker?`<div class="kicker">${esc(opt.kicker)}</div>`:''}${opt.title?`<h1>${esc(opt.title)}</h1>`:''}</header><div class="redline"></div><main class="main-area">${content}</main><footer><span>Big Data Analytics and Reasoning</span><span class="live"><span class="dot"></span>LIVE</span></footer></div>`;
  }

  function ensureRootSwap(){
    if(state.swapped)return true;
    const root=document.getElementById('app');
    if(!root)return false;
    const page=root.querySelector(`.page.${VIEW}`);
    if(!page)return false;
    state.baseRoot=root; root.id='bda-base-app'; root.style.display='none';
    const rr=document.createElement('div'); rr.id='app'; root.insertAdjacentElement('afterend',rr);
    state.roundRoot=rr; state.swapped=true; return true;
  }

  function restoreBase(){
    if(!state.swapped)return;
    if(state.roundRoot)state.roundRoot.remove();
    if(state.baseRoot){state.baseRoot.id='app';state.baseRoot.style.display='';}
    state.roundRoot=null;state.baseRoot=null;state.swapped=false;state.run=null;state.round=null;state.lastDeadline=NaN;state.lastStudentSignature='';state.lastPresenterSignature='';state.lastPresenterRoundKey='';
  }

  function roundSessionFor(run,qid){return run?.sessions.find(s=>s.start.questionId===qid)||null;}

  function participantStats(run,questionCount){
    const by=new Map();
    run?.sessions.forEach(s=>acceptedFor(s).forEach(a=>{const set=by.get(a.studentId)||new Set();set.add(s.start.questionId);by.set(a.studentId,set);}));
    return {participants:by.size,complete:[...by.values()].filter(s=>s.size>=questionCount).length,totalAnswers:[...by.values()].reduce((n,s)=>n+s.size,0)};
  }

  function buildLeaderboard(events,registrations){
    const starts=new Map();events.filter(e=>e.type==='START'&&e.sessionId&&e.questionId).sort((a,b)=>a.rowIndex-b.rowIndex).forEach(e=>{if(!starts.has(e.sessionId))starts.set(e.sessionId,e);});
    const ends=new Map();events.filter(e=>e.type==='END'&&e.sessionId).sort((a,b)=>a.rowIndex-b.rowIndex).forEach(e=>{if(!ends.has(e.sessionId))ends.set(e.sessionId,e);});
    const seen=new Set(),totals=new Map();
    events.filter(e=>e.type==='ANSWER'&&e.sessionId&&e.studentId).sort((a,b)=>(a.receiptMs||0)-(b.receiptMs||0)||a.rowIndex-b.rowIndex).forEach(e=>{
      const start=starts.get(e.sessionId);if(!start||!start.correctAnswer||!Number.isFinite(start.receiptMs)||!Number.isFinite(e.receiptMs))return;
      const sid=String(e.matricola||e.studentId||'').trim(),key=`${e.sessionId}::${sid}`;if(seen.has(key))return;seen.add(key);
      const owner=registrations.byKey.get(sid),nickOwner=registrations.byNick.get(norm(e.nickname));if(!owner||!nickOwner||norm(owner.nickname)!==norm(e.nickname)||String(nickOwner.matricola||nickOwner.studentId||'').trim()!==sid)return;
      const duration=Number(start.duration)>0?Number(start.duration):20,end=ends.get(e.sessionId),endMs=Math.min(start.receiptMs+duration*1000,end&&Number.isFinite(end.receiptMs)?end.receiptMs:Infinity);
      if(e.receiptMs<start.receiptMs||e.receiptMs>endMs||norm(e.answer)!==norm(start.correctAnswer))return;
      const elapsed=e.receiptMs-start.receiptMs,points=Math.round(clamp(100+900*(1-elapsed/(duration*1000)),100,1000));
      const r=totals.get(sid)||{nickname:String(e.nickname||''),points:0,correct:0};r.points+=points;r.correct++;totals.set(sid,r);
    });
    return [...totals.values()].sort((a,b)=>b.points-a.points||b.correct-a.correct||a.nickname.localeCompare(b.nickname));
  }

  function leaderboardHtml(rows,title='Leaderboard'){
    if(!rows.length)return `<section class="mini-card"><h3>${esc(title)}</h3><div class="empty-mini">No points yet.</div></section>`;
    return `<section class="mini-card"><h3>${esc(title)}</h3><div class="leaderboard">${rows.slice(0,12).map((r,i)=>`<div class="leader-row"><span class="rank">${i+1}</span><span class="name">${esc(r.nickname)}</span><span class="correct-count">${r.correct} ✓</span><strong>${r.points}</strong></div>`).join('')}</div></section>`;
  }

  function roundStandings(run,round){
    const totals=new Map();if(!run||round.mode!=='SCORED')return[];
    run.sessions.forEach(s=>{const q=s.question;if(!q||!q.correctAnswer)return;acceptedFor(s).forEach(a=>{if(norm(a.answer)!==norm(q.correctAnswer))return;const r=totals.get(a.studentId)||{nickname:a.nickname,points:0,correct:0};r.points+=1000;r.correct++;totals.set(a.studentId,r);});});
    return [...totals.values()].sort((a,b)=>b.points-a.points||b.correct-a.correct||a.nickname.localeCompare(b.nickname));
  }

  function controls(round,run,t){
    const pending=state.pending?.type,locked=!presenterUnlocked();
    return `<div class="presenter-controls"><button id="roundStart" class="primary control" ${locked||run||pending==='START'?'disabled':''}>${pending==='START'?'STARTING…':'START ROUND'}</button><button id="roundEnd" class="secondary control" ${locked||!run||t?.state!=='OPEN'||pending==='END'?'disabled':''}>${pending==='END'?'ENDING…':'END NOW'}</button><button id="roundReset" class="ghost control" ${locked||!run||pending==='RESET'?'disabled':''}>${pending==='RESET'?'RESETTING…':'RESET / PREPARE NEXT'}</button></div>`;
  }

  async function startRound(round,questions){
    if(!questions.length)return;
    const runId=makeId('rnd'); state.pending={type:'START',runId,at:Date.now()};
    const realDuration=round.mode==='PULSE'?0:round.duration;
    await Promise.all(questions.map((q,index)=>submitPresenterEvent({
      type:'START',sessionId:makeId('ses'),questionId:q.id,questionType:q.type,
      duration:HUGE_DURATION,correctAnswer:round.mode==='SCORED'?q.correctAnswer:'',launchSource:'Presenter · Round',
      roundId:round.id,roundRunId:runId,roundMode:round.mode,roundDuration:realDuration,roundIndex:index,roundQuestionCount:questions.length
    })));
  }

  async function endRun(run){
    if(!run)return;state.pending={type:'END',runId:run.id,at:Date.now()};
    await Promise.all(run.sessions.filter(s=>!s.end).map(s=>submitPresenterEvent({type:'END',sessionId:s.start.sessionId,questionId:s.start.questionId,roundId:s.start.roundId,roundRunId:s.start.roundRunId})));
  }

  async function resetRun(run){
    if(!run)return;state.pending={type:'RESET',runId:run.id,at:Date.now()};
    await Promise.all(run.sessions.filter(s=>!s.reset).map(s=>submitPresenterEvent({type:'RESET',sessionId:s.start.sessionId,questionId:s.start.questionId,roundId:s.start.roundId,roundRunId:s.start.roundRunId})));
  }

  function reconcilePending(run){
    const p=state.pending;if(!p)return;
    if((p.type==='START'&&run?.id===p.runId)||(p.type==='END'&&run&&timing(state.round,run).state==='CLOSED')||(p.type==='RESET'&&!run)||Date.now()-p.at>15000)state.pending=null;
  }

  function bindPresenter(round,questions,run,t){
    const a=document.getElementById('roundStart'),b=document.getElementById('roundEnd'),c=document.getElementById('roundReset');
    if(a&&!a.disabled)a.onclick=async()=>{try{await startRound(round,questions);}catch(e){state.pending=null;alert(`Could not start round: ${e.message}`);}};
    if(b&&!b.disabled)b.onclick=async()=>{try{await endRun(run);}catch(e){state.pending=null;alert(`Could not end round: ${e.message}`);}};
    if(c&&!c.disabled)c.onclick=async()=>{try{await resetRun(run);}catch(e){state.pending=null;alert(`Could not reset round: ${e.message}`);}};
  }

  function presenterRoundSignature(round,questions,run){
    if(!run)return [round.id,'READY',presenterUnlocked()?'AUTH':'LOCKED',state.pending?.type||''].join('|');
    const t=timing(round,run);
    const answers=questions.map(q=>{
      const s=roundSessionFor(run,q.id);
      return `${q.id}:${acceptedFor(s).map(a=>`${a.studentId}:${a.answer}`).join('¦')}`;
    }).join('||');
    return [round.id,run.id,t.state,presenterUnlocked()?'AUTH':'LOCKED',answers,state.pending?.type||''].join('||');
  }

  function setRoundPresenterHtml(round,run,html){
    const key=`${round.id}|${run?.id||'prepared'}`;
    const same=state.lastPresenterRoundKey===key;
    const y=same?window.scrollY:0;
    const oldStage=same?document.querySelector('#app .round-stage'):null;
    const stageY=oldStage?oldStage.scrollTop:0;
    state.roundRoot.innerHTML=html;
    state.lastPresenterRoundKey=key;
    if(same){
      requestAnimationFrame(()=>{
        if(state.lastPresenterRoundKey!==key)return;
        if(y>0)window.scrollTo(0,y);
        const stage=document.querySelector('#app .round-stage');
        if(stage&&stageY>0)stage.scrollTop=stageY;
      });
    }
  }

  function renderPrepared(round,questions){
    const mode=round.mode==='PULSE'?'UNTIMED · NO POINTS':`${round.duration}s · ${questions.length} QUESTIONS · SCORED`;
    const side=round.mode==='PULSE'?`<aside class="side-panel"><section class="mini-card"><h3>Class pulse</h3><p>No correct/wrong answers. Students move through all interactions; close it with END NOW.</p></section></aside>`:`<aside class="side-panel"><section class="mini-card"><h3>Scoring</h3><p>1,000 points per correct answer. One common timer for the whole round.</p></section></aside>`;
    setRoundPresenterHtml(round,null,shell(`${controls(round,null,null)}<div class="presenter-grid"><section class="stage-card prepared-card"><div class="big-ready">READY</div><p>${esc(mode)}</p><div class="round-question-list">${questions.map((q,i)=>`<span>${i+1}. ${esc(q.id)}</span>`).join('')}</div><p class="cue">${esc(round.notes)}</p></section>${side}</div>`,{kicker:`PRESENTER · ROUND ${round.id}`,title:round.label}));
    bindPresenter(round,questions,null,null);
  }

  function renderPresenter(round,questions,run,events,registrations){
    const t=timing(round,run);reconcilePending(run);
    if(!run)return renderPrepared(round,questions);
    if(round.mode==='SCORED'&&t.state==='CLOSED'&&!Number.isFinite(run.explicitEndMs)&&!state.autoEnding.has(run.id)){
      state.autoEnding.add(run.id);endRun(run).catch(()=>{});
    }
    const closed=t.state==='CLOSED',stats=participantStats(run,questions.length);
    const timer=round.mode==='PULSE'?'<div class="round-untimed">UNTIMED · OPEN UNTIL END NOW</div>':`<div class="timer"><span class="timer-value" data-round-deadline="${run.deadline}">${Math.max(0,Math.ceil(t.remainingMs/1000))}</span><span class="timer-unit">s</span></div>`;
    const results=questions.map((q,index)=>{const s=roundSessionFor(run,q.id);const body=q.type==='POLL'?renderPollMini(s,q,closed,round.mode==='SCORED'):renderCloudMini(acceptedFor(s));return `<section class="round-result-card"><div class="round-result-head"><div><small>${index+1}/${questions.length} · ${esc(q.id)}</small><h3>${esc(q.question)}</h3></div><strong>${acceptedFor(s).length}</strong></div>${body}</section>`;}).join('');
    const side=round.mode==='PULSE'?`<aside class="side-panel"><section class="mini-card"><h3>Class pulse</h3><p><strong>${stats.participants}</strong> participating · <strong>${stats.complete}</strong> completed all ${questions.length}.</p><p>No points and no correct/wrong reveal.</p></section></aside>`:`<aside class="side-panel">${leaderboardHtml(roundStandings(run,round),'This round')}${leaderboardHtml(buildLeaderboard(events,registrations),'Overall leaderboard')}</aside>`;
    setRoundPresenterHtml(round,run,shell(`${controls(round,run,t)}<div class="presenter-status-row">${timer}<div class="response-count"><strong>${stats.complete}</strong><span>COMPLETE</span></div><div class="response-count"><strong>${stats.participants}</strong><span>PLAYING</span></div><div class="state-pill ${closed?'closed':'open'}">${closed?'CLOSED':'OPEN'}</div></div><div class="presenter-grid round-presenter-grid"><section class="stage-card round-stage">${results}</section>${side}</div>`,{kicker:`PRESENTER · ROUND ${round.id}`,title:round.label}));
    bindPresenter(round,questions,run,t);
  }

  function studentRoundSignature(round,questions,run){
    const sid=getStudentId(),t=timing(round,run);
    if(!run)return [round.id,'READY',sid].join('|');
    const sessions=questions.map(q=>({q,s:roundSessionFor(run,q.id)})).filter(x=>x.s);
    const doneCount=sessions.filter(x=>hasAnswered(x.s,sid)).length;
    const current=sessions.find(x=>!hasAnswered(x.s,sid));
    return [round.id,run.id,t.state,doneCount,current?current.q.id:'DONE',sid].join('|');
  }

  function renderStudent(round,questions,run){
    const sid=getStudentId(),nickname=getNickname(),t=timing(round,run);
    if(!run){state.roundRoot.innerHTML=shell(`<section class="status-panel"><div class="status-icon ready">●</div><h2>Round ready</h2><p>Wait for the instructor to start.</p></section>`,{identity:nickname,kicker:round.mode==='PULSE'?'CLASS PULSE':'ROUND READY',title:round.label});return;}
    const sessions=questions.map(q=>({q,s:roundSessionFor(run,q.id)})).filter(x=>x.s);
    const doneCount=sessions.filter(x=>hasAnswered(x.s,sid)).length;
    const current=sessions.find(x=>!hasAnswered(x.s,sid));
    const timer=round.mode==='PULSE'?'':`<div class="timer"><span class="timer-value" data-round-deadline="${run.deadline}">${Math.max(0,Math.ceil(t.remainingMs/1000))}</span><span class="timer-unit">s</span></div>`;
    if(t.state==='CLOSED'){
      state.roundRoot.innerHTML=shell(`${timer}<section class="status-panel compact"><div class="status-icon">■</div><h2>${round.mode==='PULSE'?'Pulse closed':'Round closed'}</h2><p>${doneCount}/${questions.length} completed.</p></section>`,{identity:nickname,kicker:`${round.id} · CLOSED`,title:round.label});return;
    }
    if(!current){
      state.roundRoot.innerHTML=shell(`${timer}<section class="status-panel compact"><div class="status-icon success">✓</div><h2>${round.mode==='PULSE'?'Thanks — pulse complete':'Round complete'}</h2><p>${questions.length}/${questions.length} completed. ${round.mode==='SCORED'?'Your answers are locked in.':'Wait for the class to finish.'}</p></section>`,{identity:nickname,kicker:`${round.id} · COMPLETE`,title:round.label});return;
    }
    const q=current.q,s=current.s,key=s.start.sessionId;
    let interaction='';
    if(q.type==='POLL'){
      const selected=state.selected.get(key)||'';
      interaction=`<div class="options">${q.options.map(o=>`<button class="option ${selected===o?'selected':''}" type="button" data-answer="${esc(o)}">${esc(o)}</button>`).join('')}</div><button id="roundSubmit" class="primary" ${selected?'':'disabled'}>SUBMIT & NEXT</button>`;
    } else {
      const draft=state.drafts.get(key)||'';
      interaction=`<input id="roundOpen" class="text-answer" maxlength="40" autocomplete="off" placeholder="Write one word or a short phrase" value="${esc(draft)}"><div class="round-input-help">One word or short phrase · maximum 40 characters</div><button id="roundSubmit" class="primary" ${draft.trim()?'':'disabled'}>SUBMIT & NEXT</button>`;
    }
    const pos=questions.findIndex(x=>x.id===q.id)+1;
    state.roundRoot.innerHTML=shell(`${timer}<div class="round-progress"><div style="width:${doneCount/questions.length*100}%"></div></div><div class="round-progress-label">${round.mode==='PULSE'?'CLASS PULSE':'ROUND'} · ${pos} OF ${questions.length}</div><section class="student-card live-card">${interaction}</section>`,{identity:nickname,kicker:`${q.id} · ${round.mode==='PULSE'?'YOUR EXPERIENCE':'SCORED'}`,title:q.question});
    document.querySelectorAll('#app .option').forEach(btn=>btn.onclick=()=>{state.selected.set(key,btn.dataset.answer);renderStudent(round,questions,run);});
    const input=document.getElementById('roundOpen');if(input)input.oninput=()=>{state.drafts.set(key,input.value.slice(0,40));const b=document.getElementById('roundSubmit');if(b)b.disabled=!input.value.trim();};
    const submit=document.getElementById('roundSubmit');if(submit)submit.onclick=async()=>{
      if(submit.disabled||timing(round,run).state!=='OPEN')return;
      const answer=q.type==='POLL'?(state.selected.get(key)||''):(state.drafts.get(key)||'').trim();if(!answer)return;
      submit.disabled=true;submit.textContent='SUBMITTING…';
      try{await submitEvent({type:'ANSWER',sessionId:key,questionId:q.id,studentId:sid,matricola:sid,nickname,browserId:browserId(),answer,roundId:round.id,roundRunId:run.id});localStorage.setItem(`bdaLive.submitted.${key}`,'1');renderStudent(round,questions,run);}catch(e){submit.disabled=false;submit.textContent='SUBMIT & NEXT';alert(`Could not submit: ${e.message}`);}
    };
  }

  function injectStyles(){
    if(document.getElementById('bda-round-styles'))return;const s=document.createElement('style');s.id='bda-round-styles';s.textContent=`
      .round-question-list{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:16px 0}.round-question-list span{background:#f4f4f4;border-radius:999px;padding:7px 11px;font-weight:850}
      .round-untimed{font-weight:950;letter-spacing:.08em;padding:14px 18px;border-radius:14px;background:#f4f4f4}.round-progress{height:8px;background:#eee;border-radius:99px;overflow:hidden;margin:0 0 8px}.round-progress>div{height:100%;background:var(--red);transition:width .2s ease}.round-progress-label{text-align:right;font-size:12px;font-weight:900;letter-spacing:.08em;color:var(--muted);margin-bottom:12px}
      .round-stage{display:grid;gap:14px;max-height:62vh;overflow:auto}.round-result-card{border:1px solid #e4e4e4;border-radius:16px;padding:16px;background:#fff}.round-result-head{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start;margin-bottom:12px}.round-result-head small{font-weight:900;color:var(--red);letter-spacing:.06em}.round-result-head h3{margin:4px 0 0;font-size:18px;line-height:1.2}.round-result-head>strong{font-size:22px;color:var(--red)}
      .round-poll{display:grid;gap:8px}.round-poll-row>div:first-child{display:flex;justify-content:space-between;gap:16px;font-size:13px}.round-poll-row strong{white-space:nowrap}.round-cloud{min-height:100px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 18px;padding:8px}.round-cloud span{font-weight:950;line-height:1}.round-cloud sup{font-size:.35em;color:var(--muted);margin-left:2px}.round-empty{padding:24px;text-align:center;color:var(--muted)}
      .round-input-help{margin:8px 2px 12px;color:var(--muted);font-size:13px;font-weight:700}.round-presenter-grid .side-panel{align-self:start}
      @media(max-width:900px){.round-stage{max-height:none}.round-result-head h3{font-size:16px}.round-untimed{font-size:13px}}
    `;document.head.appendChild(s);
  }

  async function poll(forcedActiveId){
    if(state.busy)return;state.busy=true;
    try{
      const activeId=String(forcedActiveId||state.previewActiveId||await loadActiveId()).trim();state.activeId=activeId;
      if(!isRoundId(activeId)){restoreBase();return;}
      const [rounds,questions,events]=await Promise.all([loadRounds(),loadQuestions(),loadEvents()]);
      const rid=roundIdFrom(activeId),round=rounds.get(rid);if(!round){restoreBase();return;}
      const regs=buildRegistrations(events);
      if(VIEW==='student'&&!registrationConfirmed(regs)){restoreBase();return;}
      if(!ensureRootSwap())return;
      const qs=roundQuestions(round,questions),run=groupLatestRun(round,qs,events,regs);
      state.round=round;state.questions=qs;state.events=events;state.registrations=regs;state.run=run;
      reconcilePending(run);
      if(!qs.length){state.roundRoot.innerHTML=shell('<section class="status-panel"><h2>No questions assigned to this round</h2><p>Edit the Round column in BDA LIVE Config.</p></section>',{kicker:`ROUND ${round.id}`,title:round.label});return;}
      if(VIEW==='present'){
        const sig=presenterRoundSignature(round,qs,run);
        if(sig!==state.lastPresenterSignature){
          state.lastPresenterSignature=sig;
          renderPresenter(round,qs,run,events,regs);
        }
      }else{
        const sig=studentRoundSignature(round,qs,run);
        if(sig!==state.lastStudentSignature){
          state.lastStudentSignature=sig;
          renderStudent(round,qs,run);
        }
      }
    }catch(e){if(state.swapped&&state.roundRoot)state.roundRoot.innerHTML=shell(`<section class="status-panel error-panel"><h2>Round connection problem</h2><p>${esc(e.message)}</p><p>The page will retry automatically.</p></section>`,{kicker:'BDA LIVE ROUND'});console.warn('BDA rounds:',e);}
    finally{state.busy=false;}
  }

  function tick(){
    document.querySelectorAll('#app [data-round-deadline]').forEach(el=>{const d=Number(el.dataset.roundDeadline);if(Number.isFinite(d))el.textContent=String(Math.max(0,Math.ceil((d-Date.now())/1000)));});
  }

  if(VIEW==='present'){
    window.addEventListener('bda-presenter-active-preview',event=>{
      const value=String(event?.detail?.value||'').trim();
      state.previewActiveId=value;
      if(isRoundId(value)){
        state.lastPresenterSignature='';
        state.lastPresenterRoundKey='';
        if(ensureRootSwap()){
          state.roundRoot.innerHTML=shell('<section class="status-panel"><div class="spinner"></div><h2>Loading selected round…</h2></section>',{kicker:'PRESENTER · SWITCHING',title:value.replace(/^ROUND:/i,'')});
        }
        poll(value);
      }else{
        restoreBase();
      }
    });
    window.addEventListener('bda-presenter-active-confirmed',event=>{
      const value=String(event?.detail?.value||'').trim();
      if(state.previewActiveId===value)setTimeout(()=>{if(state.previewActiveId===value)state.previewActiveId='';},1800);
    });
    window.addEventListener('bda-presenter-auth-changed',()=>{
      state.lastPresenterSignature='';
      poll(state.previewActiveId||state.activeId);
    });
  }

  injectStyles();
  poll();
  setInterval(()=>poll(),VIEW==='present'?900:1300);
  setInterval(tick,250);
  window.BDA_ROUNDS_TEST={isRoundId,roundIdFrom,normalizeCloudAnswer};
})();
