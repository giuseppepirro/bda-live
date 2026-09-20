(function(){
'use strict';

const C=window.BDA_CONFIG||{};
if(new URLSearchParams(location.search).get('view')!=='present')return;

const STORAGE_KEY='bdaLive.presenterAuth.v1';
const SOURCE_AUTH='BDA_PRESENTER_AUTH';
const SOURCE_ACTION='BDA_PRESENTER_ACTION';
let token=sessionStorage.getItem(STORAGE_KEY)||'';
let unlocked=!!token;
let busy=false;

function endpoint(){
  const ep=String(C.studentKeyEndpoint||'').trim();
  if(!ep)throw new Error('Presenter authentication service is not configured.');
  return ep;
}

function post(op,fields,source,timeoutMs){
  return new Promise((resolve,reject)=>{
    let ep;
    try{ep=endpoint();}catch(e){reject(e);return;}
    const replyToken='bda-presenter-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const frameName='bda-presenter-frame-'+Math.random().toString(36).slice(2);
    const frame=document.createElement('iframe');
    const form=document.createElement('form');
    let done=false;

    frame.name=frameName;
    frame.style.display='none';
    form.method='POST';
    form.action=ep;
    form.target=frameName;
    form.style.display='none';

    function add(name,value){
      const input=document.createElement('input');
      input.type='hidden';
      input.name=name;
      input.value=String(value==null?'':value);
      form.appendChild(input);
    }

    add('op',op);
    add('token',replyToken);
    Object.keys(fields||{}).forEach(k=>add(k,fields[k]));

    function cleanup(){
      window.removeEventListener('message',onMessage);
      try{form.remove();frame.remove();}catch(_){}
    }
    function finish(fn,value){
      if(done)return;
      done=true;
      clearTimeout(timer);
      cleanup();
      fn(value);
    }
    function onMessage(ev){
      const data=ev.data;
      if(!data||data.source!==source||data.token!==replyToken)return;
      if(data.ok)finish(resolve,data);
      else finish(reject,Object.assign(new Error(data.error||'Presenter request failed.'),{unauthorized:!!data.unauthorized}));
    }

    window.addEventListener('message',onMessage);
    const timer=setTimeout(()=>finish(reject,new Error('Presenter authentication timeout.')),timeoutMs||9000);
    document.body.appendChild(frame);
    document.body.appendChild(form);
    form.submit();
  });
}

function authState(){return unlocked&&!!token;}

function emit(){
  window.dispatchEvent(new CustomEvent('bda-presenter-auth-changed',{detail:{authenticated:authState()}}));
  render();
}

function lock(){
  token='';
  unlocked=false;
  sessionStorage.removeItem(STORAGE_KEY);
  emit();
}

async function login(password){
  if(busy)return false;
  busy=true;
  render();
  try{
    const result=await post('presenterLogin',{password:String(password||'')},SOURCE_AUTH,12000);
    token=String(result.authToken||'');
    if(!token)throw new Error('Presenter login did not return a session token.');
    unlocked=true;
    sessionStorage.setItem(STORAGE_KEY,token);
    emit();
    return true;
  }finally{
    busy=false;
    render();
  }
}

async function mutate(action,payload){
  if(!authState())throw Object.assign(new Error('Presenter is locked.'),{unauthorized:true});
  try{
    return await post('presenterAction',Object.assign({
      authToken:token,
      action:String(action||'')
    },payload||{}),SOURCE_ACTION,12000);
  }catch(e){
    if(e&&e.unauthorized)lock();
    throw e;
  }
}

function injectStyle(){
  if(document.getElementById('bdaPresenterAuthStyle'))return;
  const style=document.createElement('style');
  style.id='bdaPresenterAuthStyle';
  style.textContent=`
    body.bda-presenter-auth-enabled{padding-bottom:62px!important}
    #bdaPresenterAuth{position:fixed;left:0;right:0;bottom:0;z-index:10050;background:#292929;color:#fff;padding:9px 16px;font-family:Arial,sans-serif;box-shadow:0 -2px 12px rgba(0,0,0,.18),0 1px 0 rgba(255,255,255,.08) inset}
    #bdaPresenterAuth .auth-inner{display:flex;gap:10px;align-items:center;justify-content:flex-end;max-width:1500px;margin:auto}
    #bdaPresenterAuth .auth-state{margin-right:auto;font-size:12px;font-weight:900;letter-spacing:.08em}
    #bdaPresenterAuth .auth-note{font-size:12px;color:#cfcfcf}
    #bdaPresenterAuth input{min-width:220px;padding:8px 10px;border-radius:8px;border:1px solid #666;background:#fff;color:#111}
    #bdaPresenterAuth button{padding:8px 12px;border:0;border-radius:8px;font-weight:900;cursor:pointer}
    #bdaPresenterAuth .unlock{background:#b3131d;color:#fff}
    #bdaPresenterAuth .lock{background:#eee;color:#111}
    #bdaPresenterAuth button:disabled{opacity:.55;cursor:wait}
    body.bda-presenter-locked #bdaPresenterControl select{pointer-events:none;opacity:.55}
    body.bda-presenter-locked .presenter-controls button{pointer-events:none;opacity:.45}
    @media(max-width:700px){body.bda-presenter-auth-enabled{padding-bottom:76px!important}#bdaPresenterAuth .auth-note{display:none}#bdaPresenterAuth .auth-inner{gap:7px}#bdaPresenterAuth input{min-width:135px;width:40vw}}
  `;
  document.head.appendChild(style);
}

function render(){
  injectStyle();
  let host=document.getElementById('bdaPresenterAuth');
  if(!host){
    host=document.createElement('div');
    host.id='bdaPresenterAuth';
    document.body.appendChild(host);
  }
  document.body.classList.add('bda-presenter-auth-enabled');
  document.body.classList.toggle('bda-presenter-locked',!authState());

  if(authState()){
    host.innerHTML='<div class="auth-inner"><span class="auth-state">PRESENTER · UNLOCKED</span><span class="auth-note">Administrative controls are enabled for this browser session.</span><button class="lock" type="button" id="bdaPresenterLock">LOCK</button></div>';
    const b=document.getElementById('bdaPresenterLock');
    if(b)b.onclick=lock;
    return;
  }

  host.innerHTML='<form class="auth-inner" id="bdaPresenterLogin"><span class="auth-state">PRESENTER · LOCKED</span><span class="auth-note">View only until you enter the presenter password.</span><input id="bdaPresenterPassword" type="password" autocomplete="current-password" placeholder="Presenter password"><button class="unlock" type="submit" '+(busy?'disabled':'')+'>'+(busy?'UNLOCKING…':'UNLOCK')+'</button></form>';
  const form=document.getElementById('bdaPresenterLogin');
  if(form)form.onsubmit=async ev=>{
    ev.preventDefault();
    const input=document.getElementById('bdaPresenterPassword');
    const password=input?input.value:'';
    if(!password)return;
    try{
      await login(password);
    }catch(e){
      alert(e.message||'Could not unlock presenter.');
      if(input){input.value='';input.focus();}
    }
  };
}

window.BDA_PRESENTER_AUTH={
  isAuthenticated:authState,
  getToken:()=>token,
  login,
  lock
};
window.BDA_PRESENTER_MUTATE=mutate;

render();

if(token){
  mutate('ping',{}).then(()=>emit()).catch(()=>lock());
}else{
  emit();
}
})();