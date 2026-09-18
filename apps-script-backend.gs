const BDA_HMAC_PROPERTY = 'BDA_STUDENT_HMAC_SECRET';
const BDA_REGISTRY_ID_PROPERTY = 'BDA_STUDENT_REGISTRY_ID';
const BDA_NAMESPACE = 'BDA-LIVE|UNICAL|2026-27|';
const BDA_REGISTRY_TITLE = 'BDA LIVE - Student Registry (PRIVATE)';

function doPost(e) {
  const p = (e && e.parameter) || {};
  const op = String(p.op || '').trim();
  if (op === 'studentKey') return handleStudentKey_(p);
  if (op === 'registerStudent') return handleRegisterStudent_(p);
  return frameReply_('BDA_REGISTER', String(p.token || ''), {ok:false, error:'Unsupported operation'});
}

function handleStudentKey_(p) {
  const token = String(p.token || '');
  const matricola = normalizeMatricola_(p.matricola);
  if (!matricola) return frameReply_('BDA_HMAC', token, {ok:false, error:'Invalid matricola'});
  return frameReply_('BDA_HMAC', token, {ok:true, key:hmacStudentKey_(matricola)});
}

function handleRegisterStudent_(p) {
  const token = String(p.token || '');
  const matricola = normalizeMatricola_(p.matricola);
  if (!matricola) return frameReply_('BDA_REGISTER', token, {ok:false, error:'Invalid matricola'});
  const key = hmacStudentKey_(matricola);
  const firstName = cleanHumanName_(p.firstName);
  const lastName = cleanHumanName_(p.lastName);
  const requestedNick = String(p.nickname || '').trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getRegistrySheet_();
    const lastRow = sheet.getLastRow();
    const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];
    let existingIndex = -1, nicknameOwnerIndex = -1;
    const requestedNorm = normalizeNickname_(requestedNick);
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim() === key) existingIndex = i;
      if (requestedNorm && normalizeNickname_(rows[i][4]) === requestedNorm) nicknameOwnerIndex = i;
    }
    if (existingIndex >= 0) {
      const row = existingIndex + 2;
      const canonicalNick = String(rows[existingIndex][4] || '').trim();
      sheet.getRange(row, 7).setValue(new Date());
      sheet.getRange(row, 8).setValue('ACTIVE');
      return frameReply_('BDA_REGISTER', token, {ok:true, key:key, nickname:canonicalNick, alreadyRegistered:true});
    }
    if (!firstName) return frameReply_('BDA_REGISTER', token, {ok:false, error:'Enter your name'});
    if (!lastName) return frameReply_('BDA_REGISTER', token, {ok:false, error:'Enter your surname'});
    if (!/^[\p{L}\p{N}_.-]{2,24}$/u.test(requestedNick)) return frameReply_('BDA_REGISTER', token, {ok:false, error:'Invalid nickname'});
    if (nicknameOwnerIndex >= 0) return frameReply_('BDA_REGISTER', token, {ok:false, error:'Nickname already used'});
    const now = new Date();
    sheet.appendRow([key, matricola, firstName, lastName, requestedNick, now, now, 'ACTIVE']);
    return frameReply_('BDA_REGISTER', token, {ok:true, key:key, nickname:requestedNick, alreadyRegistered:false});
  } catch (err) {
    return frameReply_('BDA_REGISTER', token, {ok:false, error:String(err && err.message || err)});
  } finally {
    lock.releaseLock();
  }
}

function getRegistrySheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(BDA_REGISTRY_ID_PROPERTY), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (_) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(BDA_REGISTRY_TITLE);
    props.setProperty(BDA_REGISTRY_ID_PROPERTY, ss.getId());
    ss.setSpreadsheetTimeZone('Europe/Rome');
  }
  let sheet = ss.getSheetByName('Students');
  if (!sheet) { sheet = ss.getSheets()[0]; sheet.setName('Students'); }
  if (sheet.getLastRow() === 0 || String(sheet.getRange(1,1).getValue()).trim() !== 'Student key') {
    sheet.getRange(1,1,1,8).setValues([['Student key','Matricola','Nome','Cognome','Nickname','First registered','Last registered','Status']]);
    sheet.getRange(1,1,1,8).setFontWeight('bold').setBackground('#eeeeee');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('@');
    sheet.getRange('F:G').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.autoResizeColumns(1,8);
  }
  return sheet;
}

function hmacStudentKey_(matricola) {
  const secret = getOrCreateSecret_();
  const bytes = Utilities.computeHmacSha256Signature(BDA_NAMESPACE + matricola, secret, Utilities.Charset.UTF_8);
  return 'hmac256:' + bytes.map(function(b){const x=(b<0?b+256:b);return ('0'+x.toString(16)).slice(-2);}).join('');
}

function getOrCreateSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(BDA_HMAC_PROPERTY);
  if (secret) return secret;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    secret = props.getProperty(BDA_HMAC_PROPERTY);
    if (!secret) {
      const seed = [Utilities.getUuid(), Utilities.getUuid(), String(new Date().getTime()), Utilities.getUuid()].join('|');
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
      secret = digest.map(function(b){const x=(b<0?b+256:b);return ('0'+x.toString(16)).slice(-2);}).join('');
      props.setProperty(BDA_HMAC_PROPERTY, secret);
    }
    return secret;
  } finally { lock.releaseLock(); }
}

function normalizeMatricola_(value) {
  const s = String(value || '').trim();
  return /^\d{4,12}$/.test(s) ? s : '';
}

function cleanHumanName_(value) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > 80) return '';
  return s;
}

function normalizeNickname_(value) {
  return String(value || '').trim().toLowerCase();
}

function frameReply_(source, token, payload) {
  const data = Object.assign({source:source, token:token}, payload || {});
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>(function(){' +
    'var d=' + json + ';' +
    'var w=window;' +
    'for(var i=0;i<8;i++){' +
      'try{w.postMessage(d,"*");}catch(e){}' +
      'try{if(w===w.parent)break;w=w.parent;}catch(e){break;}' +
    '}' +
    '})();<\/script>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
