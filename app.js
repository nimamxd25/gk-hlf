// ============ 考公词汇应用核心逻辑 ============
// 无内置词库：从 GitHub 仓库内的 words.json 加载词库，学习进度存 localStorage。
// 用户添加的生词保存在 localStorage，并可导出提交回仓库同步。
(function(){
'use strict';

// ---------- 常量 ----------
const STORE_KEY='gk_cards_v1';       // 学习进度(含用户自建词)
const USER_WORDS_KEY='gk_user_words'; // 用户自建词原文(作业数据,便于同步回仓库)
const WORDS_URL='words.json';        // 仓库内词库文件(可编辑)

// ---------- 存储层 ----------
function loadAllFromStorage(){
  try{ const raw=localStorage.getItem(STORE_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  return null;
}
function loadUserWords(){
  try{ const raw=localStorage.getItem(USER_WORDS_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  return [];
}
function saveUserWords(list){
  try{ localStorage.setItem(USER_WORDS_KEY, JSON.stringify(list)); }catch(e){}
}
function saveAllToStorage(){
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(allCards)); }catch(e){ console.error('存储失败',e); }
}

// ---------- 设置 ----------
const defaultSettings = { dailyNew: 20, theme: 'light' };
let settings = {...defaultSettings};
function loadSettings(){
  try{ const s=JSON.parse(localStorage.getItem('gk_settings')); if(s) settings={...defaultSettings,...s}; }catch(e){}
  applyTheme();
}
function applyTheme(){
  if(settings.theme==='dark') document.documentElement.setAttribute('data-theme','dark');
  else document.documentElement.removeAttribute('data-theme');
}
function saveSettings(){ localStorage.setItem('gk_settings',JSON.stringify(settings)); applyTheme(); }

// ---------- 工具 ----------
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function addDays(s,n){ const p=s.split('-');const d=new Date(+p[0],+p[1]-1,+p[2]+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function uid(){ return 'u'+Date.now()+Math.random().toString(36).slice(2,7); }

// ---------- 卡模型 ----------
function initialState(){
  return { status:'fresh', ef:2.5, interval:0, reps:0, lapses:0, due:todayStr(), totalRating:0, history:[] };
}
// 词条 -> 卡
function wordToCard(w, forceId){
  return { id: w.id||forceId||uid(), word:w.word, meaning:w.meaning||'', examples:(w.examples||[]).slice(0,3), source: w.source||'词库', ...initialState() };
}

// ---------- 状态 ----------
let allCards=[];        // 全部卡片（词库+用户自建）
let currentSearch='', currentFilter='all';
let wordsLoaded=false;  // 词库是否已从仓库加载

// ---------- 加载词库(从 words.json) ----------
async function loadWordLibrary(){
  let libWords=[];
  try{
    const res=await fetch(WORDS_URL, {cache:'no-store'});
    if(res.ok){
      const data=await res.json();
      if(Array.isArray(data)) libWords=data;
    }
  }catch(e){ /* 无网络/本地文件模式：忽略，用用户词库 */ }
  // 过滤示例/空词条
  libWords = libWords.filter(w=>w && w.word && !String(w.word).includes('示例'));
  // 加上用户自建词
  const userWords=loadUserWords();
  const merged=libWords.concat(userWords);
  // 用 id 去重（无 id 的生成）
  const seen=new Set();
  const ops=[];
  merged.forEach((w,i)=>{
    const key=w.id||('file_'+i);
    if(seen.has(key)) return;
    seen.add(key);
    ops.push({key, w, isUser: w.isUser});
  });
  return ops;
}

// ---------- 引导启动 ----------
async function boot(){
  loadSettings();
  renderLoading();
  const stored=loadAllFromStorage();
  const storedMap=new Map();
  if(stored && Array.isArray(stored)) stored.forEach(c=>storedMap.set(c.id,c));

  // 汇总：词库(优先用已存进度) + 新词库词 + 用户自建词
  allCards=[];
  const userWords=loadUserWords().map(w=>{ w.isUser=true; return w; });

  // 1) 用户自建词（始终保留，即使 localstorage 无进度也保留原词）
  userWords.forEach(w=>{
    const id=w.id||uid();
    if(!id.startsWith('w')){ // 仅自建词
      if(storedMap.has(id)) allCards.push(storedMap.get(id));
      else { const c=wordToCard(w,id); c.id=id; allCards.push(c); }
    }
  });

  // 2) 从仓库 words.json 加载词库词条（file 词），与已存进度合并
  let libWords=[];
  try{
    const res=await fetch(WORDS_URL,{cache:'reload'});
    if(res.ok){ const d=await res.json(); if(Array.isArray(d)) libWords=d.filter(w=>w&&w.word&&!String(w.word).includes('示例')); }
  }catch(e){}

  libWords.forEach((w,i)=>{
    const baseId='w'+i; // 仓库词条按顺序分配稳定 id
    // 找已存进度里该词对应的卡（按 word 匹配）
    let existing=null;
    for(const c of storedMap.values()){
      if(c.word===w.word && !c.id.startsWith('w')) {} // skip
    }
    const found=storedMap.get(baseId) || [...storedMap.values()].find(c=>c.word===w.word && c.id.startsWith('w'));
    if(found){
      // 用仓库最新内容更新词条信息，保留进度
      found.word=w.word; found.meaning=w.meaning||found.meaning; found.examples=(w.examples||[]).slice(0,3); found.source='词库';
      allCards.push(found);
    } else {
      const c=wordToCard(w,baseId); c.id=baseId; c.source='词库'; allCards.push(c);
    }
  });

  // 3) 清理重复
  const seenIds=new Set(); allCards=allCards.filter(c=>{ if(seenIds.has(c.id))return false; seenIds.add(c.id); return true; });

  if(allCards.length===0){
    // 初始引导：展示空态
    saveAllToStorage();
  } else {
    saveAllToStorage();
  }
  wordsLoaded=true;
  updateSummary();
  renderCurrentView();
  bindEvents();
  // 启动时若已配置 GitHub，自动拉取远端最新数据合并（静默，失败不影响本地）
  if(getGhConfig().token){ setTimeout(()=>pullFromRepo().then(()=>updateSummary()), 800); }
}

function renderLoading(){
  const v=document.getElementById('view');
  v.innerHTML=`<div class="empty"><div class="icon">📚</div><div>正在从词库加载…</div></div>`;
}

// ---------- 摘要 ----------
function updateSummary(){
  const fresh=allCards.filter(c=>c.status==='fresh').length;
  const due=allCards.filter(c=>c.status!=='mastered'&&c.status!=='fresh'&&c.due<=todayStr()).length;
  const mastered=allCards.filter(c=>c.status==='mastered').length;
  const total=allCards.length;
  document.getElementById('sNew').textContent=fresh;
  document.getElementById('sDue').textContent=due;
  document.getElementById('sMastered').textContent=mastered;
  document.getElementById('sTotal').textContent=total;
  // 今日日期
  const d=new Date();
  const week=['日','一','二','三','四','五','六'];
  document.getElementById('todayDate').textContent=`${d.getMonth()+1}月${d.getDate()}日 周${week[d.getDay()]}`;
  // 学习按钮文案
  const btnText=document.getElementById('studyBtnText');
  if(fresh>0) btnText.textContent='开始今日学习';
  else if(due>0) btnText.textContent=`复习 ${due} 个`;
  else if(mastered>0) btnText.textContent='复习巩固';
  else btnText.textContent='我的生词本';
  // 进度百分比
  const pct=total?Math.round((total-fresh)/total*100):0;
  document.getElementById('pctText').textContent=pct+'%';
}

// ---------- 视图 ----------
function renderCurrentView(){
  const v=document.getElementById('view');
  if(!wordsLoaded){ renderLoading(); return; }
  if(currentSearch){ renderLibrary(v,true); return; }
  if(currentFilter!=='all'){ renderLibrary(v,false); return; }
  v.innerHTML='';
  const fresh=allCards.filter(c=>c.status==='fresh');
  const due=allCards.filter(c=>c.status!=='mastered'&&c.status!=='fresh'&&c.due<=todayStr());
  if(allCards.length===0){
    const e=document.createElement('div');e.className='empty';
    e.innerHTML=`<div class="icon">🌱</div><div>词库还是空的<br><br>
      <button class="main-btn primary" data-first style="font-size:14px;padding:12px 22px">➕ 添加第一个生词</button><br>
      <div style="font-size:13px;color:var(--muted);margin-top:12px">也可在仓库的 <b>words.json</b> 里批量录入词条<br>或从设置导入词库文件</div></div>`;
    const btn=e.querySelector('[data-first]');
    btn.addEventListener('click',()=>openAdd());
    v.appendChild(e);
    return;
  }
  if(fresh.length>0){
    const sec=document.createElement('div');
    sec.innerHTML=`<div class="section-title"><span>🆕 待学新词（${fresh.length}个）</span><span>点上方开始学习</span></div>`;
    v.appendChild(sec);
    fresh.slice(0,settings.dailyNew).forEach(c=>v.appendChild(renderMiniCard(c)));
  } else if(due.length>0){
    const sec=document.createElement('div');
    sec.innerHTML=`<div class="section-title"><span>⏰ 今日待复习（${due.length}个）</span></div>`;
    v.appendChild(sec);
    due.slice(0,8).forEach(c=>v.appendChild(renderMiniCard(c)));
  } else {
    const e=document.createElement('div');e.className='empty';
    e.innerHTML='<div class="icon">🎉</div><div>今日任务已完成！<br>去词库逛逛或添加新词吧</div>';
    v.appendChild(e);
  }
}

const STATUS_MAP={fresh:'🆕 新词',learning:'⏳ 学习中',reviewing:'🔁 复习中',mastered:'✅ 已掌握'};
function renderMiniCard(c){
  const div=document.createElement('div');div.className='word-card';
  const ex=c.examples&&c.examples.length?c.examples[0]:'';
  div.innerHTML=`<div class="wc-top"><span class="wc-word">${esc(c.word)}</span><span class="wc-tag">${STATUS_MAP[c.status]}</span></div>
    <div class="wc-meaning">${esc(c.meaning)}</div>
    ${ex?`<div class="wc-example">${esc(ex)}</div>`:''}`;
  return div;
}
function renderLibrary(v,searchMode){
  v.innerHTML='';
  let list=allCards;
  if(currentFilter!=='all') list=list.filter(c=>c.status===currentFilter);
  if(searchMode&&currentSearch){
    const q=currentSearch.trim();
    list=list.filter(c=>c.word.includes(q)||(c.meaning||'').includes(q)||(c.examples||[]).some(e=>e.includes(q)));
  }
  if(list.length===0){
    const e=document.createElement('div');e.className='empty';
    e.innerHTML='<div class="icon">🔍</div><div>没有匹配的词</div>';
    v.appendChild(e);return;
  }
  const f=document.createElement('div');
  f.innerHTML=`<div class="section-title"><span>词库 · ${list.length} 词</span></div>`;
  v.appendChild(f);
  list.forEach(c=>{
    const div=document.createElement('div');div.className='word-card';
    const btn = c.status==='fresh' ? `<button class="wlearn" data-id="${c.id}">立即学习</button>` : `<button class="wgrade" data-id="${c.id}">记忆自评</button>`;
    const ex=c.examples&&c.examples.length?c.examples[0]:'';
    div.innerHTML=`<div class="wc-top"><span class="wc-word">${esc(c.word)}</span><span class="wc-tag">${STATUS_MAP[c.status]}</span></div>
      <div class="wc-meaning">${esc(c.meaning)}</div>
      ${ex?`<div class="wc-example">${esc(ex)}</div>`:''}
      <div class="wc-action">${btn}</div>`;
    div.querySelector('.wlearn')?.addEventListener('click',e=>{e.stopPropagation();startStudy([c.id]);});
    div.querySelector('.wgrade')?.addEventListener('click',e=>{e.stopPropagation();openGradeModal(c);});
    v.appendChild(div);
  });
}
function esc(s){ return String(s||'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

// ---------- Tab 系统 ----------
function switchTab(tab){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  const btn=document.querySelector(`.tab-btn[data-tab="${tab}"]`); if(btn) btn.classList.add('active');
  if(tab==='library') renderLibraryPanel();
  else if(tab==='stats') renderStatsView();
  else if(tab==='settings') renderSettingsView();
  else renderCurrentView();
}
function renderLibraryPanel(){
  renderLibrary(document.getElementById('libView'), document.getElementById('searchInput').value?true:false);
  renderFilterRow();
}
function renderFilterRow(){
  const fr=document.getElementById('filterRow');
  const chips=[['all','全部'],['fresh','新词'],['learning','学习中'],['reviewing','复习'],['mastered','已掌握']];
  fr.innerHTML=chips.map(c=>`<button class="filter-chip ${currentFilter===c[0]?'active':''}" data-f="${c[0]}">${c[1]}</button>`).join('');
  fr.querySelectorAll('.filter-chip').forEach(ch=>{
    ch.onclick=()=>{ currentFilter=ch.dataset.f; renderFilterRow(); renderLibrary(document.getElementById('libView'), document.getElementById('searchInput').value?true:false); };
  });
}
function renderStatsView(){
  const v=document.getElementById('statsView');
  const fresh=allCards.filter(c=>c.status==='fresh').length;
  const learning=allCards.filter(c=>c.status==='learning').length;
  const reviewing=allCards.filter(c=>c.status==='reviewing').length;
  const mastered=allCards.filter(c=>c.status==='mastered').length;
  const total=allCards.length;
  const pct=total?Math.round((total-fresh)/total*100):0;
  v.innerHTML=`
    <div class="section-title"><span>📊 学习统计</span></div>
    <div class="stats-grid">
      <div class="stat-item"><div class="n">${fresh}</div><div class="t">待学</div></div>
      <div class="stat-item"><div class="n">${learning}</div><div class="t">学习中</div></div>
      <div class="stat-item"><div class="n">${reviewing}</div><div class="t">复习中</div></div>
      <div class="stat-item"><div class="n">${mastered}</div><div class="t">已掌握</div></div>
    </div>
    <div class="section-card" style="margin-top:14px">
      <div class="section-title" style="margin:0 0 8px"><span>总进度</span><span>${pct}%</span></div>
      <div class="stat-bar"><div style="width:${pct}%"></div></div>
    </div>`;
}
function renderSettingsView(){
  const v=document.getElementById('settingsView');
  const ghc=getGhConfig();
  v.innerHTML=`
    <div class="section-title"><span>⚙️ 设置</span></div>
    <div class="section-card" style="margin-bottom:12px">
      <div class="form-group"><label>每日新词数量</label><input id="sDaily" type="number" min="5" max="100" value="${settings.dailyNew}"></div>
      <div class="form-group"><label>主题</label><select id="sTheme"><option value="light" ${settings.theme==='light'?'selected':''}>浅色</option><option value="dark" ${settings.theme==='dark'?'selected':''}>深色</option></select></div>
    </div>
    <div class="section-title">☁️ GitHub 自动同步</div>
    <div class="section-card" style="margin-bottom:12px">
      <div class="form-group"><label>GitHub 用户名</label><input id="ghUser" value="${ghc.user||''}" placeholder="username"></div>
      <div class="form-group"><label>仓库名</label><input id="ghRepo" value="${ghc.repo||''}" placeholder="repo"></div>
      <div class="form-group"><label>分支</label><input id="ghBranch" value="${ghc.branch||'main'}" placeholder="main"></div>
      <div class="form-group"><label>Token（存本地）</label><input id="ghToken" type="password" value="${ghc.token||''}" placeholder="github_pat_..."></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" data-savetoken style="flex:1;font-size:14px;padding:12px">💾 保存</button>
        <button class="btn-primary" data-pull style="flex:1;font-size:14px;padding:12px;background:#2f80ed">⬇️ 拉取</button>
        <button class="btn-primary" data-push style="flex:1;font-size:14px;padding:12px;background:#27ae60">☁️ 同步</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-primary" data-expwords style="flex:1;font-size:13px;padding:12px">导出词库</button>
        <button class="btn-primary" data-expprogress style="flex:1;font-size:13px;padding:12px;background:#2f80ed">导出进度</button>
        <button class="btn-primary" data-import style="flex:1;font-size:13px;padding:12px;background:#8e44ad">导入</button>
      </div>
    </div>
    <div style="font-size:12px;color:var(--muted);padding:0 4px">• Token 只存本机浏览器，不进仓库<br>• 添加生词 / 学完一组自动写回仓库 <br>• 启动自动拉取远端数据合并<br>• 进度数据存浏览器 localStorage，可导出备份</div>
    <input type="file" id="sFile" accept=".json" style="display:none">`;
  // 事件
  v.querySelector('#sDaily').onchange=e=>{settings.dailyNew=Math.min(100,Math.max(5,+e.target.value||20));saveSettings();};
  v.querySelector('#sTheme').onchange=e=>{settings.theme=e.target.value;saveSettings();};
  v.querySelector('[data-savetoken]').onclick=()=>{
    saveGhConfig({user:v.querySelector('#ghUser').value.trim(),repo:v.querySelector('#ghRepo').value.trim(),branch:v.querySelector('#ghBranch').value.trim()||'main',token:v.querySelector('#ghToken').value.trim()});
    toast('同步设置已保存');
  };
  v.querySelector('[data-pull]').onclick=async()=>{ await pullFromRepo(); toast('已拉取并合并'); };
  v.querySelector('[data-push]').onclick=async()=>{ const ok=await pushToRepo(true); toast(ok?'已同步到仓库 ✔':'同步失败，请检查配置'); };
  v.querySelector('[data-expwords]').onclick=exportWordsJSON;
  v.querySelector('[data-expprogress]').onclick=exportProgress;
  v.querySelector('[data-import]').onclick=()=>v.querySelector('#sFile').click();
  v.querySelector('#sFile').onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    const r=new FileReader(); r.onload=()=>{
      try{ const data=JSON.parse(r.result);
        if(Array.isArray(data)){ importWordList(data); }
        else if(data&&data.cards){ allCards=data.cards; }
        saveAllToStorage(); updateSummary(); renderCurrentView(); renderLibraryPanel(); toast('导入成功 ✔');
      }catch(err){toast('导入文件格式错误');}
    }; r.readAsText(f);
  };
}

// ---------- 学习流程 ----------
let studyQueue=[],studyIndex=0;
let refs;
function grabRefs(){
  refs={ front:document.getElementById('cardFront'), back:document.getElementById('cardBack'),
    label:document.getElementById('cardLabel'), pos:document.getElementById('cardPosition'),
    hint:document.getElementById('cardHint'), gradeRow:document.getElementById('gradeRow'),
    flipCard:document.getElementById('flipCard'), overlay:document.getElementById('overlay') };
}
function startStudy(ids){
  grabRefs();
  const cards=ids.map(id=>allCards.find(c=>c.id===id)).filter(Boolean);
  if(!cards.length){toast('没有可选词');return;}
  studyQueue=cards; studyIndex=0;
  refs.overlay.classList.remove('hidden');
  refs.gradeRow.classList.add('hidden');
  refs.hint.classList.remove('hidden');
  refs.label.textContent = cards.every(c=>c.status==='fresh')?'今日新词':'复习';
  renderStudyCard();
}
function renderStudyCard(){
  const c=studyQueue[studyIndex];
  refs.pos.textContent=(studyIndex+1)+' / '+studyQueue.length;
  refs.front.innerHTML=`<div class="flip-word">${esc(c.word)}</div><div class="flip-pos">来源：${esc(c.source)}</div>`;
  let parts='';
  if(c.meaning){
    parts+=`<span class="back-section-label">📖 释义</span>`;
    parts+=`<div class="back-meaning">${esc(c.meaning)}</div>`;
  }
  if(c.examples && c.examples.length){
    parts+=`<span class="back-section-label">💬 例句</span>`;
    c.examples.forEach(e=>{ parts+=`<div class="back-example">${esc(e)}</div>`; });
  }
  if(c.quiz && c.quiz.length){
    parts+=`<span class="back-quiz-label">📝 真题</span>`;
    c.quiz.forEach(q=>{ parts+=`<div class="back-quiz">${esc(q)}</div>`; });
  }
  refs.back.innerHTML=`<div class="back-scroll"><div class="back-word">${esc(c.word)}</div>${parts}</div>`;
  refs.flipCard.classList.remove('flipped');
  refs.gradeRow.classList.add('hidden');
  refs.hint.classList.remove('hidden');
  refs.back.scrollTop=0;
}
function flipCard(){
  const fc=refs?refs.flipCard:document.getElementById('flipCard');
  fc.classList.toggle('flipped');
  if(fc.classList.contains('flipped')&&refs){ refs.hint.classList.add('hidden'); refs.gradeRow.classList.remove('hidden'); }
}
function gradeFromButton(grade){
  if(!studyQueue.length) return;
  const card=studyQueue[studyIndex];
  applyGrade(card,grade);
  saveAllToStorage();
  studyIndex++;
  if(studyIndex<studyQueue.length){ renderStudyCard(); }
  else { endStudy(); }
}
function endStudy(){
  refs.overlay.classList.add('hidden');
  toast('本组学习完成 🎉');
  updateSummary(); renderCurrentView();
  autoSync(); // 学完自动同步进度到仓库
}
function applyGrade(card,grade){
  const st=card;
  if(st.status==='fresh'||st.status==='learning'){
    if(grade<=0){ st.status='learning'; st.interval=0; st.reps=0; st.due=todayStr(); }
    else if(grade===1){ st.status='learning'; st.interval=1; st.reps=1; st.due=addDays(todayStr(),1); }
    else { st.status='reviewing'; st.interval=grade===3?4:2; st.reps=1; st.ef=grade===3?2.6:2.5; st.due=addDays(todayStr(),st.interval); }
  } else {
    if(grade<=0){ st.lapses++; st.reps=0; st.interval=1; st.status='learning'; st.ef=Math.max(1.3,st.ef-0.2); st.due=todayStr(); }
    else if(grade===1){ st.interval=1; st.reps++; st.due=addDays(todayStr(),1); }
    else if(grade===2){ st.reps++; st.interval=st.reps===1?1:Math.round(st.interval*st.ef); st.due=addDays(todayStr(),st.interval); if(st.interval>=21) st.status='mastered'; }
    else { st.ef=Math.min(2.9,st.ef+0.1); st.reps++; st.interval=st.reps===1?1:Math.round(st.interval*st.ef*1.3); st.due=addDays(todayStr(),st.interval); if(st.interval>=21) st.status='mastered'; }
    if(grade>=2) st.ef=Math.min(2.9,st.ef+0.05);
    if(grade<=0) st.ef=Math.max(1.3,st.ef-0.2);
  }
  st.totalRating+=grade;
  st.history=st.history||[];
  st.history.push({date:todayStr(),grade});
  return st;
}

// ---------- 复习 ----------
function reviewFlow(){
  const due=allCards.filter(c=>c.status!=='mastered'&&c.status!=='fresh'&&c.due<=todayStr());
  if(due.length===0){
    const learned=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered');
    if(learned.length===0){toast('还没有已学词汇，先学习吧');return;}
    startStudy(learned.slice(0,Math.min(settings.dailyNew,learned.length)).map(c=>c.id));
    refs.label.textContent='巩固复习';
    return;
  }
  startStudy(due.map(c=>c.id));
  refs.label.textContent='复习';
}

// ---------- 弹窗 ----------
function openModal(html){
  const m=document.getElementById('modal'), b=document.getElementById('modalBody');
  b.innerHTML=html; m.classList.remove('hidden');
  const close=b.querySelector('[data-close]'); if(close) close.onclick=()=>m.classList.add('hidden');
  return b;
}
function openGradeModal(card){
  const b=openModal(`
    <button class="modal-close" data-close>✕</button>
    <h3>${esc(card.word)} · 记忆自评</h3>
    <div class="word-card" style="box-shadow:none">
      <div class="wc-meaning">${esc(card.meaning)}</div>
      <div class="wc-example">${esc(card.examples&&card.examples[0]||'')}</div>
    </div>
    <div class="grade-row" style="margin-top:10px">
      <button class="grade bad" data-g="0">很陌生</button><button class="grade hard" data-g="1">有点难</button>
      <button class="grade good" data-g="2">记住了</button><button class="grade easy" data-g="3">很简单</button>
    </div>`);
  b.querySelectorAll('.grade').forEach(btn=>{
    btn.onclick=()=>{ applyGrade(card,+btn.dataset.g); saveAllToStorage(); updateSummary(); renderCurrentView(); document.getElementById('modal').classList.add('hidden'); toast('已记录自评 ✔'); };
  });
}
function openAdd(){
  const b=openModal(`
    <button class="modal-close" data-close>✕</button>
    <h3>➕ 添加生词</h3>
    <div class="form-group"><label>词语 / 成语</label><input id="mWord" placeholder="如：沆瀣一气"></div>
    <div class="form-group"><label>意思</label><textarea id="mMeaning" rows="2" placeholder="简要释义"></textarea></div>
    <div class="form-group"><label>例句（可选，一行一条）</label><textarea id="mEx" rows="3"></textarea></div>
    <button class="btn-primary" data-save>保存</button>`);
  b.querySelector('[data-save]').onclick=()=>{
    const w=b.querySelector('#mWord').value.trim(), mn=b.querySelector('#mMeaning').value.trim();
    const ex=b.querySelector('#mEx').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,3);
    if(!w){toast('请输入词语');return;}
    const card={ id:uid(), word:w, meaning:mn||'(待补充释义)', examples:ex, source:'手动', isUser:true, ...initialState() };
    allCards.push(card);
    // 同步到用户自建词原文列表
    const uw=loadUserWords(); uw.push({word:w, meaning:mn, examples:ex}); saveUserWords(uw);
    saveAllToStorage(); updateSummary(); renderCurrentView();
    document.getElementById('modal').classList.add('hidden'); toast(`已添加「${w}」`);
    autoSync(); // 添加生词后自动同步词库到仓库
  };
}
function openSettings(){
  const ghc=getGhConfig();
  const b=openModal(`
    <button class="modal-close" data-close>✕</button>
    <h3>⚙️ 设置</h3>
    <div class="form-group"><label>每日新词数量</label><input id="sDaily" type="number" min="5" max="100" value="${settings.dailyNew}"></div>
    <div class="form-group"><label>主题</label><select id="sTheme"><option value="light" ${settings.theme==='light'?'selected':''}>浅色</option><option value="dark" ${settings.theme==='dark'?'selected':''}>深色</option></select></div>

    <div class="form-group"><label>☁️ GitHub 自动同步（私有仓库）</label>
      <input id="ghUser" placeholder="GitHub 用户名" value="${ghc.user}" style="margin-bottom:8px">
      <input id="ghRepo" placeholder="仓库名（如 shengci）" value="${ghc.repo}" style="margin-bottom:8px">
      <input id="ghBranch" placeholder="分支（默认 main）" value="${ghc.branch||'main'}" style="margin-bottom:8px">
      <input id="ghToken" type="password" placeholder="Fine-grained Token (存本地，不上传)" value="${ghc.token||''}">
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-primary" data-savetoken style="flex:1;font-size:14px">💾 保存同步设置</button>
        <button class="btn-primary" data-pull style="flex:1;font-size:14px;background:#2f80ed">⬇️ 拉取仓库数据</button>
        <button class="btn-primary" data-pushtest style="flex:1;font-size:14px;background:#27ae60">☁️ 测试/立刻同步</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:8px">自动同步开启后，学习与添加生词时会自动写回仓库的 words.json / progress.json。</div>
    </div>

    <div class="form-group"><label>数据备份</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" data-exportwords style="flex:1;font-size:13px">⬇️ 导出词库JSON</button>
        <button class="btn-primary" data-exportprogress style="flex:1;font-size:13px;background:#2f80ed">⬇️ 导出进度</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn-primary" data-import style="flex:1;font-size:13px;background:#27ae60">⬆️ 导入词库/进度</button>
      </div>
    </div>
    <input type="file" id="sFile" accept=".json" style="display:none">`);
  b.querySelector('#sDaily').onchange=e=>{settings.dailyNew=Math.min(100,Math.max(5,+e.target.value||20));saveSettings();};
  b.querySelector('#sTheme').onchange=e=>{settings.theme=e.target.value;saveSettings();};
  b.querySelector('[data-exportwords]').onclick=exportWordsJSON;
  b.querySelector('[data-exportprogress]').onclick=exportProgress;
  b.querySelector('[data-import]').onclick=()=>b.querySelector('#sFile').click();
  b.querySelector('[data-savetoken]').onclick=()=>{
    saveGhConfig({
      user:b.querySelector('#ghUser').value.trim(),
      repo:b.querySelector('#ghRepo').value.trim(),
      branch:b.querySelector('#ghBranch').value.trim()||'main',
      token:b.querySelector('#ghToken').value.trim()
    });
    toast('同步设置已保存（token 仅存本地）');
  };
  b.querySelector('[data-pull]').onclick=async ()=>{
    saveGhConfigFrom(b);
    toast('正在拉取…');
    const ok=await pullFromRepo();
    toast(ok?'拉取并合并完成 ✔':'拉取失败（请检查配置/权限）');
  };
  b.querySelector('[data-pushtest]').onclick=async ()=>{
    saveGhConfigFrom(b);
    toast('正在同步…');
    const ok=await pushToRepo(true);
    toast(ok?'同步成功 ✔ 已写回仓库':'同步失败（请检查 token/仓库名/权限）');
  };
  b.querySelector('#sFile').onchange=e=>{
    const f=e.target.files[0]; if(!f)return;
    const r=new FileReader(); r.onload=()=>{
      try{
        const data=JSON.parse(r.result);
        if(Array.isArray(data)){ // 词库词条
          importWordList(data);
        } else if(data && data.cards){ // 完整进度
          allCards=data.cards; saveAllToStorage();
        }
        saveAllToStorage(); updateSummary(); renderCurrentView();
        document.getElementById('modal').classList.add('hidden'); toast('导入成功 ✔');
      }catch(err){toast('导入文件格式错误');}
    }; r.readAsText(f);
  };
}
// 从当前弹窗读取 GitHub 配置
function getGhConfig(){
  try{ return JSON.parse(localStorage.getItem('gk_gh')||'{}'); }catch(e){ return {}; }
}
function saveGhConfig(c){
  localStorage.setItem('gk_gh', JSON.stringify(c));
}
function saveGhConfigFrom(b){
  saveGhConfig({
    user:b.querySelector('#ghUser').value.trim(),
    repo:b.querySelector('#ghRepo').value.trim(),
    branch:b.querySelector('#ghBranch').value.trim()||'main',
    token:b.querySelector('#ghToken').value.trim()
  });
}
// 导出词库（用户自建词 + 词库合并，供提交回仓库 words.json）
function exportWordsJSON(){
  const lib=[];
  allCards.forEach(c=>{
    if(c.isUser || c.source==='手动'){
      lib.push({word:c.word, meaning:c.meaning&&c.meaning.includes('待补充')?'':c.meaning, examples:c.examples||[]});
    }
  });
  // 去重
  const seen=new Set(); const out=[];
  lib.forEach(w=>{ if(seen.has(w.word))return; seen.add(w.word); out.push(w); });
  downloadJSON(out, 'words_我的生词.json');
  toast('已导出词库 JSON，可提交覆盖仓库 words.json');
}
function exportProgress(){
  const data={app:'gkCiHui',date:todayStr(),cards:allCards};
  downloadJSON(data, '考公词汇进度_'+todayStr()+'.json');
  toast('已导出学习进度');
}
function importWordList(list){
  list.forEach(w=>{
    if(!w||!w.word)return;
    const exist=allCards.find(c=>c.word===w.word);
    if(exist){ exist.meaning=w.meaning||exist.meaning; exist.examples=(w.examples||exist.examples).slice(0,3); }
    else { const c=wordToCard(w); c.isUser=true; c.source='手动'; allCards.push(c); }
  });
}
function downloadJSON(obj,name){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
}
// ========== GitHub 自动同步（Contents API） ==========
// 需要：私有仓库 + Fine-grained Token（repository contents: Read and write 权限）
// token 仅存 localStorage，不写入仓库。数据文件：words.json(词库) / progress.json(进度)

const GH_API='https://api.github.com';

// 读取仓库某文件内容（解码 base64，还原 UTF-8），失败返回 null
async function ghGet(path, ghc){
  const url=`${GH_API}/repos/${ghc.user}/${ghc.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ghc.branch||'main')}`;
  try{
    const res=await fetch(url,{headers:{Authorization:`token ${ghc.token}`,Accept:'application/vnd.github+json'}});
    if(res.ok){ const j=await res.json(); if(j.content){
      let txt;
      try{ txt=decodeURIComponent(escape(atob(j.content.replace(/\n/g,'')))); }
      catch(e){ txt=atob(j.content.replace(/\n/g,'')); }
      return {content:txt, sha:j.sha};
    } }
    if(res.status===404) return {content:null, sha:null}; // 文件不存在
    return null;
  }catch(e){ return null; }
}
// 写入/更新仓库文件
async function ghPut(path, text, ghc, message){
  const url=`${GH_API}/repos/${ghc.user}/${ghc.repo}/contents/${encodeURIComponent(path)}`;
  const body={message:message||'update via app', content:btoa(unescape(encodeURIComponent(text)))};
  // 尝试获取已有 sha（用于更新）
  const exist=await ghGet(path,ghc);
  if(exist && exist.sha) body.sha=exist.sha;
  try{
    const res=await fetch(url,{method:'PUT',headers:{Authorization:`token ${ghc.token}`,Accept:'application/vnd.github+json'},body:JSON.stringify(body)});
    return res.ok;
  }catch(e){ return false; }
}

// 生成词库 JSON（排除了进度字段，仅词条）
function buildWordsJSON(){
  const seen=new Set(); const out=[];
  allCards.forEach(c=>{
    if(seen.has(c.word)) return; seen.add(c.word);
    let meaning=(c.meaning||'').replace(/[（(]待补充释义[)）]/g,'');
    out.push({word:c.word, meaning, examples:(c.examples||[]).slice(0,3)});
  });
  return JSON.stringify(out,null,2);
}
// 生成进度 JSON
function buildProgressJSON(){
  const cards=allCards.map(c=>({
    id:c.id, word:c.word, status:c.status, ef:c.ef, interval:c.interval,
    reps:c.reps, lapses:c.lapses, due:c.due, totalRating:c.totalRating, history:c.history
  }));
  return JSON.stringify({app:'gkCiHui',updated:new Date().toISOString(),cards},null,2);
}

// 推送：把当前词库+进度写回仓库。force=true 时即使无配置也提示。
async function pushToRepo(force){
  const ghc=getGhConfig();
  if(!ghc.token || !ghc.user || !ghc.repo){
    if(force) toast('⚠️ 请先在设置里填写 GitHub 用户名/仓库/token');
    return false;
  }
  const wOk=await ghPut('words.json', buildWordsJSON(), ghc, '自动同步词库 '+new Date().toISOString());
  const pOk=await ghPut('progress.json', buildProgressJSON(), ghc, '自动同步进度 '+new Date().toISOString());
  return wOk;
}

// 拉取：从仓库读取 words.json（词库）与 progress.json（进度），合并到本地
async function pullFromRepo(){
  const ghc=getGhConfig();
  if(!ghc.token || !ghc.user || !ghc.repo){ return false; }
  // 1) 词库
  const w=await ghGet('words.json',ghc);
  if(w && w.content){ try{ const list=JSON.parse(w.content); importWordList(list); saveAllToStorage(); }catch(e){} }
  // 2) 进度
  const p=await ghGet('progress.json',ghc);
  if(p && p.content){
    try{
      const parsed=JSON.parse(p.content);
      if(parsed && Array.isArray(parsed.cards)){
        const remote=new Map(parsed.cards.map(c=>[c.id,c]));
        allCards.forEach(c=>{ if(remote.has(c.id)){ const r=remote.get(c.id); Object.assign(c,{status:r.status,ef:r.ef,interval:r.interval,reps:r.reps,lapses:r.lapses,due:r.due,totalRating:r.totalRating,history:r.history}); } });
        saveAllToStorage();
      }
    }catch(e){}
  }
  updateSummary(); renderCurrentView();
  return true;
}

// 自动同步入口：学习/添加生词后调用（有配置才执行，静默失败）
function autoSync(){
  const ghc=getGhConfig();
  if(ghc && ghc.token && ghc.user && ghc.repo){
    pushToRepo(false);
  }
}
// 兼容旧数据引用（如有）
function syncToRepo(){ pushToRepo(true); }

// ---------- toast ----------
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.add('hidden'),2200);
}

// ---------- 统计 ----------
function openStat(){
  const fresh=allCards.filter(c=>c.status==='fresh').length;
  const learning=allCards.filter(c=>c.status==='learning').length;
  const reviewing=allCards.filter(c=>c.status==='reviewing').length;
  const mastered=allCards.filter(c=>c.status==='mastered').length;
  const total=allCards.length;
  const pct=total?Math.round((total-fresh)/total*100):0;
  openModal(`
    <button class="modal-close" data-close>✕</button>
    <h3>📊 学习统计</h3>
    <div class="stats-grid">
      <div class="stat-item"><div class="n">${fresh}</div><div class="t">待学</div></div>
      <div class="stat-item"><div class="n">${learning}</div><div class="t">学习中</div></div>
      <div class="stat-item"><div class="n">${reviewing}</div><div class="t">复习中</div></div>
      <div class="stat-item"><div class="n">${mastered}</div><div class="t">已掌握</div></div>
    </div>
    <div style="margin-top:16px"><div class="section-title"><span>总进度</span><span>${pct}%</span></div>
    <div class="stat-bar"><div style="width:${pct}%"></div></div></div>`);
}

// ---------- 事件 ----------
function bindEvents(){
  document.getElementById('btnStudy').onclick=()=>{
    const fresh=allCards.filter(c=>c.status==='fresh');
    if(fresh.length){ startStudy(fresh.slice(0,settings.dailyNew).map(c=>c.id)); }
    else {
      const due=allCards.filter(c=>c.status!=='mastered'&&c.status!=='fresh'&&c.due<=todayStr());
      if(due.length){ reviewFlow(); return; }
      const learned=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered');
      if(learned.length){ reviewFlow(); }
      else { toast('还没有词，先添加一个吧'); }
    }
  };
  document.getElementById('btnAdd').onclick=openAdd;
  // 底部 Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.onclick=()=>switchTab(btn.dataset.tab);
  });
  // 搜索（词库页）
  document.getElementById('searchInput').addEventListener('input',e=>{
    currentSearch=e.target.value;
    renderLibraryPanel();
  });
  // 卡片翻转与自评
  document.getElementById('flipCard').addEventListener('click',flipCard);
  document.querySelectorAll('#gradeRow .grade').forEach(btn=>{ btn.onclick=()=>gradeFromButton(+btn.dataset.grade); });
  document.querySelector('.modal').addEventListener('click',e=>{ if(e.target.classList.contains('modal')) e.target.classList.add('hidden'); });
}

window.addEventListener('load',()=>{ boot(); });
})();
