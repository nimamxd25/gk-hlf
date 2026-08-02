// ============ 我的生词卡 · flomo 风格 ============
// 数据：word/meaning(解释)/thinking(思考)/image(仓库图片名)/SM2进度
// 同步：words.json(词条) + progress.json(进度) + images/(图片) 全存 GitHub 私有仓库
(function(){
'use strict';

const STORE_KEY='gk_cards_v2';
const SETTINGS_KEY='gk_settings';
const GH_KEY='gk_gh';
const GH_API='https://api.github.com';

// ---------- 音/工具 ----------
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const addDays=(s,n)=>{const p=s.split('-');const d=new Date(+p[0],+p[1]-1,+p[2]+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const uid=()=>'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const timeAgo=t=>{if(!t)return '';const s=(Date.now()-new Date(t))/1000;if(s<60)return '刚刚';if(s<3600)return Math.floor(s/60)+'分钟前';if(s<86400)return Math.floor(s/3600)+'小时前';const d=new Date(t);return `${d.getMonth()+1}月${d.getDate()}日`;};

// ---------- 存储 ----------
let allCards=[];
function loadCards(){ try{const r=localStorage.getItem(STORE_KEY);if(r)return JSON.parse(r);}catch(e){} return null; }
function saveCards(){ try{localStorage.setItem(STORE_KEY,JSON.stringify(allCards));}catch(e){console.error(e);} }
// 设置
let settings={dailyNew:20,theme:'light'};
function loadSettings(){try{Object.assign(settings,JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'));}catch(e){}applyTheme();}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));applyTheme();}
function applyTheme(){if(settings.theme==='dark')document.documentElement.setAttribute('data-theme','dark');else document.documentElement.removeAttribute('data-theme');}
// GitHub 配置
function ghConfig(){try{return JSON.parse(localStorage.getItem(GH_KEY)||'{}');}catch(e){}return{};}
function saveGh(c){localStorage.setItem(GH_KEY,JSON.stringify(c));}
const ghReady=()=>{const g=ghConfig();return !!(g&&g.token&&g.user&&g.repo);};

// ---------- SM-2 初始 ----------
function state0(){
  return {status:'fresh',ef:2.5,interval:0,reps:0,lapses:0,due:todayStr(),totalRating:0,history:[]};
}
function newCard(fields){
  return {id:uid(),word:fields.word||'',meaning:fields.meaning||'',thinking:fields.thinking||'',
    image:fields.image||'',updated_at:new Date().toISOString(),source:'手动',...state0()};
}

// ---------- GitHub API ----------
async function ghGet(path){
  const g=ghConfig();
  const url=`${GH_API}/repos/${g.user}/${g.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(g.branch||'main')}`;
  try{
    const r=await fetch(url,{headers:{Authorization:`token ${g.token}`,Accept:'application/vnd.github+json'}});
    if(r.ok){const j=await r.json();return {content:decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))),sha:j.sha};}
    if(r.status===404)return {content:null,sha:null};
    return null;
  }catch(e){return null;}
}
// 写入文本文件（用于 words.json / progress.json）
async function ghPutText(path,text,msg){
  const g=ghConfig();
  const url=`${GH_API}/repos/${g.user}/${g.repo}/contents/${encodeURIComponent(path)}`;
  const body={message:msg||'update',content:btoa(unescape(encodeURIComponent(text)))};
  const ex=await ghGet(path);
  if(ex&&ex.sha)body.sha=ex.sha;
  try{const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${g.token}`,Accept:'application/vnd.github+json'},body:JSON.stringify(body)});return r.ok;}catch(e){return false;}
}
// 上传图片（二进制 -> base64），返回是否成功
async function ghPutImage(path,base64Data,msg){
  const g=ghConfig();
  const url=`${GH_API}/repos/${g.user}/${g.repo}/contents/${encodeURIComponent(path)}`;
  const body={message:msg||'upload image',content:base64Data};
  const ex=await ghGet(path);
  if(ex&&ex.sha)body.sha=ex.sha;
  try{const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${g.token}`,Accept:'application/vnd.github+json'},body:JSON.stringify(body)});return r.ok;}catch(e){return false;}
}
// 图片的公开/仓库 URL（页面里可直接 <img src=...> 用仓库 raw，但私有仓库需认证。公开仓库可直接用 raw URL）
function imageURL(name,size=200){
  const g=ghConfig();
  const branch=g.branch||'main';
  // 公开仓库用 raw.githubusercontent.com
  return `https://raw.githubusercontent.com/${g.user}/${g.repo}/${branch}/images/${name}`;
}

// ---------- 同步数据 ----------
function buildWordsJSON(){
  return JSON.stringify(allCards.map(c=>({id:c.id,word:c.word,meaning:c.meaning,thinking:c.thinking,image:c.image,updated_at:c.updated_at})),null,2);
}
function buildProgressJSON(){
  return JSON.stringify({app:'gkCiHui',updated:new Date().toISOString(),
    cards:allCards.map(c=>({id:c.id,status:c.status,ef:c.ef,interval:c.interval,reps:c.reps,lapses:c.lapses,due:c.due,totalRating:c.totalRating,history:c.history}))},null,2);
}
async function pushAll(){
  if(!ghReady())return false;
  await ghPutText('words.json',buildWordsJSON(),'auto sync words');
  await ghPutText('progress.json',buildProgressJSON(),'auto sync progress');
  return true;
}
async function pullAll(){
  if(!ghReady())return false;
  const w=await ghGet('words.json');
  if(w&&w.content){
    try{
      const remote=JSON.parse(w.content);
      if(Array.isArray(remote)){
        const map=new Map(remote.map(c=>[c.id,c]));
        // 合并：远端有新词则加入，保留本地已删除差异（简单合并：若远端有而本地无则加）
        allCards.forEach(c=>{ if(map.has(c.id)){ const r=map.get(c.id); Object.assign(c,{word:r.word,meaning:r.meaning,thinking:r.thinking,image:r.image,updated_at:r.updated_at}); } });
        map.forEach((c,id)=>{ if(!allCards.some(x=>x.id===id)) allCards.push({...newCard(c),...c}); });
        saveCards();
      }
    }catch(e){}
  }
  return true;
}

// ---------- 视图：flomo 信息流 ----------
function renderStream(){
  const stream=document.getElementById('stream');
  if(!allCards.length){
    stream.innerHTML=`<div class="empty"><div class="icon">🗂</div><div>还没有生词卡片</div>
      <button id="emptyAdd">＋ 记录第一个生词</button></div>`;
    const b=document.getElementById('emptyAdd'); if(b)b.onclick=openEditor;
    return;
  }
  const fresh=allCards.filter(c=>c.status==='fresh').length;
  const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr()).length;
  let html='';
  // 学习引导卡
  html+=`<div class="lead" id="leadCard">
    <div class="lead-info">
      ${fresh>0?`<span class="lead-num">${fresh}</span><span class="lead-lbl">待学新词</span>`:due>0?`<span class="lead-num">${due}</span><span class="lead-lbl">今日待复习</span>`:`<span class="lead-num">✓</span><span class="lead-lbl">今日完成</span>`}
    </div>
    <button class="lead-btn" id="leadBtn">${fresh>0?'开始学习':due>0?'去复习':'复习巩固'}</button>
  </div>`;
  // 词卡列表（按更新时间倒序）
  const sorted=[...allCards].sort((a,b)=>(b.updated_at||'')>(a.updated_at||'')?1:-1);
  sorted.forEach(c=>{
    html+=`<div class="card" data-id="${c.id}">
      <div class="card-word">${esc(c.word)}<span class="card-tag">${statusTag(c.status)}</span></div>
      <div class="card-mean">${esc(c.meaning)||'<i style="color:var(--muted)">（暂无解释）</i>'}</div>
      ${c.thinking?`<div class="card-think">${esc(c.thinking)}</div>`:''}
      ${c.image?`<div class="card-image"><img src="${esc(imageURL(c.image))}" loading="lazy"></div>`:''}
      <div class="card-foot">
        <span class="card-time">${esc(timeAgo(c && c.updated_at))}</span>
        <div class="card-actions">
          <button class="edit" data-id="${c.id}">编辑</button>
          <button class="study" data-id="${c.id}">学习</button>
        </div>
      </div>
    </div>`;
  });
  stream.innerHTML=html;
  const lf=document.getElementById('leadBtn'); if(lf)lf.onclick=leadStudy;
  stream.querySelectorAll('.card .edit').forEach(b=>b.onclick=e=>{e.stopPropagation();openEditor(allCards.find(x=>x.id===b.dataset.id));});
  stream.querySelectorAll('.card .study').forEach(b=>b.onclick=e=>{e.stopPropagation();startStudy([b.dataset.id]);});
}
function statusTag(s){return {fresh:'新词',learning:'学习中',reviewing:'复习中',mastered:'已掌握'}[s]||s;}
function leadStudy(){
  const fresh=allCards.filter(c=>c.status==='fresh');
  const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr());
  if(fresh.length)return startStudy(fresh.slice(0,settings.dailyNew).map(c=>c.id));
  if(due.length)return startStudy(due.map(c=>c.id));
  const learned=allCards.filter(c=>c.status!=='fresh');
  if(learned.length)return startStudy(learned.slice(0,settings.dailyNew).map(c=>c.id));
  toast('还没有词，先添加一个');
}

// ---------- 编辑器（新增/编辑） ----------
let editingId=null, pendingImageData=null;
function openEditor(card){
  editingId=card?card.id:null;
  pendingImageData=null;
  imageRemovedRecently=false;
  const modal=document.getElementById('editor');
  document.getElementById('eWord').value=card?card.word:'';
  document.getElementById('eMeaning').value=card?card.meaning:'';
  document.getElementById('eThinking').value=card?card.thinking:'';
  document.querySelector('.editor-title').textContent = card?'编辑生词':'记录生词';
  const img=document.getElementById('eImagePreview'), rem=document.getElementById('eImageRemove'), ibt=document.getElementById('imageBtnText');
  if(card&&card.image){
    img.src=imageURL(card.image); img.classList.remove('hidden'); rem.classList.remove('hidden');
    ibt.textContent='更换图片';
  }else{
    img.classList.add('hidden'); rem.classList.add('hidden'); ibt.textContent='＋ 添加图片';
  }
  modal.classList.remove('hidden');
}
function closeEditor(){ document.getElementById('editor').classList.add('hidden'); }
function bindEditor(){
  document.getElementById('editor').querySelector('[data-close]').onclick=closeEditor;
  document.getElementById('editor').addEventListener('click',e=>{if(e.target===document.getElementById('editor'))closeEditor();});
  // 图片选择
  document.getElementById('eImage').onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{
      // reader.result 是 data:image/png;base64,...
      const m=reader.result.match(/^data:([^;]+);base64,(.+)$/);
      if(m){ pendingImageData=m[2]; }
      const img=document.getElementById('eImagePreview'),rem=document.getElementById('eImageRemove'),ibt=document.getElementById('imageBtnText');
      img.src=reader.result; img.classList.remove('hidden'); rem.classList.remove('hidden'); ibt.textContent='更换图片';
    };
    reader.readAsDataURL(f);
  };
  document.getElementById('eImageRemove').onclick=()=>{
    pendingImageData=null;
    imageRemovedRecently=true;
    document.getElementById('eImage').value='';
    document.getElementById('eImagePreview').classList.add('hidden');
    document.getElementById('eImageRemove').classList.add('hidden');
    document.getElementById('imageBtnText').textContent='＋ 添加图片';
  };
  // 保存
  document.getElementById('eSave').onclick=async ()=>{
    const word=document.getElementById('eWord').value.trim();
    const meaning=document.getElementById('eMeaning').value.trim();
    const thinking=document.getElementById('eThinking').value.trim();
    if(!word){toast('请输入词语');return;}
    let card;
    if(editingId){ card=allCards.find(c=>c.id===editingId); }
    if(card){ card.word=word; card.meaning=meaning; card.thinking=thinking; card.updated_at=new Date().toISOString(); }
    else { card=newCard({word,meaning,thinking}); allCards.push(card); }
    // 图片处理：若用户选了新图（pendingImageData 有数据），上传到仓库并记录
    if(pendingImageData && typeof pendingImageData==='string'){
      const name=`${card.id}.png`;
      card.image=name;
      if(ghReady()){
        const ok=await ghPutImage('images/'+name, pendingImageData, 'upload image '+name);
        if(!ok) toast('⚠️ 图片上传失败（可稍后补）');
      } else {
        card.image=name; // 仍记录，即使未上传（图会缺失）
      }
      pendingImageData=null;
    } else if(pendingImageData===null && imageRemovedRecently){
      card.image='';
      imageRemovedRecently=false;
    }
    saveCards();
    closeEditor();
    renderStream();
    toast(`已保存「${word}」`);
    pushAll(); // 后台同步到仓库，不阻塞界面
  };
}
let imageRemovedRecently=false;

// ---------- 学习流程 ----------
let studyQueue=[],studyIndex=0;
let refs;
function grabRefs(){
  refs={front:document.getElementById('cardFront'),back:document.getElementById('cardBack'),
    label:document.getElementById('cardLabel'),pos:document.getElementById('cardPosition'),
    hint:document.getElementById('cardHint'),gradeRow:document.getElementById('gradeRow'),
    flipCard:document.getElementById('flipCard'),overlay:document.getElementById('overlay')};
}
function startStudy(ids){
  grabRefs();
  const cards=ids.map(id=>allCards.find(c=>c.id===id)).filter(Boolean);
  if(!cards.length){toast('没有可选词');return;}
  studyQueue=cards;studyIndex=0;
  refs.overlay.classList.remove('hidden');
  refs.hint.classList.remove('hidden');refs.gradeRow.classList.add('hidden');
  refs.label.textContent=cards.every(c=>c.status==='fresh')?'今日新词':'复习';
  renderStudyCard();
}
function renderStudyCard(){
  const c=studyQueue[studyIndex];
  refs.pos.textContent=(studyIndex+1)+' / '+studyQueue.length;
  refs.front.innerHTML=`<div class="front-word">${esc(c.word)}</div><div class="front-sub">点卡片看答案</div>`;
  let parts=`<div class="back-word">${esc(c.word)}</div>`;
  if(c.meaning){parts+=`<div class="back-label">解释</div><div class="back-text">${esc(c.meaning)}</div>`;}
  if(c.thinking){parts+=`<div class="back-label">思考</div><div class="back-text">${esc(c.thinking)}</div>`;}
  if(c.image){parts+=`<div class="back-label">图片</div><div class="back-image"><img src="${esc(imageURL(c.image))}"></div>`;}
  refs.back.innerHTML=parts;
  refs.flipCard.classList.remove('flipped');
  refs.hint.classList.remove('hidden');refs.gradeRow.classList.add('hidden');
  refs.back.scrollTop=0;
}
function flip(){refs.flipCard.classList.toggle('flipped');if(refs.flipCard.classList.contains('flipped')){refs.hint.classList.add('hidden');refs.gradeRow.classList.remove('hidden');}}
function gradeFromButton(g){
  const card=studyQueue[studyIndex];applyGrade(card,g);saveCards();studyIndex++;
  if(studyIndex<studyQueue.length)renderStudyCard();else endStudy();
}
function endStudy(){
  refs.overlay.classList.add('hidden');
  toast('本组学习完成 🎉');
  saveCards();pushAll();renderStream();
}
function applyGrade(card,g){
  const s=card;
  if(s.status==='fresh'||s.status==='learning'){
    if(g<=0){s.status='learning';s.interval=0;s.reps=0;s.due=todayStr();}
    else if(g===1){s.status='learning';s.interval=1;s.reps=1;s.due=addDays(todayStr(),1);}
    else {s.status='reviewing';s.interval=g===3?4:2;s.reps=1;s.ef=g===3?2.6:2.5;s.due=addDays(todayStr(),s.interval);}
  }else{
    if(g<=0){s.lapses++;s.reps=0;s.interval=1;s.status='learning';s.ef=Math.max(1.3,s.ef-0.2);s.due=todayStr();}
    else if(g===1){s.interval=1;s.reps++;s.due=addDays(todayStr(),1);}
    else if(g===2){s.reps++;s.interval=s.reps===1?1:Math.round(s.interval*s.ef);s.due=addDays(todayStr(),s.interval);if(s.interval>=21)s.status='mastered';}
    else{s.ef=Math.min(2.9,s.ef+0.1);s.reps++;s.interval=s.reps===1?1:Math.round(s.interval*s.ef*1.3);s.due=addDays(todayStr(),s.interval);if(s.interval>=21)s.status='mastered';}
  }
  s.totalRating+=g;s.history=s.history||[];s.history.push({date:todayStr(),grade:g});
  return s;
}

// ---------- 设置菜单（flomo 极简：用右上角下拉） ----------
// ---------- 设置面板 ----------
function openSettings(){
  const g=ghConfig();
  const st=document.getElementById('settings');
  document.getElementById('sDaily').value=settings.dailyNew;
  document.getElementById('sTheme').value=settings.theme;
  document.getElementById('ghUser').value=g.user||'';
  document.getElementById('ghRepo').value=g.repo||'';
  document.getElementById('ghBranch').value=g.branch||'main';
  document.getElementById('ghToken').value=g.token||'';
  st.classList.remove('hidden');
}
function closeSettings(){ document.getElementById('settings').classList.add('hidden'); }
function bindSettings(){
  const st=document.getElementById('settings');
  st.querySelector('[data-close]').onclick=closeSettings;
  st.addEventListener('click',e=>{if(e.target===st)closeSettings();});
  document.getElementById('sSave').onclick=()=>{
    settings.dailyNew=Math.min(100,Math.max(5,+document.getElementById('sDaily').value||20));
    settings.theme=document.getElementById('sTheme').value;
    saveSettings();
    saveGh({user:document.getElementById('ghUser').value.trim(),repo:document.getElementById('ghRepo').value.trim(),
      branch:document.getElementById('ghBranch').value.trim()||'main',token:document.getElementById('ghToken').value.trim()});
    toast('设置已保存 ✔');
    closeSettings();
  };
  document.getElementById('sPull').onclick=async()=>{ toast('拉取中…'); const ok=await pullAll(); renderStream(); toast(ok?'已拉取并合并':'拉取失败（检查配置）'); };
  document.getElementById('sPush').onclick=async()=>{ const ok=await pushAll(); toast(ok?'已同步到仓库 ✔':'同步失败（检查配置）'); };
  document.getElementById('sExport').onclick=()=>{
    const blob=new Blob([JSON.stringify(allCards,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='生词卡备份_'+todayStr()+'.json';a.click();
    toast('已导出备份');
  };
  document.getElementById('footGear').onclick=openSettings;
}

// ---------- 学习菜单（保留占位，避免引用错误） ----------

// ---------- init ----------

// ---------- init ----------
function boot(){
  loadSettings();
  // 读本地
  const stored=loadCards();
  if(stored&&Array.isArray(stored))allCards=stored;
  else {allCards=[];saveCards();}
  renderStream();
  bindEditor();
  bindSettings();
  // 按钮
  document.getElementById('btnAdd').onclick=()=>openEditor();
  document.getElementById('flipCard').addEventListener('click',flip);
  document.querySelectorAll('#gradeRow .grade').forEach(b=>b.onclick=()=>gradeFromButton(+b.dataset.grade));
  // 启动拉取
  if(ghReady())setTimeout(()=>pullAll().then(()=>{renderStream();}),600);
}
// 学习菜单/设置 via long-press 或 gear —— 用简版：双击标题呼出 GitHub 配置
document.addEventListener('click',()=>{});

// toast
let toastTimer;
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.remove('hidden');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),2200);
}

// 暴露给快捷指令：__setupGh, __push
window.__pushNow=function(){ return pushAll(); };
window.__configureGh=function(u,r,b,t){ saveGh({user:u,repo:r,branch:b||'main',token:t}); return !!u&&!!r&&!!t; };
window.__addCardFromShortcut=async function(word,meaning,thinking,imageName,imageBase64){
  // 供快捷指令添加词条（图片可选已上传到 images/<name>）
  const card=newCard({word,meaning,thinking});
  if(imageName)card.image=imageName;
  allCards.push(card);saveCards();
  if(imageBase64&&imageName){ if(ghReady()) await ghPutImage('images/'+imageName,imageBase64,'upload '+imageName); }
  await pushAll();
  renderStream();
  return card.id;
};

window.addEventListener('load',boot);
})();
