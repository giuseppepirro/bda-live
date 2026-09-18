(function(){
'use strict';
const C=window.BDA_CONFIG||{};
if(new URLSearchParams(location.search).get('view')!=='present')return;

const FRIENDLY={
  Q0:'Opening cloud · What comes to mind when you hear Big Data?',
  Q0B:'Tools cloud · Big Data technologies / platforms',
  Q0C:'Experience pulse · Data tools used so far',
  Q0D:'Experience pulse · SQL comfort',
  Q0E:'Experience pulse · Largest dataset handled',
  Q0F:'Scale intuition · What makes data difficult at scale?',
  QFB:'Lecture feedback · How much did the class understand?'
};

let busy=false,lastActive='',questions=[],rounds=[];

function csv(t){
  const out=[];let row=[],cell='',q=false;
  for(let i=0;i<t.length;i++){
    const c=t[i],n=t[i+1];
    if(c==='"'){if(q&&n==='"'){cell+='"';i++;}else q=!q;}
    else if(c===','&&!q){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(v=>v!==''))out.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);if(row.some(v=>v!==''))out.push(row);}
  return out;
}
function bust(url,key){const u=new URL(url,location.href);u.searchParams.set(key||'_ctl',Date.now()+'-'+Math.random().toString(36).slice(2,7));return u.toString();}
async function text(url){const r=await fetch(bust(url),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);return r.text();}
function clean(s){return String(s||'').replace(/\s+/g,' ').trim();}
function qLabel(q){
  if(FRIENDLY[q.id])return q.id+' · '+FRIENDLY[q.id];
  const type=q.type==='CLOUD'?'WORD CLOUD':q.type;
  let title=clean(q.question);
  if(title.length>78)title=title.slice(0,75)+'…';
  return q.id+' · '+type+' · '+title;
}
function rLabel(r){
  let title=clean(r.label||r.id);
  if(title.length>70)title=title.slice(0,67)+'…';
  return 'ROUND:'+r.id+' · '+title;
}
async function loadOptions(){
  const [qr,rr]=await Promise.all([text(C.questionsCsv),text(C.roundsCsv)]);
  questions=csv(qr).map(r=>({id:clean(r[0]),week:clean(r[1]),type:clean(r[2]).toUpperCase(),question:clean(r[3])})).filter(q=>q.id&&q.question);
  rounds=csv(rr).slice(1).map(r=>({id:clean(r[0]),label:clean(r[1])})).filter(r=>r.id);
}
async function active(){
  const r=csv(await text(C.controlCsv));
  return clean((r[0]&&r[0][1])||'OFF');
}
function jsonp(op,params,timeoutMs){
  return new Promise((resolve,reject)=>{
    const ep=clean(C.studentKeyEndpoint);if(!ep)return reject(new Error('Control service not configured.'));
    const cb='__bda_ctl_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const s=document.createElement('script');let done=false;
    function cleanup(){try{delete window[cb];}catch(e){window[cb]=undefined;}s.remove();}
    function finish(fn,v){if(done)return;done=true;clearTimeout(to);cleanup();fn(v);}
    window[cb]=d=>finish(resolve,d||{});
    const u=new URL(ep,location.href);
    u.searchParams.set('op',op);u.searchParams.set('callback',cb);
    Object.keys(params||{}).forEach(k=>u.searchParams.set(k,String(params[k])));
    u.searchParams.set('_bda',Date.now()+'-'+Math.random().toString(36).slice(2,7));
    s.src=u.toString();s.async=true;s.onerror=()=>finish(reject,new Error('Presenter control service unavailable.'));
    const to=setTimeout(()=>finish(reject,new Error('Presenter control timeout.')),timeoutMs||5000);
    document.head.appendChild(s);
  });
}
function build(){
  if(document.getElementById('bdaPresenterControl'))return;
  const style=document.createElement('style');
  style.textContent=`
    #bdaPresenterControl{position:sticky;top:0;z-index:10000;background:#111;color:#fff;padding:10px 16px;display:grid;grid-template-columns:auto minmax(260px,1fr) auto;gap:10px;align-items:center;box-shadow:0 2px 12px rgba(0,0,0,.18);font-family:Arial,sans-serif}
    #bdaPresenterControl strong{font-size:12px;letter-spacing:.08em;white-space:nowrap}
    #bdaPresenterControl select{width:100%;min-width:0;padding:9px 10px;border-radius:9px;border:1px solid #555;background:#fff;color:#111;font-weight:700}
    #bdaPresenterControl button{padding:9px 14px;border:0;border-radius:9px;background:#b3131d;color:#fff;font-weight:900;cursor:pointer}
    #bdaPresenterControl button:disabled{opacity:.55;cursor:wait}
    #bdaPresenterControl .ctl-status{font-size:12px;color:#ddd;min-width:90px;text-align:right}
    @media(max-width:850px){#bdaPresenterControl{grid-template-columns:1fr auto}#bdaPresenterControl strong,#bdaPresenterControl .ctl-status{display:none}}
  `;
  document.head.appendChild(style);

  const host=document.createElement('div');host.id='bdaPresenterControl';
  const label=document.createElement('strong');label.textContent='ACTIVE ACTIVITY';
  const select=document.createElement('select');select.id='bdaPresenterSelect';
  const status=document.createElement('div');status.className='ctl-status';status.textContent='Ready';
  host.append(label,select,status);
  document.body.insertBefore(host,document.body.firstChild);

  const add=(value,text,group)=>{
    let parent=select;
    if(group){
      let g=[...select.children].find(x=>x.tagName==='OPTGROUP'&&x.label===group);
      if(!g){g=document.createElement('optgroup');g.label=group;select.appendChild(g);}parent=g;
    }
    const o=document.createElement('option');o.value=value;o.textContent=text;parent.appendChild(o);
  };

  add('OFF','OFF · Pause BDA LIVE','Classroom');
  add('REGISTRATION','REGISTRATION · Student registration','Classroom');
  rounds.forEach(r=>add('ROUND:'+r.id,rLabel(r),'Rounds'));
  const weeks=[...new Set(questions.map(q=>q.week||'Questions'))];
  weeks.forEach(w=>questions.filter(q=>(q.week||'Questions')===w).forEach(q=>add(q.id,qLabel(q),w||'Questions')));

  async function activate(value){
    if(busy)return;
    const previous=lastActive;
    busy=true;
    select.disabled=true;
    status.textContent='Switching…';
    window.BDA_ACTIVE_OVERRIDE=value;
    window.dispatchEvent(new CustomEvent('bda-presenter-active-preview',{detail:{value:value}}));
    try{
      const d=await jsonp('setActive',{value:value},5000);
      if(!d||!d.ok)throw new Error((d&&d.error)||'Could not activate activity');
      lastActive=String(d.value||value);
      select.value=lastActive;
      status.textContent='Active ✓';
      window.dispatchEvent(new CustomEvent('bda-presenter-active-confirmed',{detail:{value:lastActive}}));
      setTimeout(()=>{ if(window.BDA_ACTIVE_OVERRIDE===lastActive) window.BDA_ACTIVE_OVERRIDE=''; },1800);
    }catch(e){
      window.BDA_ACTIVE_OVERRIDE=previous||'';
      select.value=previous||select.value;
      window.dispatchEvent(new CustomEvent('bda-presenter-active-preview',{detail:{value:previous||'OFF'}}));
      status.textContent='ERROR';
      alert(e.message||String(e));
    }finally{
      busy=false;
      select.disabled=false;
    }
  }
  select.onchange=()=>activate(select.value);
}
async function sync(){
  try{
    const a=await active();lastActive=a;if(window.BDA_ACTIVE_OVERRIDE===a)window.BDA_ACTIVE_OVERRIDE='';
    const s=document.getElementById('bdaPresenterSelect');if(s&&document.activeElement!==s)s.value=a;
    const st=document.querySelector('#bdaPresenterControl .ctl-status');if(st&&!busy)st.textContent='Active: '+a;
  }catch(e){}
}
async function boot(){
  try{await loadOptions();build();await sync();setInterval(sync,1500);}
  catch(e){console.error('BDA presenter control:',e);}
}
boot();
})();