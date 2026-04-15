
var TK='',ws=null,tabs=[],asd=null,SS={},SCS=[];
function e(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function ah(){return{'Content-Type':'application/json','x-admin-token':TK};}
function login(){
  var pw=document.getElementById('pwin').value;
  fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})})
  .then(function(r){return r.json();}).then(function(d){
    if(d.ok){TK=d.token;document.getElementById('ls').style.display='none';var app=document.getElementById('app');app.style.display='flex';app.style.flexDirection='column';initWS();loadSC();loadStats();}
    else{document.getElementById('lerr').style.display='block';}
  }).catch(function(){document.getElementById('lerr').style.display='block';});
}
function logout(){TK='';if(ws)ws.close();location.reload();}
function initWS(){
  var proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(proto+'//'+location.host);
  ws.onopen=function(){ws.send(JSON.stringify({type:'admin_connect',token:TK}));};
  ws.onmessage=function(ev){
    var m=JSON.parse(ev.data);
    if(m.type==='connected'){m.sessions.forEach(function(s){SS[s.id]=s;});renderSL();}
    else if(m.type==='new_session'){SS[m.session.id]=m.session;renderSL();badge();}
    else if(m.type==='customer_message'){
      if(SS[m.sessionId]){SS[m.sessionId].messages=SS[m.sessionId].messages||[];SS[m.sessionId].messages.push(m.message);SS[m.sessionId].aiDraft=m.aiDraft;SS[m.sessionId].status='pending';}
      renderSL();if(asd===m.sessionId)renderChat(m.sessionId);badge();
    }else if(m.type==='reply_sent'){
      if(SS[m.sessionId])SS[m.sessionId].status='answered';
      renderSL();if(asd===m.sessionId)renderChat(m.sessionId);
    }
  };
  ws.onclose=function(){setTimeout(initWS,3000);};
}
function badge(){
  var p=Object.values(SS).filter(function(s){return s.status==='pending';}).length;
  ['lc','pc'].forEach(function(id){var el=document.getElementById(id);if(el){el.textContent=p;el.style.display=p>0?'inline':'none';}});
}
function renderSL(){
  var list=document.getElementById('sl');
  var ss=Object.values(SS).sort(function(a,b){return b.lastActivity-a.lastActivity;});
  if(!ss.length){list.innerHTML='<div class="ec">Ziadne aktivne chaty</div>';return;}
  var html='';
  ss.forEach(function(x){
    var lc={SK:'sk',CZ:'cz',HU:'hu'}[x.lang]||'sk';
    var last=x.messages&&x.messages.length>0?x.messages[x.messages.length-1]:null;
    var prev=last?(last.textSK||last.text||'').slice(0,36):'...';
    html+='<div class="ci'+(asd===x.id?' on':'')+'" data-sid="'+x.id+'" onclick="openChat(this)">';
    html+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">';
    html+='<span class="cn">'+ee(x.name||'Zakaznik')+'</span>';
    html+='<div style="display:flex;gap:3px">';
    if(x.status==='pending')html+='<span class="bdg new">!</span>';
    html+='<span class="bdg '+lc+'">'+(x.lang||'SK')+'</span></div></div>';
    html+='<div class="cp">'+ee(prev)+'</div></div>';
  });
  list.innerHTML=html;
  badge();
}
function openChat(el){
  var sid = typeof el === 'string' ? el : el.getAttribute('data-sid');asd=sid;if(tabs.indexOf(sid)<0)tabs.push(sid);if(tabs.length>3)tabs.shift();renderTabs();renderChat(sid);renderSL();}
function renderTabs(){
  var t=document.getElementById('ct');
  t.innerHTML=tabs.map(function(sid){
    var s=SS[sid];if(!s)return'';
    var lc={SK:'sk',CZ:'cz',HU:'hu'}[s.lang]||'sk';
    return '<div class="ctab'+(asd===sid?' on':'')+'" data-sid="'+sid+'" onclick="switchT(this)">'
      +e(s.name||'Zakaznik')+' <span class="bdg '+lc+'" style="font-size:10px">'+(s.lang||'SK')+'</span>'
      +'<span data-sid="'+sid+'" onclick="event.stopPropagation();closeT(this)" style="opacity:.5;font-size:11px;margin-left:4px">x</span></div>';
  }).join('');
}
function switchT(el){var sid=typeof el==='string'?el:el.getAttribute('data-sid');asd=sid;renderTabs();renderChat(sid);renderSL();}
function closeT(el){
  var sid=typeof el==='string'?el:el.getAttribute('data-sid');
  tabs=tabs.filter(function(t){return t!==sid;});
  if(asd===sid){asd=tabs.length>0?tabs[tabs.length-1]:null;}
  renderTabs();
  if(asd)renderChat(asd);
  else document.getElementById('cc').innerHTML='<div class="empty"><div style="font-size:36px">chat</div><div>Vyber konverzaciu</div></div>';
}
function renderChat(sid){
  var s=SS[sid];if(!s)return;
  var cc=document.getElementById('cc');
  var msgs=(s.messages||[]).map(function(m){
    if(m.role==='customer'){
      var hasOrig=m.text&&m.textSK&&m.text!==m.textSK;
      var lbl={CZ:'Zakaznik (cesky):',HU:'Zakaznik (madarsky):',SK:'Zakaznik:'}[s.lang]||'Zakaznik:';
      return '<div>'+(hasOrig?'<div class="morig">'+e(lbl)+' '+e(m.text)+'</div>':'')
        +'<div class="msk">'+e((m.textSK||m.text||'').toUpperCase())+'</div></div>';
    }else{
      return '<div style="align-self:flex-end;max-width:80%">'
        +'<div class="mopsk">Ty (SK): '+e(m.textSK||'')+'</div>'
        +'<div class="mop">'+e(m.text||'')+'</div></div>';
    }
  }).join('');
  var trgLang={SK:'slovenciny',CZ:'cestiny',HU:'madarciny'}[s.lang]||s.lang;
  var draft='';
  if(s.aiDraft){
    draft='<div class="adb">'
      +'<div class="adl">David navrhuje (zakaznik dostane prelozene do '+trgLang+'):</div>'
      +'<div class="adsk">'+e(s.aiDraft)+'</div>'
      +'<textarea class="ea" id="rta-'+sid+'">'+e(s.aiDraft)+'</textarea>'
      +'<div class="rbs">'
      +'<button class="bg" data-sid="'+sid+'" onclick="sendR(this,true)">Schvalit a odoslat</button>'
      +'<button class="bb" data-sid="'+sid+'" onclick="sendR(this,false)">Odoslat moju upravu</button>'
      +'</div></div>';
  }
  var schtml=SCS.map(function(sc){
    var t2=sc.text.replace(/\/g,'\\').replace(/'/g,"\'").replace(/
/g,'\n');
    return '<span class="sc" data-sid="'+sid+'" data-text="'+t2+'" onclick="insSC(this)">'+ee(sc.label)+'</span>';
  }).join('');
  cc.innerHTML='<div class="cbd" id="cbd-'+sid+'">'+msgs+'</div>'
    +'<div style="padding:10px 14px;border-top:1px solid #2e3350">'+draft+'</div>'
    +'<div class="scrow"><div class="sclbl">Skratky:</div>'+schtml+'</div>';
  var cb=document.getElementById('cbd-'+sid);if(cb)cb.scrollTop=cb.scrollHeight;
}
function insSC(sid,text){var ta=document.getElementById('rta-'+sid);if(ta)ta.value=text;}
function sendR(el,useOrig){
  var sid=typeof el==='string'?el:el.getAttribute('data-sid');
  var s=SS[sid];if(!s)return;
  var textSK=useOrig?s.aiDraft:(document.getElementById('rta-'+sid)||{value:s.aiDraft}).value;
  if(!textSK)return;
  s.messages=s.messages||[];
  s.messages.push({role:'operator',text:'(prekladam...)',textSK:textSK,timestamp:Date.now()});
  s.aiDraft=null;s.status='answered';
  renderChat(sid);
  fetch('/admin/reply',{method:'POST',headers:ah(),body:JSON.stringify({sessionId:sid,textSK:textSK})})
  .then(function(r){return r.json();}).then(function(d){
    if(d.ok&&SS[sid]){var lm=SS[sid].messages[SS[sid].messages.length-1];if(lm)lm.text=d.textTranslated;renderChat(sid);}
  });
}
function showTab(name,el){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('on');});
  el.classList.add('on');
  document.getElementById('tab-live').style.display='none';
  document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('on');});
  if(name==='live'){document.getElementById('tab-live').style.display='flex';}
  else{
    document.getElementById('tab-'+name).classList.add('on');
    if(name==='prompt')loadPrompt();
    if(name==='history')loadHistory();
    if(name==='ratings')loadRatings();
    if(name==='dashboard')loadStats();
  }
}
function loadStats(){
  fetch('/admin/stats',{headers:ah()}).then(function(r){return r.json();}).then(function(d){
    document.getElementById('sc').textContent=d.totalConv||0;
    document.getElementById('sm').textContent=d.totalMsgs||0;
    document.getElementById('sr').textContent=d.totalRatings||0;
    document.getElementById('sa').textContent=d.avgRating>0?'* '+d.avgRating:'--';
    if(d.bySite){document.getElementById('ssk').textContent=d.bySite['bezeckepotreby.sk']||0;document.getElementById('scz').textContent=d.bySite['runnie.cz']||0;document.getElementById('shu').textContent=d.bySite['runnie.hu']||0;}
  });
}
function loadPrompt(){
  fetch('/admin/prompt',{headers:ah()}).then(function(r){return r.json();}).then(function(d){document.getElementById('pta').value=d.prompt;});
}
function savePrompt(){
  var btn=document.getElementById('spb'),n=document.getElementById('pn');
  btn.disabled=true;btn.textContent='Ukladam...';n.className='nt';
  fetch('/admin/prompt',{method:'POST',headers:ah(),body:JSON.stringify({prompt:document.getElementById('pta').value})})
  .then(function(r){return r.json();}).then(function(d){n.textContent=d.ok?'Ulozene':'Chyba';n.className=d.ok?'nt ok':'nt er';})
  .finally(function(){btn.disabled=false;btn.textContent='Ulozit';setTimeout(function(){n.className='nt';},3500);});
}
function loadHistory(){
  var list=document.getElementById('hl');list.innerHTML='<div class="ec">Nacitavam...</div>';
  fetch('/admin/history',{headers:ah()}).then(function(r){return r.json();}).then(function(d){
    if(!d.conversations||!d.conversations.length){list.innerHTML='<div class="ec">Ziadna historia</div>';return;}
    list.innerHTML=d.conversations.map(function(c,i){
      var init=(c.userName||'?').split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);
      var lc={SK:'sk',CZ:'cz',HU:'hu'}[c.lang]||'sk';
      var date=c.lastActivity?new Date(c.lastActivity).toLocaleString('sk-SK',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
      var msgs=(c.messages||[]).map(function(m){return '<div class="hbb '+(m.role==='user'?'u':'a')+'">'+e(m.text||'')+'</div>';}).join('');
      return '<div class="hc" data-idx="'+i+'" onclick="var el=document.getElementById(\'hm\'+this.getAttribute(\'data-idx\'));if(el)el.classList.toggle(\'open\')">'+        +'<div class="hch"><div style="display:flex;align-items:center;gap:10px">'
        +'<div style="width:32px;height:32px;background:linear-gradient(135deg,#4f7cff,#7c5cff);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">'+init+'</div>'
        +'<div><div style="font-size:13px;font-weight:500">'+e(c.userName||'Neznamy')+'</div>'+(c.userEmail?'<div style="font-size:11px;color:#8b90b0">'+e(c.userEmail)+'</div>':'')+'</div></div>'
        +'<div style="display:flex;align-items:center;gap:8px"><span class="bdg '+lc+'">'+e(c.site||'')+'</span><span style="font-size:11px;color:#555a78">'+date+'</span></div></div>'
        +'<div class="hcm" id="hm'+i+'">'+msgs+'</div></div>';
    }).join('');
  });
}
function loadRatings(){
  var list=document.getElementById('rl');list.innerHTML='<div class="ec">Nacitavam...</div>';
  fetch('/admin/ratings',{headers:ah()}).then(function(r){return r.json();}).then(function(d){
    if(!d.ratings||!d.ratings.length){list.innerHTML='<div class="ec">Ziadne hodnotenia</div>';return;}
    list.innerHTML=d.ratings.map(function(r){
      var stars='*'.repeat(r.rating||0);
      var lc={SK:'sk',CZ:'cz',HU:'hu'}[r.lang]||'sk';
      var date=r.timestamp?new Date(r.timestamp).toLocaleString('sk-SK',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
      return '<div class="rc">'
        +'<div style="display:flex;align-items:center;gap:12px"><div class="stars">'+stars+'</div>'
        +'<div><div style="font-size:13px;font-weight:500">'+e(r.userName||'Neznamy')+'</div>'+(r.userEmail?'<div style="font-size:11px;color:#8b90b0">'+e(r.userEmail)+'</div>':'')+'</div></div>'
        +'<div style="display:flex;align-items:center;gap:8px"><span class="bdg '+lc+'">'+e(r.site||'')+'</span><div style="font-size:11px;color:#8b90b0">'+date+'</div></div></div>';
    }).join('');
  });
}
function loadSC(){
  fetch('/admin/shortcuts',{headers:ah()}).then(function(r){return r.json();}).then(function(d){SCS=d.shortcuts||[];renderSCE();});
}
function renderSCE(){
  var ed=document.getElementById('sce');
  ed.innerHTML=SCS.map(function(sc,i){
    return '<div class="scr">'
      +'<input class="sli" placeholder="Nazov" value="'+e(sc.label)+'" oninput="SCS['+i+'].label=this.value">'
      +'<input class="sti" placeholder="Text odpovede..." value="'+e(sc.text)+'" oninput="SCS['+i+'].text=this.value">'
      +'<button class="scd" onclick="SCS.splice('+i+',1);renderSCE()">x</button></div>';
  }).join('');
}
function addSC(){SCS.push({id:Date.now(),label:'',text:''});renderSCE();}
function saveSC(){
  var n=document.getElementById('scn');
  fetch('/admin/shortcuts',{method:'POST',headers:ah(),body:JSON.stringify({shortcuts:SCS})})
  .then(function(r){return r.json();}).then(function(d){n.textContent=d.ok?'Ulozene':'Chyba';n.className=d.ok?'nt ok':'nt er';setTimeout(function(){n.className='nt';},3000);});
}
function changePw(){
  var pw=document.getElementById('npw').value,n=document.getElementById('pwn');
  if(!pw||pw.length<6){n.textContent='Heslo musi mat aspon 6 znakov.';n.className='nt er';return;}
  fetch('/admin/change-password',{method:'POST',headers:ah(),body:JSON.stringify({newPassword:pw})})
  .then(function(r){return r.json();}).then(function(d){
    if(d.ok){TK=d.newToken;document.getElementById('npw').value='';n.textContent='Heslo zmenene!';n.className='nt ok';setTimeout(function(){n.className='nt';},4000);}
    else{n.textContent='Chyba';n.className='nt er';}
  });
}

