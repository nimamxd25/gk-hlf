// ============ 我的生词本 · 简洁 Anki 界面 ============
// 数据：word/meaning/thinking(思考)/image(仓库图片名)/SM2
// 同步：words.json + progress.json + images/ 全存 GitHub 仓库
(function(){
'use strict';

const STORE_KEY='gk_cards_v2', SETTINGS_KEY='gk_settings', GH_KEY='gk_gh';
const GH_API='https://api.github.com';

const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const addDays=(s,n)=>{const p=s.split('-');const d=new Date(+p[0],+p[1]-1,+p[2]+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const uid=()=>'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const timeAgo=t=>{if(!t)return'';const s=(Date.now()-new Date(t))/1000;if(s<60)return'刚刚';if(s<3600)return Math.floor(s/60)+'分钟前';if(s<86400)return Math.floor(s/3600)+'小时前';const d=new Date(t);return `${d.getMonth()+1}月${d.getDate()}日`;};
const STATUS={fresh:'🆕 新词',learning:'⏳ 学习中',reviewing:'🔁 复习中',mastered:'✅ 已掌握'};

// ---------- 存储 ----------
let allCards=[];
function loadCards(){try{const r=localStorage.getItem(STORE_KEY);if(r)return JSON.parse(r);}catch(e){}return null;}
function saveCards(){try{localStorage.setItem(STORE_KEY,JSON.stringify(allCards));}catch(e){console.error(e);}}
let settings={dailyNew:20,theme:'light'};
function loadSettings(){try{Object.assign(settings,JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'));}catch(e){}applyTheme();}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));applyTheme();}
function applyTheme(){if(settings.theme==='dark')document.documentElement.setAttribute('data-theme','dark');else document.documentElement.removeAttribute('data-theme');}
function ghConfig(){try{return JSON.parse(localStorage.getItem(GH_KEY)||'{}');}catch(e){}return{};}
function saveGh(c){localStorage.setItem(GH_KEY,JSON.stringify(c));}
const ghReady=()=>{const g=ghConfig();return !!(g&&g.token&&g.user&&g.repo);};

// ---------- 卡片 ----------
function state0(){return{status:'fresh',ef:2.5,interval:0,reps:0,lapses:0,due:todayStr(),totalRating:0,history:[]};}
function newCard(f){return{id:uid(),word:f.word||'',meaning:f.meaning||'',thinking:f.thinking||'',image:f.image||'',updated_at:new Date().toISOString(),source:'手动',...state0()};}

// ---------- GitHub API ----------
async function ghGet(path){
  const g=ghConfig();
  const url=`${GH_API}/repos/${g.user}/${g.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(g.branch||'main')}`;
  try{const r=await fetch(url,{headers:{Authorization:`token ${g.token}`,Accept:'application/vnd.github+json'}});
    if(r.ok){const j=await r.json();return{content:decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))),sha:j.sha};}
    if(r.status===404)return{content:null,sha:null};return null;}catch(e){return null;}
}
async function ghPutText(path,text,msg){
  const g=ghConfig();const url=`${GH_API}/repos/${g.user}/${g.repo}/contents/${encodeURIComponent(path)}`;
  const body={message:msg||'update',content:btoa(unescape(encodeURIComponent(text)))};
  const ex=await ghGet(path);if(ex&&ex.sha)body.sha=ex.sha;
  try{const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${g.token}`,Accept:'application/vnd.github+json'},body:JSON.stringify(body)});return r.ok;}catch(e){return false;}
}
async function ghPutImage(path,base64Data,msg){
  const g=ghConfig();const url=`${GH_API}/repos/${g.user}/${g.repo}/contents/${encodeURIComponent(path)}`;
  const body={message:msg||'upload image',content:base64Data};
  const ex=await ghGet(path);if(ex&&ex.sha)body.sha=ex.sha;
  try{const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${g.token}`,Accept:'application/vnd.github+json'},body:JSON.stringify(body)});return r.ok;}catch(e){return false;}
}
// 生成图片的 raw 完整 URL（上传成功后在保存时记录到 card.image）
function rawImageURL(name){const g=ghConfig();const b=g.branch||'main';return `https://raw.githubusercontent.com/${g.user}/${g.repo}/${b}/images/${name}`;}

// ---------- 同步 ----------
function buildWordsJSON(){return JSON.stringify(allCards.map(c=>({id:c.id,word:c.word,meaning:c.meaning,thinking:c.thinking,image:c.image,updated_at:c.updated_at})),null,2);}
function buildProgressJSON(){return JSON.stringify({app:'gkCiHui',updated:new Date().toISOString(),cards:allCards.map(c=>({id:c.id,status:c.status,ef:c.ef,interval:c.interval,reps:c.reps,lapses:c.lapses,due:c.due,totalRating:c.totalRating,history:c.history}))},null,2);}
async function pushAll(){if(!ghReady())return false;await ghPutText('words.json',buildWordsJSON(),'auto sync words');await ghPutText('progress.json',buildProgressJSON(),'auto sync progress');return true;}
async function pullAll(){
  if(!ghReady())return false;
  const w=await ghGet('words.json');
  if(w&&w.content){try{const remote=JSON.parse(w.content);if(Array.isArray(remote)){
    const map=new Map(remote.map(c=>[c.id,c]));
    allCards.forEach(c=>{if(map.has(c.id)){const r=map.get(c.id);Object.assign(c,{word:r.word,meaning:r.meaning,thinking:r.thinking,image:r.image,updated_at:r.updated_at});}});
    map.forEach((c,id)=>{if(!allCards.some(x=>x.id===id))allCards.push({...newCard(c),...c});});
    saveCards();
  }}catch(e){}}
  return true;
}

// ---------- 摘要 ----------
function updateSummary(){
  const fresh=allCards.filter(c=>c.status==='fresh').length;
  const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr()).length;
  const mastered=allCards.filter(c=>c.status==='mastered').length;
  document.getElementById('sNew').textContent=fresh;
  document.getElementById('sDue').textContent=due;
  document.getElementById('sMastered').textContent=mastered;
  document.getElementById('sTotal').textContent=allCards.length;
}

// ---------- 视图 ----------
let currentSearch='', currentFilter='all', browseMode=false;
function renderCurrentView(){
  if(browseMode||currentSearch||currentFilter!=='all'){renderLibrary();return;}
  const v=document.getElementById('view');
  const fresh=allCards.filter(c=>c.status==='fresh');
  const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr());
  if(!allCards.length){
    v.innerHTML=`<div class="empty"><div class="icon">🌱</div><div>词库还是空的<br>记录你的第一个生词吧</div>
      <button id="emptyAdd">＋ 添加生词</button></div>`;
    document.getElementById('emptyAdd').onclick=openEditor;
    return;
  }
  let html=`<div class="section-title"><span>📌 待学/待复习</span></div>`;
  if(fresh.length){
    html+=`<div class="section-title"><span>🆕 今日待学（${fresh.length}）</span></div>`;
    fresh.slice(0,20).forEach(c=>html+=cardHTML(c));
  } else if(due.length){
    html+=`<div class="section-title"><span>⏰ 今日待复习（${due.length}）</span></div>`;
    due.slice(0,20).forEach(c=>html+=cardHTML(c));
  } else {
    html+=`<div class="empty"><div class="icon">🎉</div><div>今日任务已全部完成！</div></div>`;
  }
  v.innerHTML=html;
  bindCardActions(v);
}
function cardHTML(c){
  const tag=STATUS[c.status]||'🆕 新词';
  const word=esc(c.word||'');
  const meaning=esc(c.meaning||'')||'<i style="color:var(--muted)">（暂无解释）</i>';
  const think=c.thinking?`<div class="wc-think">${esc(c.thinking)}</div>`:'';
  const img=c.image?`<div class="wc-image"><img src="${esc(c.image)}" loading="lazy" onerror="this.style.display='none'"></div>`:'';
  return `<div class="word-card" data-id="${c.id}">
    <div class="wc-top"><span class="wc-word">${word}</span><span class="wc-tag">${tag}</span></div>
    <div class="wc-meaning">${meaning}</div>
    ${think}
    ${img}
    <div class="wc-action">
      <button class="edit" data-id="${c.id}">编辑</button>
      <button class="study" data-id="${c.id}">学习</button>
    </div>
  </div>`;
}
function goLibrary(){browseMode=true;currentSearch='';currentFilter='all';document.getElementById('searchInput').value='';renderCurrentView();}
function renderLibrary(){
  const v=document.getElementById('view');
  let list=allCards;
  if(currentFilter!=='all')list=list.filter(c=>c.status===currentFilter);
  if(currentSearch){const q=currentSearch.trim();list=list.filter(c=>c.word.includes(q)||(c.meaning||'').includes(q)||(c.thinking||'').includes(q));}
  const backBar=browseMode?`<div class="lib-back"><button data-back-home>‹ 返回今日</button><span>${allCards.length} 个词</span></div>`:'';
  if(!list.length){v.innerHTML=`${backBar}<div class="empty"><div class="icon">🔍</div><div>没有匹配的词</div></div>`;return;}
  v.innerHTML=`${backBar}<div class="section-title"><span>词库 · ${list.length} 词</span></div>${list.map(cardHTML).join('')}`;
  bindCardActions(v);
}
function bindCardActions(v){
  v.querySelectorAll('.edit').forEach(b=>b.onclick=e=>{e.stopPropagation();openEditor(allCards.find(x=>x.id===b.dataset.id));});
  v.querySelectorAll('.study').forEach(b=>b.onclick=e=>{e.stopPropagation();startStudy([b.dataset.id]);});
}

// ---------- 编辑器 ----------
let editingId=null, pendingImageData=null, imageRemovedRecently=false;
function openEditor(card){
  editingId=card?card.id:null;pendingImageData=null;imageRemovedRecently=false;
  document.getElementById('editorTitle').textContent=card?'编辑生词':'记录生词';
  document.getElementById('eWord').value=card?card.word:'';
  document.getElementById('eMeaning').value=card?card.meaning:'';
  document.getElementById('eThinking').value=card?card.thinking:'';
  const img=document.getElementById('eImagePreview'),rem=document.getElementById('eImageRemove'),ibt=document.getElementById('imageBtnText');
  if(card&&card.image){img.src=card.image;img.classList.remove('hidden');rem.classList.remove('hidden');ibt.textContent='更换图片';}
  else{img.classList.add('hidden');rem.classList.add('hidden');ibt.textContent='＋ 添加图片';}
  document.getElementById('editor').classList.remove('hidden');
}
function closeEditor(){document.getElementById('editor').classList.add('hidden');}
function bindEditor(){
  document.getElementById('editor').querySelector('[data-close]').onclick=closeEditor;
  document.getElementById('editor').addEventListener('click',e=>{if(e.target===document.getElementById('editor'))closeEditor();});
  document.getElementById('eImage').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=()=>{const m=r.result.match(/^data:[^;]+;base64,(.+)$/);if(m){pendingImageData=m[2];window.__pid=m[2].slice(0,10);}else{window.__pid='NO-MATCH:'+r.result.slice(0,30);}
      const img=document.getElementById('eImagePreview'),rem=document.getElementById('eImageRemove'),ibt=document.getElementById('imageBtnText');
      img.src=r.result;img.classList.remove('hidden');rem.classList.remove('hidden');ibt.textContent='更换图片';};
    r.readAsDataURL(f);
  };
  document.getElementById('eImageRemove').onclick=()=>{pendingImageData=null;imageRemovedRecently=true;document.getElementById('eImage').value='';
    document.getElementById('eImagePreview').classList.add('hidden');document.getElementById('eImageRemove').classList.add('hidden');document.getElementById('imageBtnText').textContent='＋ 添加图片';};
  document.getElementById('eSave').onclick=async()=>{
    const word=document.getElementById('eWord').value.trim();
    const meaning=document.getElementById('eMeaning').value.trim();
    const thinking=document.getElementById('eThinking').value.trim();
    if(!word){toast('请输入词语');return;}
    let card;
    if(editingId)card=allCards.find(c=>c.id===editingId);
    if(card){card.word=word;card.meaning=meaning;card.thinking=thinking;card.updated_at=new Date().toISOString();}
    else{card=newCard({word,meaning,thinking});allCards.push(card);}
    if(pendingImageData&&typeof pendingImageData==='string'){
      const name=`${card.id}.png`;
      if(ghReady()){
        const ok=await ghPutImage('images/'+name,pendingImageData,'upload '+name);
        if(ok){ card.image=rawImageURL(name); } // 存完整URL，卡片直接用
        else{ toast('⚠️ 图片上传失败'); }
      } else {
        toast('⚠️ 未配置GitHub，无法上传图片，请在设置里填写');
      }
      pendingImageData=null;
    }else if(pendingImageData===null&&imageRemovedRecently){card.image='';imageRemovedRecently=false;}
    saveCards();closeEditor();renderCurrentView();updateSummary();
    toast(`已保存「${word}」`);
    pushAll();
  };
}

// ---------- 学习流程 ----------
let studyQueue=[],studyIndex=0;let refs;
function grabRefs(){refs={front:document.getElementById('cardFront'),back:document.getElementById('cardBack'),label:document.getElementById('cardLabel'),pos:document.getElementById('cardPosition'),hint:document.getElementById('cardHint'),gradeRow:document.getElementById('gradeRow'),flipCard:document.getElementById('flipCard'),overlay:document.getElementById('overlay')};}
function startStudy(ids){
  grabRefs();
  const cards=ids.map(id=>allCards.find(c=>c.id===id)).filter(Boolean);
  if(!cards.length){toast('没有可选词');return;}
  studyQueue=cards;studyIndex=0;
  refs.overlay.classList.remove('hidden');refs.hint.classList.remove('hidden');refs.gradeRow.classList.add('hidden');
  refs.label.textContent=cards.every(c=>c.status==='fresh')?'今日新词':'复习';
  renderStudyCard();
}
function renderStudyCard(){
  const c=studyQueue[studyIndex];
  refs.pos.textContent=(studyIndex+1)+' / '+studyQueue.length;
  refs.front.innerHTML=`<div class="flip-word">${esc(c.word)}</div><div class="flip-pos">来源：${esc(c.source||'手动')}</div>`;
  let p=`<div class="back-word">${esc(c.word)}</div>`;
  if(c.meaning){p+=`<div class="back-label">📖 释义</div><div class="back-text">${esc(c.meaning)}</div>`;}
  if(c.thinking){p+=`<div class="back-label">💡 思考</div><div class="back-think">${esc(c.thinking)}</div>`;}
  if(c.image){p+=`<div class="back-label">🖼 图片</div><div class="back-image"><img src="${esc(c.image)}"></div>`;}
  refs.back.innerHTML=p;
  refs.flipCard.classList.remove('flipped');refs.hint.classList.remove('hidden');refs.gradeRow.classList.add('hidden');
  refs.back.scrollTop=0;
}
function flip(){refs.flipCard.classList.toggle('flipped');if(refs.flipCard.classList.contains('flipped')){refs.hint.classList.add('hidden');refs.gradeRow.classList.remove('hidden');}}
function gradeFromButton(g){const c=studyQueue[studyIndex];applyGrade(c,g);saveCards();studyIndex++;if(studyIndex<studyQueue.length)renderStudyCard();else endStudy();}
function endStudy(){refs.overlay.classList.add('hidden');toast('本组学习完成 🎉');saveCards();pushAll();updateSummary();renderCurrentView();}
function applyGrade(c,g){
  const s=c;
  if(s.status==='fresh'||s.status==='learning'){
    if(g<=0){s.status='learning';s.interval=0;s.reps=0;s.due=todayStr();}
    else if(g===1){s.status='learning';s.interval=1;s.reps=1;s.due=addDays(todayStr(),1);}
    else{s.status='reviewing';s.interval=g===3?4:2;s.reps=1;s.ef=g===3?2.6:2.5;s.due=addDays(todayStr(),s.interval);}
  }else{
    if(g<=0){s.lapses++;s.reps=0;s.interval=1;s.status='learning';s.ef=Math.max(1.3,s.ef-0.2);s.due=todayStr();}
    else if(g===1){s.interval=1;s.reps++;s.due=addDays(todayStr(),1);}
    else if(g===2){s.reps++;s.interval=s.reps===1?1:Math.round(s.interval*s.ef);s.due=addDays(todayStr(),s.interval);if(s.interval>=21)s.status='mastered';}
    else{s.ef=Math.min(2.9,s.ef+0.1);s.reps++;s.interval=s.reps===1?1:Math.round(s.interval*s.ef*1.3);s.due=addDays(todayStr(),s.interval);if(s.interval>=21)s.status='mastered';}
  }
  s.totalRating+=g;s.history=s.history||[];s.history.push({date:todayStr(),grade:g});return s;
}
function reviewFlow(){
  const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr());
  const learned=allCards.filter(c=>c.status!=='fresh');
  if(due.length){startStudy(due.map(c=>c.id));refs.label.textContent='复习';}
  else if(learned.length){startStudy(learned.slice(0,settings.dailyNew).map(c=>c.id));refs.label.textContent='巩固复习';}
  else toast('还没有已学词汇，先学习吧');
}

// ---------- 设置 ----------
function openSettings(){
  const g=ghConfig();
  document.getElementById('sDaily').value=settings.dailyNew;
  document.getElementById('sTheme').value=settings.theme;
  document.getElementById('ghUser').value=g.user||'';
  document.getElementById('ghRepo').value=g.repo||'';
  document.getElementById('ghBranch').value=g.branch||'main';
  document.getElementById('ghToken').value=g.token||'';
  document.getElementById('settings').classList.remove('hidden');
}
function closeSettings(){document.getElementById('settings').classList.add('hidden');}
function bindSettings(){
  const st=document.getElementById('settings');
  st.querySelector('[data-close]').onclick=closeSettings;
  st.addEventListener('click',e=>{if(e.target===st)closeSettings();});
  document.getElementById('sSave').onclick=()=>{saveGhForm();toast('设置已保存 ✔');closeSettings();};
  document.getElementById('sPull').onclick=async()=>{saveGhForm();toast('拉取中…');await pullAll();renderCurrentView();updateSummary();toast(ghReady()?'已拉取并合并 ✔':'⚠️ 未配置GitHub，请填写配置');};
  document.getElementById('sPush').onclick=async()=>{saveGhForm();const ok=await pushAll();toast(ok?'已同步到仓库 ✔':'⚠️ 同步失败，请检查配置是否填写正确');};
  document.getElementById('sExport').onclick=()=>{const blob=new Blob([JSON.stringify(allCards,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='生词本备份_'+todayStr()+'.json';a.click();toast('已导出备份');};
}
// 把设置表单里的 GitHub 配置立即写入 localStorage
function saveGhForm(){
  settings.dailyNew=Math.min(100,Math.max(1,+document.getElementById('sDaily').value||20));
  settings.theme=document.getElementById('sTheme').value;saveSettings();
  saveGh({user:document.getElementById('ghUser').value.trim(),repo:document.getElementById('ghRepo').value.trim(),branch:document.getElementById('ghBranch').value.trim()||'main',token:document.getElementById('ghToken').value.trim()});
}

// ---------- 事件 ----------
function bindEvents(){
  document.getElementById('btnStudy').onclick=()=>{browseMode=false;currentSearch='';document.getElementById('searchInput').value='';renderCurrentView();
    const fresh=allCards.filter(c=>c.status==='fresh');
    if(fresh.length)startStudy(fresh.slice(0,settings.dailyNew).map(c=>c.id));
    else{const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr());if(due.length)reviewFlow();else toast('还没有新词，先添加或去复习');}
  };
  document.getElementById('btnReview').onclick=()=>{browseMode=false;currentSearch='';document.getElementById('searchInput').value='';renderCurrentView();reviewFlow();};
  document.getElementById('btnLibrary').onclick=goLibrary;
  // "总词汇"卡片点击也进入词库
  const totalCell=document.getElementById('totalCell');
  if(totalCell) totalCell.onclick=goLibrary;
  document.querySelectorAll('[data-goto="library"]').forEach(el=>{ if(el&&el.id!=='totalCell') el.onclick=goLibrary; });
  // 词库视图内的"返回今日"按钮（委托点击）
  document.getElementById('view').addEventListener('click',e=>{
    const back=e.target.closest('[data-back-home]');
    if(back){browseMode=false;currentSearch='';document.getElementById('searchInput').value='';renderCurrentView();}
  });
  document.getElementById('btnAdd').onclick=()=>{browseMode=false;openEditor();};
  document.getElementById('btnSettings').onclick=openSettings;
  document.getElementById('searchInput').addEventListener('input',e=>{browseMode=true;currentSearch=e.target.value;renderLibrary();});
  document.getElementById('flipCard').addEventListener('click',flip);
  document.querySelectorAll('#gradeRow .grade').forEach(b=>b.onclick=()=>gradeFromButton(+b.dataset.grade));
}

// ---------- boot ----------
function boot(){
  loadSettings();
  const stored=loadCards();
  if(stored&&Array.isArray(stored))allCards=stored;else{allCards=[];saveCards();}
  updateSummary();renderCurrentView();
  bindEditor();bindSettings();bindEvents();
  if(ghReady())setTimeout(()=>pullAll().then(()=>{updateSummary();renderCurrentView();}),600);
}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),2200);}

// ---------- 暴露给快捷指令 / 外部 ----------
window.__pushNow=function(){return pushAll();};
window.__configureGh=function(u,r,b,t){saveGh({user:u,repo:r,branch:b||'main',token:t});return !!u&&!!r&&!!t;};
window.__uploadImage=function(name,base64){return ghPutImage('images/'+name,base64,'upload '+name);};
window.__addCardFromShortcut=async function(word,meaning,thinking,imageName,imageBase64){
  const card=newCard({word,meaning,thinking});
  allCards.push(card);saveCards();
  if(imageBase64&&imageName){
    const ok=await ghPutImage('images/'+imageName,imageBase64,'upload '+imageName);
    if(ok)card.image=rawImageURL(imageName);
  } else if(imageName) {
    // 已上传过，直接用URL
    card.image=rawImageURL(imageName);
  }
  saveCards();
  await pushAll();updateSummary();renderCurrentView();
  return card.id;
};

window.addEventListener('load',boot);
})();
