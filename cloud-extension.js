(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const VIEW = new URLSearchParams(location.search).get('view') === 'present' ? 'present' : 'student';
  const state = {
    questions: null,
    questionsAt: 0,
    activeId: '',
    isCloud: false,
    sessionId: '',
    items: [],
    responseCount: 0,
    signature: '',
    busy: false
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

  function injectStyles() {
    if (document.getElementById('bda-cloud-styles')) return;
    const style = document.createElement('style');
    style.id = 'bda-cloud-styles';
    style.textContent = `
      .cloud-input-help{margin:9px 2px 0;color:var(--muted);font-size:13px;font-weight:700}
      .cloud-live-card .text-answer{font-size:22px;text-align:center;font-weight:750}
      .cloud-stage-card{min-height:430px;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .cloud-visual{width:100%;min-height:390px;display:flex;flex-wrap:wrap;align-content:center;align-items:center;justify-content:center;gap:18px 28px;padding:18px}
      .cloud-word{display:inline-flex;align-items:flex-start;gap:4px;font-weight:950;line-height:.92;letter-spacing:-.035em;white-space:nowrap;transition:font-size .28s ease,transform .28s ease;max-width:100%}
      .cloud-word:nth-child(3n+1){color:var(--red)}
      .cloud-word:nth-child(3n+2){color:var(--ink)}
      .cloud-word:nth-child(3n){color:#555}
      .cloud-word sup{font-size:.24em;line-height:1;margin-top:.1em;letter-spacing:0;color:var(--muted)}
      .cloud-frequency{display:grid;gap:7px}
      .cloud-frequency-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #e5e5e5}
      .cloud-frequency-row:last-child{border-bottom:0}
      .cloud-frequency-row span{font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .cloud-frequency-row strong{font-variant-numeric:tabular-nums;color:var(--red)}
      .cloud-empty{min-height:360px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);font-size:28px;font-weight:750}
      .cloud-prepared-note{margin-top:12px;padding:9px 13px;border-radius:999px;background:#f4f4f4;font-weight:850;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
      @media(max-width:900px){.cloud-stage-card{min-height:360px}.cloud-visual{min-height:320px}.cloud-word{max-width:92vw;white-space:normal;text-align:center}}
    `;
    document.head.appendChild(style);
  }

  function csvRows(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (c === '"') {
        if (quoted && n === '"') { cell += '"'; i++; } else quoted = !quoted;
      } else if (c === ',' && !quoted) {
        row.push(cell); cell = '';
      } else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && n === '\n') i++;
        row.push(cell);
        if (row.some(v => v !== '')) rows.push(row);
        row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) {
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
    }
    return rows;
  }

  function parseEvent(raw) {
    const payload = String(raw || '').trim();
    const prefix = `${CFG.protocolPrefix || 'BDA1'}|||`;
    if (!payload.startsWith(prefix)) return null;
    try { return JSON.parse(decodeURIComponent(payload.slice(prefix.length))); }
    catch (_) { return null; }
  }

  function parseTimestamp(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})[.:](\d{2})(?:[.,](\d{1,3}))?$/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6], +((m[7] || '0').padEnd(3,'0'))).getTime();
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function withBust(url) {
    const u = new URL(url, location.href);
    u.searchParams.set('_cloud', `${Date.now()}-${Math.random().toString(36).slice(2,7)}`);
    return u.toString();
  }

  async function fetchText(url) {
    const r = await fetch(withBust(url), {cache:'no-store'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }

  async function loadQuestions() {
    if (state.questions && Date.now() - state.questionsAt < 30000) return state.questions;
    const map = new Map();
    csvRows(await fetchText(CFG.questionsCsv)).forEach(row => {
      const id = String(row[0] || '').trim();
      if (!id) return;
      map.set(id, {
        id,
        type:String(row[2] || '').trim().toUpperCase().replace(/[ -]+/g,'_'),
        question:String(row[3] || '').trim()
      });
    });
    state.questions = map;
    state.questionsAt = Date.now();
    return map;
  }

  async function loadActiveId() {
    const rows = csvRows(await fetchText(CFG.controlCsv));
    return String((rows[0] && rows[0][1]) || '').trim();
  }

  function normalizeCloudAnswer(value) {
    let display = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ');
    display = display.replace(/^[\s.,;:!?"'“”‘’()[\]{}]+|[\s.,;:!?"'“”‘’()[\]{}]+$/g,'').trim();
    let normalized = display.replace(/[-‐‑‒–—]+/g,' ').replace(/\s+/g,' ').toLocaleLowerCase();
    return {display, normalized};
  }

  function fontSize(count, minCount, maxCount) {
    if (maxCount <= minCount) return 44;
    const a = Math.sqrt(minCount), b = Math.sqrt(maxCount), x = Math.sqrt(count);
    return Math.round(28 + ((x-a)/(b-a))*68);
  }

  function rotationFor(text) {
    let h = 0;
    for (const ch of text) h = ((h << 5) - h + ch.codePointAt(0)) | 0;
    return [-4, 0, 4][Math.abs(h) % 3];
  }

  async function aggregateSession(sessionId) {
    const rows = csvRows(await fetchText(CFG.responsesCsv));
    const tsCol = Number.isInteger(CFG.responseTimestampColumn) ? CFG.responseTimestampColumn : 0;
    const payloadCol = Number.isInteger(CFG.combinedResponseColumn) ? CFG.combinedResponseColumn : 1;
    const events = rows.slice(1).map((row,index) => {
      const event = parseEvent(row[payloadCol]);
      if (!event) return null;
      return {...event, receiptMs:parseTimestamp(row[tsCol]), rowIndex:index+2};
    }).filter(Boolean);

    const registrations = events.filter(e => e.type === 'REGISTER' && e.studentId && e.nickname);
    const studentOwners = new Map(), nicknameOwners = new Map();
    registrations.forEach(e => {
      const sid = String(e.matricola || e.studentId || '').trim();
      const nk = norm(e.nickname);
      if (sid && !studentOwners.has(sid)) studentOwners.set(sid,e);
      if (nk && !nicknameOwners.has(nk)) nicknameOwners.set(nk,e);
    });

    const start = events.find(e => e.type === 'START' && e.sessionId === sessionId);
    if (!start || !Number.isFinite(start.receiptMs)) return {items:[], responseCount:0};
    const duration = Number(start.duration) > 0 ? Number(start.duration) : (CFG.defaultCloudSeconds || 30);
    const timeoutMs = start.receiptMs + duration * 1000;
    const end = events.find(e => e.type === 'END' && e.sessionId === sessionId && Number.isFinite(e.receiptMs) && e.receiptMs >= start.receiptMs);
    const endMs = Math.min(timeoutMs, end ? end.receiptMs : Infinity);

    const seen = new Set();
    const accepted = [];
    events.forEach(e => {
      if (e.type !== 'ANSWER' || e.sessionId !== sessionId || !e.studentId) return;
      const sid = String(e.matricola || e.studentId).trim();
      if (!sid || seen.has(sid)) return;
      if (!Number.isFinite(e.receiptMs) || e.receiptMs < start.receiptMs || e.receiptMs > endMs) return;
      const sOwner = studentOwners.get(sid), nOwner = nicknameOwners.get(norm(e.nickname));
      if (!sOwner || !nOwner) return;
      if (String(sOwner.matricola || sOwner.studentId).trim() !== sid) return;
      if (String(nOwner.matricola || nOwner.studentId).trim() !== sid) return;
      if (norm(sOwner.nickname) !== norm(e.nickname)) return;
      seen.add(sid);
      accepted.push(e);
    });

    const grouped = new Map();
    accepted.forEach(e => {
      const n = normalizeCloudAnswer(e.answer);
      if (!n.normalized) return;
      const row = grouped.get(n.normalized) || {normalized:n.normalized,text:n.display,count:0};
      row.count += 1;
      grouped.set(n.normalized,row);
    });
    const items = [...grouped.values()].sort((a,b) => b.count-a.count || a.text.localeCompare(b.text));
    return {items, responseCount:accepted.length};
  }

  function renderCloud(items) {
    if (!items.length) return '<div class="cloud-empty">Waiting for words…</div>';
    const minCount = Math.min(...items.map(x=>x.count));
    const maxCount = Math.max(...items.map(x=>x.count));
    return `<div class="cloud-visual">${items.map(item => {
      const size = fontSize(item.count,minCount,maxCount);
      const rot = rotationFor(item.normalized);
      return `<span class="cloud-word" style="font-size:${size}px;transform:rotate(${rot}deg)" title="${item.count} response${item.count===1?'':'s'}">${esc(item.text)}${item.count>1?`<sup>${item.count}</sup>`:''}</span>`;
    }).join('')}</div>`;
  }

  function renderFrequency(items) {
    if (!items.length) return '<div class="empty-mini">No responses yet.</div>';
    return `<div class="cloud-frequency">${items.slice(0,10).map(item=>`<div class="cloud-frequency-row"><span>${esc(item.text)}</span><strong>${item.count}</strong></div>`).join('')}</div>`;
  }

  function patchStudent() {
    if (!state.isCloud) return;
    const input = document.getElementById('openAnswer');
    if (!input) return;
    input.maxLength = 40;
    input.placeholder = 'Write one word or a short phrase';
    input.setAttribute('aria-label','One word or short phrase');
    const card = input.closest('.student-card');
    if (card) card.classList.add('cloud-live-card');
    if (input.value.length > 40) {
      input.value = input.value.slice(0,40);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    if (card && !card.querySelector('.cloud-input-help')) {
      const help = document.createElement('div');
      help.className = 'cloud-input-help';
      help.textContent = 'One word or short phrase · maximum 40 characters';
      input.insertAdjacentElement('afterend',help);
    }
  }

  function patchPresenter() {
    if (!state.isCloud) return;
    const timer = document.querySelector('.timer-value[data-session-id]');
    if (!timer) {
      const prepared = document.querySelector('.prepared-card');
      if (prepared && !prepared.querySelector('.cloud-prepared-note')) {
        const note = document.createElement('div');
        note.className = 'cloud-prepared-note';
        note.textContent = 'Live word cloud · no points';
        prepared.appendChild(note);
      }
      return;
    }
    if (!state.sessionId || timer.dataset.sessionId !== state.sessionId) return;
    const stage = document.querySelector('.presenter-grid .stage-card');
    if (!stage) return;
    const sig = `${state.sessionId}|${state.responseCount}|${state.items.map(x=>`${x.normalized}:${x.count}`).join(',')}`;
    if (stage.dataset.cloudSignature !== sig) {
      stage.dataset.cloudSignature = sig;
      stage.classList.add('cloud-stage-card');
      stage.innerHTML = renderCloud(state.items);
    }
    const side = document.querySelector('.presenter-grid .side-panel');
    if (side) {
      let card = side.querySelector('#cloudFrequencyCard');
      if (!card) {
        card = document.createElement('section');
        card.id = 'cloudFrequencyCard';
        card.className = 'mini-card';
        side.prepend(card);
      }
      card.innerHTML = `<h3>Word frequency</h3>${renderFrequency(state.items)}`;
    }
  }

  function patchDom() {
    if (VIEW === 'student') patchStudent();
  }

  async function poll() {
    if (state.busy) return;
    state.busy = true;
    try {
      const [activeId, questions] = await Promise.all([loadActiveId(), loadQuestions()]);
      state.activeId = activeId;
      const q = questions.get(activeId);
      state.isCloud = !!q && ['CLOUD','WORDCLOUD','WORD_CLOUD'].includes(q.type);
      if (!state.isCloud) {
        state.sessionId = '';
        state.items = [];
        state.responseCount = 0;
        patchDom();
        return;
      }
      const timer = document.querySelector('.timer-value[data-session-id]');
      const sessionId = timer ? String(timer.dataset.sessionId || '') : '';
      state.sessionId = sessionId;
      if (VIEW === 'present' && sessionId) {
        const data = await aggregateSession(sessionId);
        state.items = data.items;
        state.responseCount = data.responseCount;
        const counter = document.querySelector('.response-count strong');
        if (counter) counter.textContent = String(data.responseCount);
      }
      patchDom();
    } catch (error) {
      console.warn('BDA LIVE cloud extension:', error.message);
    } finally {
      state.busy = false;
    }
  }

  injectStyles();
  if (VIEW === 'student') {
    const observer = new MutationObserver(() => queueMicrotask(patchDom));
    observer.observe(document.body,{childList:true,subtree:true});
    poll();
    setInterval(poll, 1400);
  }
  window.BDA_CLOUD_TEST = {normalizeCloudAnswer,fontSize};
})();
