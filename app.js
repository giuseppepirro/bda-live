(() => {
  'use strict';

  const CFG = window.BDA_CONFIG || {};
  const VIEW = new URLSearchParams(location.search).get('view') === 'present' ? 'present' : 'student';
  const STORAGE = {
    matricola: 'bdaLive.matricola.v1',
    nickname: 'bdaLive.nickname.v1',
    browserId: 'bdaLive.browserId.v1',
    registerAttempt: 'bdaLive.registerAttempt.v2'
  };

  const ui = {
    root: document.getElementById('app'),
    selectedBySession: new Map(),
    draftBySession: new Map(),
    lastStudentSignature: '',
    pendingAction: null,
    lastModel: null,
    lastTimerState: null,
    refreshBusy: false,
    forceStudentRender: true,
    lastPresenterSignature: '',
    lastPresenterViewKey: ''
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  const norm = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function makeId(prefix) {
    const uuid = crypto && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${uuid}`;
  }

  function getBrowserId() {
    let id = localStorage.getItem(STORAGE.browserId);
    if (!id) {
      id = makeId('browser');
      localStorage.setItem(STORAGE.browserId, id);
    }
    return id;
  }

  const getMatricola = () => (localStorage.getItem(STORAGE.matricola) || '').trim();
  const getNickname = () => (localStorage.getItem(STORAGE.nickname) || '').trim();

  function setIdentity(matricola, nickname) {
    localStorage.setItem(STORAGE.matricola, matricola.trim());
    localStorage.setItem(STORAGE.nickname, nickname.trim());
    localStorage.removeItem(STORAGE.registerAttempt);
  }

  function clearIdentity() {
    localStorage.removeItem(STORAGE.matricola);
    localStorage.removeItem(STORAGE.nickname);
    localStorage.removeItem(STORAGE.registerAttempt);
  }

  function withBust(url) {
    const u = new URL(url, location.href);
    u.searchParams.set('_bda', `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    return u.toString();
  }

  async function fetchText(url) {
    const r = await fetch(withBust(url), {cache: 'no-store'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
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

  function splitOptions(raw) {
    return String(raw || '').split('|').map(v => v.trim()).filter(Boolean);
  }

  function normalizeType(raw) {
    const value = String(raw || 'OPEN').trim().toUpperCase().replace(/[ -]+/g, '_');
    if (['POLL','MCQ','MULTIPLE_CHOICE','MULTIPLECHOICE','QUIZ'].includes(value)) return 'POLL';
    if (['WORDCLOUD','WORD_CLOUD','CLOUD'].includes(value)) return 'WORDCLOUD';
    return 'OPEN';
  }

  function parseTimestamp(value) {
    const s = String(value || '').trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{2})[.:](\d{2})(?:[.,](\d{1,3}))?$/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1], +m[4], +m[5], +m[6], +((m[7] || '0').padEnd(3,'0'))).getTime();
    const parsed = Date.parse(s);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function parseEvent(raw) {
    const payload = String(raw || '').trim();
    if (!payload) return null;
    const prefix = `${CFG.protocolPrefix || 'BDA1'}|||`;
    if (payload.startsWith(prefix)) {
      try {
        const event = JSON.parse(decodeURIComponent(payload.slice(prefix.length)));
        return event && event.type ? event : null;
      } catch (_) {
        return {type: 'MALFORMED', raw: payload};
      }
    }
    const legacy = payload.match(/^(Q\d+)\|\|\|(.*)$/s);
    return legacy ? {type:'LEGACY_ANSWER', questionId:legacy[1], answer:legacy[2]} : null;
  }

  function encodeEvent(event) {
    return `${CFG.protocolPrefix || 'BDA1'}|||${encodeURIComponent(JSON.stringify(event))}`;
  }

  async function submitEvent(event) {
    const body = new URLSearchParams();
    body.append(CFG.formEntry, encodeEvent({v:2, ...event}));
    await fetch(CFG.formAction, {
      method: 'POST', mode: 'no-cors', cache: 'no-store',
      headers: {'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body
    });
  }

  async function loadActiveId() {
    const rows = csvRows(await fetchText(CFG.controlCsv));
    return ((rows[0] && rows[0][1]) || '').trim();
  }

  async function loadQuestions() {
    return csvRows(await fetchText(CFG.questionsCsv)).map(row => {
      const type = normalizeType(row[2]);
      const rawDuration = Number(String(row[8] || '').replace(',', '.'));
      return {
        id: String(row[0] || '').trim(),
        week: String(row[1] || '').trim(),
        type,
        question: String(row[3] || '').trim(),
        options: splitOptions(row[4]),
        correctAnswer: String(row[5] || '').trim(),
        teachingCue: String(row[6] || '').trim(),
        source: String(row[7] || '').trim(),
        duration: Number.isFinite(rawDuration) && rawDuration > 0 ? Math.round(rawDuration) : (type === 'OPEN' ? 30 : 20)
      };
    }).filter(q => q.id && q.question);
  }

  async function loadEvents() {
    const rows = csvRows(await fetchText(CFG.responsesCsv));
    const tsCol = Number.isInteger(CFG.responseTimestampColumn) ? CFG.responseTimestampColumn : 0;
    const payloadCol = Number.isInteger(CFG.combinedResponseColumn) ? CFG.combinedResponseColumn : 1;
    return rows.slice(1).map((row, index) => {
      const raw = String(row[payloadCol] || '').trim();
      const event = parseEvent(raw);
      if (!event) return null;
      const receiptText = String(row[tsCol] || '').trim();
      return {...event, raw, receiptText, receiptMs: parseTimestamp(receiptText), rowIndex:index+2};
    }).filter(Boolean);
  }

  function eventOrder(a,b) {
    const am = Number.isFinite(a.receiptMs) ? a.receiptMs : Number.MAX_SAFE_INTEGER;
    const bm = Number.isFinite(b.receiptMs) ? b.receiptMs : Number.MAX_SAFE_INTEGER;
    return am - bm || a.rowIndex - b.rowIndex;
  }

  function deriveRegistrations(events) {
    const registrations = events
      .filter(e => e.type === 'REGISTER' && e.studentId && e.nickname)
      .filter(e => /^(hmac256|sha256):[0-9a-f]{64}$/.test(String(e.studentKey || e.identityHash || e.matricola || e.studentId || '').trim()))
      .sort(eventOrder);
    const nicknameOwners = new Map();
    const studentOwners = new Map();
    registrations.forEach(event => {
      const sid = String(event.studentKey || event.identityHash || event.matricola || event.studentId).trim();
      const nickKey = norm(event.nickname);
      if (!sid || !nickKey) return;
      if (!studentOwners.has(sid)) studentOwners.set(sid, event);
      if (!nicknameOwners.has(nickKey)) nicknameOwners.set(nickKey, event);
    });
    return {registrations, nicknameOwners, studentOwners};
  }

  function deriveSessions(events, questionMap, registrations) {
    const sessionMap = new Map();
    events.filter(e => e.type === 'START' && e.sessionId && e.questionId).sort(eventOrder).forEach(start => {
      if (sessionMap.has(start.sessionId)) return;
      const q = questionMap.get(start.questionId);
      sessionMap.set(start.sessionId, {
        sessionId:start.sessionId,
        questionId:start.questionId,
        questionType:normalizeType(start.questionType || q?.type || 'OPEN'),
        startMs:start.receiptMs,
        startRow:start.rowIndex,
        duration:Number(start.duration) > 0 ? Number(start.duration) : (q?.duration || 20),
        correctAnswer:String(start.correctAnswer ?? q?.correctAnswer ?? '').trim(),
        explicitEnd:null, resetEvent:null, answers:[], validAnswers:[], correctAnswers:[]
      });
    });

    events.filter(e => e.type === 'END' && e.sessionId).sort(eventOrder).forEach(event => {
      const s = sessionMap.get(event.sessionId);
      if (s && !s.explicitEnd && (!Number.isFinite(s.startMs) || event.receiptMs >= s.startMs)) s.explicitEnd = event;
    });
    events.filter(e => e.type === 'RESET' && e.sessionId).sort(eventOrder).forEach(event => {
      const s = sessionMap.get(event.sessionId);
      if (s && (!Number.isFinite(s.startMs) || event.receiptMs >= s.startMs)) s.resetEvent = event;
    });

    const seen = new Set();
    events.filter(e => e.type === 'ANSWER' && e.sessionId && e.studentId).sort(eventOrder).forEach(event => {
      const s = sessionMap.get(event.sessionId);
      if (!s || (event.questionId && event.questionId !== s.questionId)) return;
      const studentId = String(event.matricola || event.studentId).trim();
      const key = `${s.sessionId}::${studentId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const canonicalStudent = registrations.studentOwners.get(studentId);
      const canonicalNickname = registrations.nicknameOwners.get(norm(event.nickname));
      if (!canonicalStudent || canonicalStudent.studentId !== studentId) return;
      if (!canonicalNickname || String(canonicalNickname.matricola || canonicalNickname.studentId).trim() !== studentId) return;
      if (norm(canonicalStudent.nickname) !== norm(event.nickname)) return;

      const timeoutMs = Number.isFinite(s.startMs) ? s.startMs + s.duration * 1000 : NaN;
      const explicitEndMs = s.explicitEnd && Number.isFinite(s.explicitEnd.receiptMs) ? s.explicitEnd.receiptMs : Infinity;
      const endMs = Math.min(Number.isFinite(timeoutMs) ? timeoutMs : Infinity, explicitEndMs);
      const validTiming = Number.isFinite(event.receiptMs) && Number.isFinite(s.startMs) && event.receiptMs >= s.startMs && event.receiptMs <= endMs;
      const answer = String(event.answer || '').trim();
      const scoredQuiz = s.questionType === 'POLL' && !!s.correctAnswer;
      const correct = validTiming && scoredQuiz && norm(answer) === norm(s.correctAnswer);
      const elapsedMs = validTiming ? Math.max(0, event.receiptMs - s.startMs) : NaN;
      const points = correct ? Math.round(clamp(100 + 900 * (1 - elapsedMs / (s.duration * 1000)), 100, 1000)) : 0;
      s.answers.push({...event, studentId, nickname:String(event.nickname || '').trim(), answer, validTiming, scoredQuiz, correct, points, elapsedMs});
    });

    sessionMap.forEach(s => {
      s.validAnswers = s.answers.filter(a => a.validTiming).sort(eventOrder);
      s.correctAnswers = s.validAnswers.filter(a => a.correct).sort(eventOrder);
      let previousMs = null, rank = 0;
      s.correctAnswers.forEach((answer, index) => {
        if (previousMs === null || answer.receiptMs !== previousMs) rank = index + 1;
        answer.rank = rank;
        previousMs = answer.receiptMs;
      });
    });
    return sessionMap;
  }

  function sessionTiming(session, now = Date.now()) {
    if (!session || !Number.isFinite(session.startMs)) return {state:'PREPARED',remainingMs:0,endMs:NaN};
    const timeoutMs = session.startMs + session.duration * 1000;
    const explicitEndMs = session.explicitEnd && Number.isFinite(session.explicitEnd.receiptMs) ? session.explicitEnd.receiptMs : Infinity;
    const endMs = Math.min(timeoutMs, explicitEndMs);
    return {state:now < endMs ? 'OPEN':'CLOSED', remainingMs:Math.max(0,endMs-now), endMs};
  }

  function buildLeaderboard(sessionMap) {
    const totals = new Map();
    sessionMap.forEach(session => {
      if (session.questionType !== 'POLL' || !session.correctAnswer) return;
      session.correctAnswers.forEach(answer => {
        const row = totals.get(answer.studentId) || {studentId:answer.studentId,nickname:answer.nickname,points:0,correct:0};
        row.nickname = answer.nickname || row.nickname;
        row.points += answer.points;
        row.correct += 1;
        totals.set(answer.studentId, row);
      });
    });
    return [...totals.values()].sort((a,b) => b.points-a.points || b.correct-a.correct || a.nickname.localeCompare(b.nickname));
  }

  function buildModel(activeId, questions, events) {
    const questionMap = new Map(questions.map(q => [q.id,q]));
    const registrations = deriveRegistrations(events);
    const sessions = deriveSessions(events, questionMap, registrations);
    const activeQuestion = activeId && activeId.toUpperCase() !== 'OFF' ? questionMap.get(activeId) || null : null;
    let currentSession = null;
    if (activeQuestion) {
      const matches = [...sessions.values()].filter(s => s.questionId === activeQuestion.id).sort((a,b) => b.startRow-a.startRow);
      if (matches.length) {
        const latest = matches[0];
        if (!latest.resetEvent || latest.resetEvent.rowIndex < latest.startRow) currentSession = latest;
      }
    }
    return {activeId,off:!activeId || activeId.toUpperCase()==='OFF',questions,questionMap,activeQuestion,events,registrations,sessions,leaderboard:buildLeaderboard(sessions),currentSession};
  }

  function registrationState(model) {
    const studentId = getMatricola();
    const nickname = getNickname();
    if (!studentId || !nickname) return {status:'NEEDS_IDENTITY',studentId,nickname};
    const studentOwner = model.registrations.studentOwners.get(studentId);
    const nicknameOwner = model.registrations.nicknameOwners.get(norm(nickname));
    if (studentOwner && norm(studentOwner.nickname) !== norm(nickname)) return {status:'CONFLICT_STUDENT',studentId,nickname,expected:studentOwner.nickname};
    if (nicknameOwner && String(nicknameOwner.matricola || nicknameOwner.studentId).trim() !== studentId) return {status:'CONFLICT_NICK',studentId,nickname};
    if (/^(hmac256|sha256):[0-9a-f]{64}$/.test(studentId)) return {status:'CONFIRMED',studentId,nickname};
    return {status:studentOwner && nicknameOwner ? 'CONFIRMED':'PENDING',studentId,nickname};
  }

  async function ensureRegistration(model) {
    // Registration is owned exclusively by registration-bootstrap.js + Apps Script.
    // Never emit REGISTER events from the core app: old behavior could keep
    // resubmitting stale identities after test data had been cleared.
    return;
  }

  function answered(session, studentId) {
    return !!session && (session.answers.some(a => a.studentId === studentId) || localStorage.getItem(`bdaLive.submitted.${session.sessionId}`) === '1');
  }

  function shell(content, options={}) {
    const identity = options.identity ? `<div class="identity-chip">${esc(options.identity)}</div>` : '';
    return `<div class="page ${VIEW}"><header class="site-header"><div class="header-row"><div class="brand">BDA LIVE</div>${identity}</div>${options.kicker?`<div class="kicker">${esc(options.kicker)}</div>`:''}${options.title?`<h1>${esc(options.title)}</h1>`:''}</header><div class="redline"></div><main class="main-area">${content}</main><footer><span>Big Data Analytics and Reasoning</span><span class="live"><span class="dot"></span>LIVE</span></footer></div>`;
  }

  function timerHtml(session) {
    const t = sessionTiming(session);
    return `<div class="timer ${t.state==='CLOSED'?'timer-closed':''}"><span class="timer-value" data-session-id="${esc(session.sessionId)}">${Math.max(0,Math.ceil(t.remainingMs/1000))}</span><span class="timer-unit">s</span></div>`;
  }

  function renderIdentityGate(model, message='') {
    const currentMatricola = getMatricola();
    const currentNickname = getNickname();
    ui.root.innerHTML = shell(`<section class="student-card nickname-card"><div class="eyebrow">JOIN BDA LIVE</div><h2>Enter your matricola and nickname</h2><p class="muted">Your matricola is your real BDA LIVE identity. The nickname is the public alias shown in class.</p>${message?`<div class="inline-error">${esc(message)}</div>`:''}<form id="identityForm"><input id="matricolaInput" class="text-answer" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="Matricola" value="${esc(currentMatricola)}"><input id="nicknameInput" class="text-answer" maxlength="24" autocomplete="off" placeholder="Nickname (e.g. graphfox)" value="${esc(currentNickname)}"><button class="primary" type="submit">JOIN</button></form></section>`,{kicker:'CLASSROOM LIVE'});
    document.getElementById('identityForm').addEventListener('submit', async event => {
      event.preventDefault();
      const matricola = document.getElementById('matricolaInput').value.trim();
      const nickname = document.getElementById('nicknameInput').value.trim();
      if (!/^\d{4,12}$/.test(matricola)) return renderIdentityGate(model,'Enter a valid matricola using digits only.');
      if (!/^[\p{L}\p{N}_.-]{2,24}$/u.test(nickname)) return renderIdentityGate(model,'Nickname: 2–24 letters, numbers, dots, underscores or hyphens.');
      const studentOwner = model.registrations.studentOwners.get(matricola);
      const nicknameOwner = model.registrations.nicknameOwners.get(norm(nickname));
      if (studentOwner && norm(studentOwner.nickname) !== norm(nickname)) return renderIdentityGate(model,`This matricola is already registered as ${studentOwner.nickname}.`);
      if (nicknameOwner && String(nicknameOwner.matricola || nicknameOwner.studentId).trim() !== matricola) return renderIdentityGate(model,'That nickname is already used by another matricola.');
      setIdentity(matricola,nickname);
      ui.forceStudentRender = true;
      renderStudent(model);
      try { await ensureRegistration(model); } catch (error) { console.error(error); }
    });
  }

  function renderStudent(model) {
    const previousFocus = document.activeElement && document.activeElement.id === 'openAnswer'
      ? {
          sessionId: String(document.activeElement.dataset.sessionId || ''),
          start: document.activeElement.selectionStart,
          end: document.activeElement.selectionEnd
        }
      : null;
    const reg = registrationState(model);
    if (reg.status === 'NEEDS_IDENTITY') return renderIdentityGate(model);
    if (reg.status === 'CONFLICT_STUDENT') { clearIdentity(); return renderIdentityGate(model,`That matricola is already registered with nickname ${reg.expected}.`); }
    if (reg.status === 'CONFLICT_NICK') { clearIdentity(); return renderIdentityGate(model,'That nickname belongs to another matricola.'); }
    const identity = `${reg.nickname} · ${reg.studentId}`;
    const registrationValue=String(CFG.registrationControlValue||'REGISTRATION').trim().toUpperCase();
    if(String(model.activeId||'').trim().toUpperCase()===registrationValue && reg.status==='CONFIRMED'){
      ui.root.innerHTML = shell('<section class="status-panel"><div class="status-icon success">✓</div><h2>You\'re already registered</h2><p>Your classroom nickname is <strong>'+esc(reg.nickname)+'</strong>. Wait for the instructor to continue.</p></section>',{identity:reg.nickname,kicker:'REGISTRATION OPEN'});
      return;
    }
    if (reg.status === 'PENDING') {
      ui.root.innerHTML = shell(`<section class="status-panel"><div class="spinner"></div><h2>Registering ${esc(reg.nickname)}…</h2><p>Checking matricola and nickname.</p></section>`,{identity,kicker:'CONNECTING'});
      return;
    }
    if (model.off) {
      ui.root.innerHTML = shell(`<section class="status-panel"><div class="status-icon">○</div><h2>No active question</h2><p>Wait for the instructor.</p></section>`,{identity,kicker:'PAUSED'});
      return;
    }
    const q = model.activeQuestion;
    if (!q) return ui.root.innerHTML = shell(`<section class="status-panel"><h2>Question unavailable</h2></section>`,{identity,kicker:'SETUP ISSUE'});
    const session = model.currentSession;
    if (!session) {
      ui.root.innerHTML = shell(`<section class="status-panel"><div class="status-icon ready">●</div><h2>Question ready</h2><p>Wait for the instructor to start.</p></section>`,{identity,kicker:`${q.id} · ${q.week}`,title:q.question});
      return;
    }
    const timing = sessionTiming(session);
    const already = answered(session, reg.studentId);
    if (timing.state === 'CLOSED') {
      ui.root.innerHTML = shell(`${timerHtml(session)}<section class="status-panel compact"><div class="status-icon">■</div><h2>Question closed</h2><p>${already?'Your response was submitted.':'Time is up.'}</p></section>`,{identity,kicker:`${q.id} · CLOSED`,title:q.question});
      return;
    }
    if (already) {
      ui.root.innerHTML = shell(`${timerHtml(session)}<section class="status-panel compact"><div class="status-icon success">✓</div><h2>Submitted</h2><p>Your first response for this round is locked in.</p></section>`,{identity,kicker:`${q.id} · LIVE`,title:q.question});
      return;
    }

    let interaction = '';
    if (q.type === 'POLL') {
      const selected = ui.selectedBySession.get(session.sessionId) || '';
      interaction = `<div class="options">${q.options.map(option=>`<button class="option ${selected===option?'selected':''}" type="button" data-answer="${esc(option)}">${esc(option)}</button>`).join('')}</div><button id="submitAnswer" class="primary" ${selected?'':'disabled'}>SUBMIT</button>`;
    } else {
      const draft = ui.draftBySession.get(session.sessionId) || '';
      interaction = `<input id="openAnswer" data-session-id="${esc(session.sessionId)}" class="text-answer" maxlength="160" autocomplete="off" placeholder="Your answer" value="${esc(draft)}"><button id="submitAnswer" class="primary" ${draft.trim()?'':'disabled'}>SUBMIT</button>`;
    }
    ui.root.innerHTML = shell(`${timerHtml(session)}<section class="student-card live-card">${interaction}</section>`,{identity,kicker:`${q.id} · LIVE`,title:q.question});
    document.querySelectorAll('.option').forEach(button => button.addEventListener('click',()=>{ui.selectedBySession.set(session.sessionId,button.dataset.answer);ui.forceStudentRender=true;renderStudent(model);}));
    const input = document.getElementById('openAnswer');
    if (input) {
      input.addEventListener('input',()=>{ui.draftBySession.set(session.sessionId,input.value);document.getElementById('submitAnswer').disabled=!input.value.trim();});
      if (previousFocus && previousFocus.sessionId === session.sessionId) {
        input.focus({preventScroll:true});
        try {
          const end = input.value.length;
          input.setSelectionRange(
            Math.min(previousFocus.start == null ? end : previousFocus.start, end),
            Math.min(previousFocus.end == null ? end : previousFocus.end, end)
          );
        } catch (_) {}
      }
    }
    const submit = document.getElementById('submitAnswer');
    if (submit) submit.addEventListener('click',async()=>{
      if (submit.disabled || sessionTiming(session).state !== 'OPEN') return;
      const answer = q.type === 'POLL' ? (ui.selectedBySession.get(session.sessionId)||'') : (ui.draftBySession.get(session.sessionId)||'').trim();
      if (!answer) return;
      submit.disabled = true; submit.textContent = 'SUBMITTING…';
      try {
        await submitEvent({type:'ANSWER',sessionId:session.sessionId,questionId:q.id,studentId:reg.studentId,matricola:reg.studentId,nickname:reg.nickname,browserId:getBrowserId(),answer});
        localStorage.setItem(`bdaLive.submitted.${session.sessionId}`,'1');
        ui.forceStudentRender = true; renderStudent(model);
      } catch (error) { submit.disabled=false;submit.textContent='SUBMIT';alert(`Could not submit: ${error.message}`); }
    });
  }

  function renderPoll(session,q,closed) {
    const total = session.validAnswers.length;
    const counts = new Map(q.options.map(o=>[o,0]));
    session.validAnswers.forEach(a=>counts.set(a.answer,(counts.get(a.answer)||0)+1));
    const max = Math.max(1,...counts.values());
    return `<div class="poll-results">${q.options.map(option=>{const count=counts.get(option)||0,pct=total?Math.round(count/total*100):0,isCorrect=closed&&session.correctAnswer&&norm(option)===norm(session.correctAnswer);return `<div class="poll-row${isCorrect?' correct-option':''}"><div class="poll-top"><span>${esc(option)}</span><strong>${count} · ${pct}%</strong></div><div class="bar-bg"><div class="bar" style="width:${count/max*100}%"></div></div></div>`;}).join('')}</div>`;
  }

  function renderOther(session) {
    if (!session.validAnswers.length) return '<div class="empty-state">Waiting for responses…</div>';
    return `<div class="response-grid">${session.validAnswers.slice().reverse().slice(0,18).map(a=>`<div class="response-card"><span>${esc(a.answer)}</span><small>${esc(a.nickname)}</small></div>`).join('')}</div>`;
  }

  function normalizeCloudAnswer(value) {
    let display=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
    display=display.replace(/^[\s.,;:!?"'“”‘’()[\]{}]+|[\s.,;:!?"'“”‘’()[\]{}]+$/g,'').trim();
    const normalized=display.replace(/[-‐‑‒–—]+/g,' ').replace(/\s+/g,' ').toLocaleLowerCase();
    return {display,normalized};
  }

  function cloudGroups(session) {
    const grouped=new Map();
    session.validAnswers.forEach(a=>{
      const n=normalizeCloudAnswer(a.answer);
      if(!n.normalized)return;
      const row=grouped.get(n.normalized)||{normalized:n.normalized,text:n.display,count:0};
      row.count++;
      grouped.set(n.normalized,row);
    });
    return [...grouped.values()].sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text));
  }

  function cloudFontSize(count) {
    return Math.max(30,Math.min(104,Math.round(30+18*Math.log2(Math.max(1,count)))));
  }

  function cloudRotation(text) {
    let h=0;
    for(const ch of text) h=((h<<5)-h+ch.codePointAt(0))|0;
    return [-4,0,4][Math.abs(h)%3];
  }

  function renderWordCloud(session) {
    const items=cloudGroups(session);
    if(!items.length)return '<div class="cloud-empty">Waiting for words…</div>';
    return `<div class="cloud-visual">${items.map(item=>`<span class="cloud-word" style="font-size:${cloudFontSize(item.count)}px;transform:rotate(${cloudRotation(item.normalized)}deg)" title="${item.count} response${item.count===1?'':'s'}">${esc(item.text)}${item.count>1?`<sup>${item.count}</sup>`:''}</span>`).join('')}</div>`;
  }

  function renderWordFrequency(session) {
    const items=cloudGroups(session);
    if(!items.length)return '<div class="empty-mini">No responses yet.</div>';
    return `<div class="cloud-frequency">${items.slice(0,10).map(item=>`<div class="cloud-frequency-row"><span>${esc(item.text)}</span><strong>${item.count}</strong></div>`).join('')}</div>`;
  }

  function renderFastest(session) {
    if (!session.correctAnswers.length) return '<div class="empty-mini">No correct answers.</div>';
    const groups = [];
    session.correctAnswers.filter(a=>a.rank<=3).forEach(a=>{let g=groups.find(x=>x.rank===a.rank);if(!g){g={rank:a.rank,answers:[]};groups.push(g);}g.answers.push(a);});
    const medals={1:'🥇',2:'🥈',3:'🥉'};
    return `<div class="fastest-list">${groups.map(g=>`<div><span>${medals[g.rank]}</span><strong>${g.answers.map(a=>esc(a.nickname)).join(' · ')}</strong></div>`).join('')}</div>`;
  }

  function renderLeaderboard(model) {
    if (!model.leaderboard.length) return '<div class="empty-mini">No points yet.</div>';
    return `<div class="leaderboard">${model.leaderboard.slice(0,12).map((r,i)=>`<div class="leader-row"><span class="rank">${i+1}</span><span class="name">${esc(r.nickname)}</span><span class="correct-count">${r.correct} ✓</span><strong>${r.points}</strong></div>`).join('')}</div>`;
  }

  function controls(model,session,timing) {
    const pending=ui.pendingAction;
    const pendingHere = pending && (!pending.questionId || pending.questionId === model.activeQuestion?.id);
    return `<div class="presenter-controls"><button id="startQuestion" class="primary control" ${model.off||!model.activeQuestion||(session&&timing?.state==='OPEN')||(pendingHere&&pending?.type==='START')?'disabled':''}>${pendingHere&&pending?.type==='START'?'STARTING…':'START QUESTION'}</button><button id="endQuestion" class="secondary control" ${!session||timing?.state!=='OPEN'||(pendingHere&&pending?.type==='END')?'disabled':''}>${pendingHere&&pending?.type==='END'?'ENDING…':'END NOW'}</button><button id="resetQuestion" class="ghost control" ${!session||(pendingHere&&pending?.type==='RESET')?'disabled':''}>${pendingHere&&pending?.type==='RESET'?'RESETTING…':'RESET / PREPARE NEXT'}</button></div>`;
  }

  function reconcilePending(model) {
    if (!ui.pendingAction) return;
    const p=ui.pendingAction;
    if (p.questionId && model.activeQuestion && p.questionId !== model.activeQuestion.id) {
      ui.pendingAction=null;
      return;
    }
    const found=model.events.some(e=>(p.type==='START'&&e.type==='START'&&e.sessionId===p.sessionId)||(p.type==='END'&&e.type==='END'&&e.sessionId===p.sessionId)||(p.type==='RESET'&&e.type==='RESET'&&e.sessionId===p.sessionId));
    if(found||Date.now()-p.at>(CFG.actionPendingTimeoutMs||15000)) ui.pendingAction=null;
  }

  function bindControls(model,session) {
    const start=document.getElementById('startQuestion'),end=document.getElementById('endQuestion'),reset=document.getElementById('resetQuestion');
    if(start&&!start.disabled) start.onclick=async()=>{const q=model.activeQuestion,sessionId=makeId('ses');ui.pendingAction={type:'START',sessionId,questionId:q.id,at:Date.now()};renderPresenter(model);try{await submitEvent({type:'START',sessionId,questionId:q.id,questionType:q.type,duration:q.duration,correctAnswer:q.correctAnswer,launchSource:'Presenter'});}catch(e){ui.pendingAction=null;alert(`Could not start: ${e.message}`);}};
    if(end&&!end.disabled) end.onclick=async()=>{ui.pendingAction={type:'END',sessionId:session.sessionId,questionId:session.questionId,at:Date.now()};renderPresenter(model);try{await submitEvent({type:'END',sessionId:session.sessionId,questionId:session.questionId});}catch(e){ui.pendingAction=null;alert(`Could not end: ${e.message}`);}};
    if(reset&&!reset.disabled) reset.onclick=async()=>{ui.pendingAction={type:'RESET',sessionId:session.sessionId,questionId:session.questionId,at:Date.now()};renderPresenter(model);try{await submitEvent({type:'RESET',sessionId:session.sessionId,questionId:session.questionId});}catch(e){ui.pendingAction=null;alert(`Could not reset: ${e.message}`);}};
  }

  function presenterSignature(model) {
    const s=model.currentSession;
    const timing=s?sessionTiming(s):null;
    const answers=s?s.validAnswers.map(a=>`${a.studentId}:${a.answer}:${a.correct?'1':'0'}`).join('¦'):'';
    const board=(model.leaderboard||[]).map(r=>`${r.nickname}:${r.points}:${r.correct}`).join('¦');
    const p=ui.pendingAction;
    return [model.activeId||'',model.off?'1':'0',s?.sessionId||'',timing?.state||'',answers,board,p?.type||'',p?.sessionId||'',p?.questionId||''].join('||');
  }

  function setPresenterHtml(model, html) {
    const key=`${model.activeId||''}|${model.currentSession?.sessionId||'prepared'}`;
    const same=ui.lastPresenterViewKey===key;
    const y=same?window.scrollY:0;
    ui.root.innerHTML=html;
    ui.lastPresenterViewKey=key;
    if(same && y>0){
      requestAnimationFrame(()=>{
        if(ui.lastPresenterViewKey===key) window.scrollTo(0,y);
      });
    }
  }

  function renderPresenter(model) {
    reconcilePending(model);
    const registrationValue=String(CFG.registrationControlValue||'REGISTRATION').trim().toUpperCase();
    if(String(model.activeId||'').trim().toUpperCase()===registrationValue){
      if(!ui.root.querySelector('[data-registration-presenter]')){
        setPresenterHtml(model,shell('<section class="status-panel presenter-wait"><h2>Student registration is open</h2><p>Waiting for registrations…</p></section>',{kicker:'PRESENTER · REGISTRATION OPEN',title:'Student registration'}));
      }
      return;
    }
    if(model.off){setPresenterHtml(model,shell(`${controls(model,null,null)}<section class="status-panel presenter-wait"><h2>Waiting for next question…</h2><p>B1 is set to OFF.</p></section><aside class="side-panel"><h3>Leaderboard</h3>${renderLeaderboard(model)}</aside>`,{kicker:'PRESENTER · PAUSED',title:'BDA LIVE'}));bindControls(model,null);return;}
    const q=model.activeQuestion;
    if(!q){setPresenterHtml(model,shell('<section class="status-panel"><h2>Selected question not found</h2></section>',{kicker:'PRESENTER · SETUP ISSUE'}));return;}
    const session=model.currentSession;
    if(!session){setPresenterHtml(model,shell(`${controls(model,null,null)}<div class="presenter-grid"><section class="stage-card prepared-card"><div class="big-ready">READY</div><p>${q.duration}s · ${esc(q.type)}</p><p class="cue">${esc(q.teachingCue)}</p></section><aside class="side-panel"><h3>Leaderboard</h3>${renderLeaderboard(model)}</aside></div>`,{kicker:`PRESENTER · ${q.id} · ${q.week}`,title:q.question}));bindControls(model,null);return;}
    const timing=sessionTiming(session),closed=timing.state==='CLOSED';
    const scoredQuiz=q.type==='POLL'&&!!session.correctAnswer;
    const results=q.type==='POLL'?renderPoll(session,q,closed):(q.type==='WORDCLOUD'?renderWordCloud(session):renderOther(session));
    const reveal=closed&&scoredQuiz?`<div class="correct-reveal"><span>Correct answer</span><strong>${esc(session.correctAnswer)}</strong></div>`:'';
    const fastest=closed&&scoredQuiz?`<section class="mini-card"><h3>Fastest correct</h3>${renderFastest(session)}</section>`:'';
    const cloudSide=q.type==='WORDCLOUD'?`<section class="mini-card"><h3>Word frequency</h3>${renderWordFrequency(session)}</section>`:'';
    setPresenterHtml(model,shell(`${controls(model,session,timing)}<div class="presenter-status-row">${timerHtml(session)}<div class="response-count"><strong>${session.validAnswers.length}</strong><span>RESPONSES</span></div><div class="state-pill ${closed?'closed':'open'}">${closed?'CLOSED':'OPEN'}</div></div>${reveal}<div class="presenter-grid"><section class="stage-card ${q.type==='WORDCLOUD'?'cloud-stage-card':''}">${results}</section><aside class="side-panel">${cloudSide}${fastest}<section class="mini-card"><h3>Leaderboard</h3>${renderLeaderboard(model)}</section><section class="mini-card teacher-note"><h3>Teaching cue</h3><p>${esc(q.teachingCue)}</p><small>${esc(q.source)}</small></section></aside></div>`,{kicker:`PRESENTER · ${q.id} · ${q.week}`,title:q.question}));
    bindControls(model,session);
  }

  function studentSignature(model) {
    const r=registrationState(model),s=model.currentSession,t=s?sessionTiming(s):null;
    return [r.status,r.studentId,r.nickname,model.activeId,s?.sessionId||'-',t?.state||'-',s?answered(s,r.studentId):false].join('|');
  }

  function render() {
    if(!ui.lastModel)return;
    if(VIEW==='present'){
      const sig=presenterSignature(ui.lastModel);
      if(sig!==ui.lastPresenterSignature){
        ui.lastPresenterSignature=sig;
        renderPresenter(ui.lastModel);
      }
      return;
    }
    const sig=studentSignature(ui.lastModel);
    if(ui.forceStudentRender||sig!==ui.lastStudentSignature){ui.lastStudentSignature=sig;ui.forceStudentRender=false;renderStudent(ui.lastModel);}
  }

  function tick() {
    const s=ui.lastModel?.currentSession;
    if(!s)return;
    const t=sessionTiming(s);
    document.querySelectorAll(`.timer-value[data-session-id="${CSS.escape(s.sessionId)}"]`).forEach(el=>el.textContent=String(Math.max(0,Math.ceil(t.remainingMs/1000))));
    if(ui.lastTimerState&&ui.lastTimerState!==t.state){if(VIEW==='student')ui.forceStudentRender=true;render();}
    ui.lastTimerState=t.state;
  }

  async function refresh() {
    if(ui.refreshBusy)return;
    ui.refreshBusy=true;
    try{
      const [activeId,questions,events]=await Promise.all([loadActiveId(),loadQuestions(),loadEvents()]);
      ui.lastModel=buildModel(activeId,questions,events);
      reconcilePending(ui.lastModel);
      if(VIEW==='student')await ensureRegistration(ui.lastModel);
      render();
    }catch(error){ui.root.innerHTML=shell(`<section class="status-panel error-panel"><h2>Connection problem</h2><p>${esc(error.message)}</p><p class="muted">The page will retry automatically.</p></section>`,{kicker:VIEW==='present'?'PRESENTER':'STUDENT'});}finally{ui.refreshBusy=false;}
  }

  function previewPresenterActive(value){
    if(VIEW!=='present'||!ui.lastModel)return;
    const active=String(value||'').trim();
    ui.pendingAction=null;
    ui.lastTimerState=null;
    if(/^ROUND:/i.test(active))return;
    ui.lastModel=buildModel(active,ui.lastModel.questions,ui.lastModel.events);
    ui.lastPresenterSignature=presenterSignature(ui.lastModel);
    renderPresenter(ui.lastModel);
  }

  window.addEventListener('bda-presenter-active-preview',event=>{
    previewPresenterActive(event && event.detail && event.detail.value);
  });

  function boot(){if(!ui.root)return;if(VIEW==='student')getBrowserId();refresh();setInterval(refresh,VIEW==='present'?(CFG.presenterPollMs||1200):(CFG.studentPollMs||1800));setInterval(tick,250);}

  window.BDA_LIVE_TEST={csvRows,parseEvent,encodeEvent,parseTimestamp,normalizeType,buildModel,sessionTiming,norm};
  boot();
})();
