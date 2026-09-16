(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const VIEW = new URLSearchParams(location.search).get('view') === 'present' ? 'present' : 'student';
  const state = { questions:null, questionsAt:0, activeId:'', question:null, busy:false };

  function csvRows(text) {
    const rows=[]; let row=[], cell='', quoted=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i], n=text[i+1];
      if (c==='"') { if (quoted && n==='"') { cell+='"'; i++; } else quoted=!quoted; }
      else if (c===',' && !quoted) { row.push(cell); cell=''; }
      else if ((c==='\n' || c==='\r') && !quoted) {
        if (c==='\r' && n==='\n') i++;
        row.push(cell); if (row.some(v=>v!=='')) rows.push(row); row=[]; cell='';
      } else cell+=c;
    }
    if (cell || row.length) { row.push(cell); if (row.some(v=>v!=='')) rows.push(row); }
    return rows;
  }

  function withBust(url) {
    const u=new URL(url,location.href);
    u.searchParams.set('_l0',`${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
    return u.toString();
  }

  async function fetchText(url) {
    const r=await fetch(withBust(url),{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  async function loadQuestions() {
    if(state.questions && Date.now()-state.questionsAt<30000) return state.questions;
    const map=new Map();
    csvRows(await fetchText(CFG.questionsCsv)).forEach(row=>{
      const id=String(row[0]||'').trim();
      if(!id) return;
      map.set(id,{
        id,
        week:String(row[1]||'').trim(),
        type:String(row[2]||'').trim().toUpperCase(),
        correct:String(row[5]||'').trim()
      });
    });
    state.questions=map; state.questionsAt=Date.now(); return map;
  }

  async function loadActiveId() {
    const rows=csvRows(await fetchText(CFG.controlCsv));
    return String((rows[0]&&rows[0][1])||'').trim();
  }

  function isLecture0Diagnostic(q) {
    return !!q && q.week==='Lecture 0' && /^Q0(?:[B-F])?$/.test(q.id) && !q.correct;
  }

  function injectStyles() {
    if(document.getElementById('bda-l0-styles')) return;
    const style=document.createElement('style');
    style.id='bda-l0-styles';
    style.textContent=`
      body.bda-l0-diagnostic .timer{display:none!important}
      body.bda-l0-diagnostic .diagnostic-hide{display:none!important}
      body.bda-l0-diagnostic .diagnostic-badge{display:inline-flex;align-items:center;gap:7px;margin-top:14px;padding:9px 14px;border-radius:999px;background:#f3f3f3;color:#444;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
      body.bda-l0-diagnostic .diagnostic-student-note{margin:13px 2px 0;color:var(--muted);font-size:13px;font-weight:800;text-align:center}
      body.bda-l0-diagnostic .diagnostic-pulse .option{font-weight:750}
      body.bda-l0-diagnostic .diagnostic-pulse .option.selected{background:#fff2f3}
    `;
    document.head.appendChild(style);
  }

  function clearPatch() {
    document.body.classList.remove('bda-l0-diagnostic');
    document.querySelectorAll('.diagnostic-hide').forEach(el=>el.classList.remove('diagnostic-hide'));
    document.querySelectorAll('.diagnostic-badge,.diagnostic-student-note').forEach(el=>el.remove());
    const grid=document.querySelector('.presenter-grid');
    if(grid && grid.dataset.l0Grid==='1') { grid.style.gridTemplateColumns=''; delete grid.dataset.l0Grid; }
    document.querySelectorAll('.diagnostic-pulse').forEach(el=>el.classList.remove('diagnostic-pulse'));
  }

  function patchPresenter(q) {
    const prepared=document.querySelector('.prepared-card');
    if(prepared) {
      const meta=[...prepared.querySelectorAll(':scope > p')].find(p=>p.textContent.includes('·'));
      if(meta) meta.textContent=q.type==='CLOUD' ? 'UNTIMED · WORD CLOUD · NO POINTS' : 'UNTIMED · CLASS PULSE · NO RIGHT / WRONG';
      if(!prepared.querySelector('.diagnostic-badge')) {
        const badge=document.createElement('div');
        badge.className='diagnostic-badge';
        badge.textContent='Open until you press END';
        prepared.appendChild(badge);
      }
      const grid=document.querySelector('.presenter-grid');
      const side=grid?.querySelector(':scope > .side-panel');
      if(grid && side) { side.classList.add('diagnostic-hide'); grid.style.gridTemplateColumns='1fr'; grid.dataset.l0Grid='1'; }
    }

    document.querySelectorAll('h3').forEach(h=>{
      if(h.textContent.trim().toLowerCase()!=='leaderboard') return;
      const card=h.closest('.mini-card');
      if(card) card.classList.add('diagnostic-hide');
      else {
        h.classList.add('diagnostic-hide');
        const next=h.nextElementSibling;
        if(next?.classList.contains('leaderboard')) next.classList.add('diagnostic-hide');
      }
    });

    const pill=document.querySelector('.state-pill.open');
    if(pill) pill.textContent='OPEN · UNTIL END';
  }

  function patchStudent(q) {
    const card=document.querySelector('.student-card.live-card');
    if(!card) return;
    if(q.type==='POLL') card.classList.add('diagnostic-pulse');
    if(!card.querySelector('.diagnostic-student-note')) {
      const note=document.createElement('div');
      note.className='diagnostic-student-note';
      note.textContent=q.type==='CLOUD' ? 'No right or wrong answer · one word or short phrase' : 'No right or wrong answer · choose what best describes you';
      card.appendChild(note);
    }
  }

  function patchDom() {
    const q=state.question;
    if(!isLecture0Diagnostic(q)) { clearPatch(); return; }
    document.body.classList.add('bda-l0-diagnostic');
    if(VIEW==='present') patchPresenter(q); else patchStudent(q);
  }

  async function refresh() {
    if(state.busy) return;
    state.busy=true;
    try {
      const [activeId,questions]=await Promise.all([loadActiveId(),loadQuestions()]);
      state.activeId=activeId;
      state.question=questions.get(activeId)||null;
      patchDom();
    } catch(error) {
      console.warn('BDA LIVE Lecture 0 extension:',error.message);
    } finally { state.busy=false; }
  }

  injectStyles();
  const observer=new MutationObserver(()=>queueMicrotask(patchDom));
  observer.observe(document.body,{childList:true,subtree:true});
  refresh();
  setInterval(refresh,VIEW==='present'?900:1400);
})();
