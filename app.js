// ============ 我的生词本 · 简洁 Anki 界面 ============
// 数据：word/meaning/thinking(思考)/SM2
// 同步：words.json + progress.json 存 GitHub 仓库
(function(){
'use strict';

const STORE_KEY='gk_cards_v2', SETTINGS_KEY='gk_settings', GH_KEY='gk_gh';
const GH_API='https://api.github.com';

const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const addDays=(s,n)=>{const p=s.split('-');const d=new Date(+p[0],+p[1]-1,+p[2]+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const uid=()=>'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
// 轻量 Markdown 渲染器（转义后处理行内格式 + 段落/列表/标题/引用/代码）
function md(src){
  if(!src)return '';
  let s=esc(src);
  // 先保护代码块
  const codeBlocks=[];
  s=s.replace(/```([\s\S]*?)```/g,(m,c)=>{codeBlocks.push(`<pre><code>${c}</code></pre>`);return '%%CODE'+ (codeBlocks.length-1)+'%%';});
  // 行内代码
  s=s.replace(/`([^`]+)`/g,(m,c)=>'<code>'+c+'</code>');
  // 行内粗体/斜体
  s=s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  s=s.replace(/__([^_]+)__/g,'<b>$1</b>');
  s=s.replace(/\*([^*]+)\*/g,'<i>$1</i>');
  s=s.replace(/_([^_]+)_/g,'<i>$1</i>');
  // 换行 -> 逐行处理
  const lines=s.split('\n');
  let html='';
  // Typora 风格多级列表：每项渲染为带缩进的 div，符号用 CSS 按层级区分
  let olCounters=[]; // 记录每层有序列表的计数
  for(const raw of lines){
    if(!raw.trim()){ html+=''; continue; }
    const indent=Math.floor((raw.match(/^ */)[0].length)/2);
    const line=raw.trim();
    const cm=line.match(/^%%CODE(\d+)%%$/);
    if(cm){ html+=codeBlocks[+cm[1]]; continue; }
    const h=line.match(/^(#{1,6})\s+(.+)$/);
    if(h){ const lv=h[1].length; html+=`<h${lv}>${h[2]}</h${lv}>`; continue; }
    const isUl=/^[-*•]/.test(line);
    const isOl=/^\d+[.)]/.test(line);
    if(isUl||isOl){
      const content=line.replace(/^([-*•]|\d+[.)])\s+/,'');
      const cls=isUl?`md-ul lv${indent}`:`md-ol lv${indent}`;
      // 有序列表计数器
      let marker='';
      if(isOl){
        olCounters[indent]=(olCounters[indent]||0)+1;
        marker=olCounters[indent];
      }
      // 超过缩进层级则重置更深层计数（简单处理）
      olCounters=olCounters.slice(0,indent+1);
      html+=`<div class="md-li ${cls}" ${marker!==''?`data-n="${marker}"`:''}>${content}</div>`;
      continue;
    }
    if(line.indexOf('&gt;')===0||line.startsWith('>')){ html+=`<blockquote>${line.replace(/^(&gt;|>)\s?/,'')}</blockquote>`; continue; }
    html+=`<p>${line}</p>`;
  }
  return html;
}

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
function newCard(f){
  const base={id:uid(),word:f.word||'',meaning:f.meaning||'',focus:f.focus||'',tone:f.tone||'',collocation:f.collocation||'',misconstrue:f.misconstrue||'',custom:Array.isArray(f.custom)?f.custom:[],updated_at:new Date().toISOString(),source:f.source||'手动',...state0()};
  // 兼容旧数据：把旧 compare -> misconstrue，thinking 丢弃
  if(f.compare&&!f.misconstrue) base.misconstrue=f.compare;
  return base;
}

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


// ---------- 同步 ----------
function buildWordsJSON(){return JSON.stringify(allCards.map(c=>({id:c.id,word:c.word,meaning:c.meaning,focus:c.focus,tone:c.tone,collocation:c.collocation,misconstrue:c.misconstrue||c.compare,custom:c.custom||[],updated_at:c.updated_at})),null,2);}
function buildProgressJSON(){return JSON.stringify({app:'gkCiHui',updated:new Date().toISOString(),cards:allCards.map(c=>({id:c.id,status:c.status,ef:c.ef,interval:c.interval,reps:c.reps,lapses:c.lapses,due:c.due,totalRating:c.totalRating,lastStudyTime:new Date().toISOString(),history:c.history}))},null,2);}
async function pushAll(){if(!ghReady())return false;await ghPutText('words.json',buildWordsJSON(),'auto sync words');await ghPutText('progress.json',buildProgressJSON(),'auto sync progress');return true;}
async function pullAll(){
  if(!ghReady())return false;
  const w=await ghGet('words.json');
  if(w&&w.content){try{const remote=JSON.parse(w.content);if(Array.isArray(remote)){
    const map=new Map(remote.map(c=>[c.id,c]));
    allCards.forEach(c=>{if(map.has(c.id)){const r=map.get(c.id);Object.assign(c,{word:r.word,meaning:r.meaning,focus:r.focus||c.focus,tone:r.tone||c.tone,collocation:r.collocation||c.collocation,misconstrue:r.misconstrue||r.compare||c.misconstrue,custom:Array.isArray(r.custom)?r.custom:(c.custom||[]),source:r.source||c.source||'手动',updated_at:r.updated_at});}});
    map.forEach((c,id)=>{if(!allCards.some(x=>x.id===id))allCards.push({...newCard(c),...c});});
    saveCards();
  }}catch(e){}}
  // 同步学习进度（progress.json）
  const p=await ghGet('progress.json');
  if(p&&p.content){try{const prog=JSON.parse(p.content);
    if(prog&&Array.isArray(prog.cards)){
      prog.cards.forEach(rc=>{
        const local=allCards.find(c=>c.id===rc.id);
        if(local){
          // 合并：用更新时间取较新（远端优先，除非本地更后）
          if(!local.lastStudyTime||(rc.lastStudyTime||'')>=(local.lastStudyTime||'')){
            Object.assign(local,{status:rc.status,ef:rc.ef,interval:rc.interval,reps:rc.reps,lapses:rc.lapses,due:rc.due,totalRating:rc.totalRating,history:rc.history});
          }
        }
      });
      saveCards();
    }
  }catch(e){}}
  return true;
}

// 加载预制词库（从仓库 builtin_words.json）
async function loadBuiltinWords(){
  // 从 raw URL 直读（无需 token）
  try{
    const r=await fetch('https://raw.githubusercontent.com/nimamxd25/gk-hlf/main/builtin_words.json');
    if(!r.ok)return false;
    const builtin=await r.json();
    if(!Array.isArray(builtin))return false;
    builtin.forEach(item=>{
      if(!allCards.find(c=>c.word===item.word && c.meaning===item.meaning)){
        allCards.push(newCard({...item, source:'内置'}));
      }
    });
    saveCards(); return true;
  }catch(e){}
  return false;
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
  // 更新同步状态条
  updateSyncBar();
}
// 更新学习热力图（最近7天）
function updateHeatmap(){
  const days=JSON.parse(localStorage.getItem('gk_studyDays')||'[]');
  const el=document.getElementById('heatmap');
  if(!el)return;
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  const firstDay=new Date(y,m,1).getDay(); // 1号是周几 (0=周日)
  const totalDays=new Date(y,m+1,0).getDate();
  const weekHeaders=['日','一','二','三','四','五','六'];
  let html=`<div class="cal-title">${y}年${m+1}月</div><div class="cal-grid">`;
  weekHeaders.forEach(w=>html+=`<div class="cal-cell cal-hd">${w}</div>`);
  // 填充1号前的空位
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-cell cal-empty"></div>`;
  for(let d=1;d<=totalDays;d++){
    const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const studied=days.includes(ds);
    const today=ds===todayStr();
    const cls=studied?'cal-done':(today?'cal-today':'');
    html+=`<div class="cal-cell ${cls}" title="${ds}${studied?' ✔':''}">${d}</div>`;
  }
  html+=`</div>`;
  el.innerHTML=html;
}
function updateSyncBar(){
  const dot=document.getElementById('syncDot');
  const txt=document.getElementById('syncText');
  if(!dot||!txt)return;
  if(!ghReady()){
    dot.className='sync-dot fail'; txt.textContent='未配置 GitHub，无法同步';
  } else {
    dot.className='sync-dot ok'; txt.textContent='已连接 GitHub（自动同步中）';
  }
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
  // 计算今日批次：每天第一次学习时从 fresh 中取出前 dailyNew 个
  const todayKey='gk_daily_'+todayStr();
  let dailyBatch=JSON.parse(localStorage.getItem(todayKey)||'null');
  if(!dailyBatch){
    dailyBatch=fresh.slice(0,settings.dailyNew).map(c=>c.id);
    localStorage.setItem(todayKey,JSON.stringify(dailyBatch));
  }
  // 过滤出批次中仍为 fresh 的卡片
  const batchCards=dailyBatch.map(id=>allCards.find(c=>c.id===id)).filter(c=>c&&c.status==='fresh');
  let html=`<div class="section-title"><span>📌 待学/待复习</span></div>`;
  if(batchCards.length){
    html+=`<div class="section-title"><span>🆕 今日待学（${batchCards.length} / ${dailyBatch.length}）</span></div>`;
    batchCards.forEach(c=>html+=cardHTML(c));
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
  const srcTag=c.source==='内置'?'<span class="wc-src-tag">内置</span>':'';
  const word=esc(c.word||'');
  const meaning=esc(c.meaning||'')||'<i style="color:var(--muted)">（暂无解释）</i>';
  const delBtn=c.source==='内置'?'':`<button class="del" data-id="${c.id}">删除</button>`;
  // 上次学习信息
  let learnInfo='';
  if(c.lastStudyTime){ learnInfo=`<span class="wc-learn-info">📅 ${formatDate(c.lastStudyTime)} · ${STATUS[c.status]}</span>`; }
  else if(c.updated_at){ learnInfo=`<span class="wc-learn-info">📥 ${formatDate(c.updated_at)}</span>`; }
  return `<div class="word-card" data-id="${c.id}">
    <div class="wc-top"><span class="wc-word">${word}</span>${srcTag}<span class="wc-tag">${tag}</span></div>
    ${learnInfo?`<div class="wc-foot">${learnInfo}</div>`:''}
    <div class="wc-action">
      <button class="edit" data-id="${c.id}">编辑</button>
      <button class="study" data-id="${c.id}">学习</button>
      ${delBtn}
    </div>
  </div>`;
}
// 格式化日期为中文
function formatDate(d){ if(!d)return''; const a=new Date(d); return `${a.getMonth()+1}/${a.getDate()} ${a.getHours().toString().padStart(2,'0')}:${a.getMinutes().toString().padStart(2,'0')}`; }
function goLibrary(){browseMode=true;currentSearch='';currentFilter='all';document.getElementById('searchInput').value='';renderCurrentView();}
// 按状态浏览（如：已掌握 / 待学 / 复习中）
function goStatView(status){
  browseMode=true;currentSearch='';currentFilter=status;
  document.getElementById('searchInput').value='';
  renderCurrentView();
}
function renderLibrary(){
  const v=document.getElementById('view');
  let list=allCards;
  if(currentFilter!=='all')list=list.filter(c=>c.status===currentFilter);
  if(currentSearch){const q=currentSearch.trim();list=list.filter(c=>c.word.includes(q)||(c.meaning||'').includes(q)||(c.thinking||'').includes(q));}
  const filterLabels={all:'全部词汇',fresh:'今日新词(待学)',learning:'学习中',reviewing:'复习中',mastered:'已掌握'};
  const label=filterLabels[currentFilter]||'词库';
  const backBar=browseMode?`<div class="lib-back"><button data-back-home>‹ 返回今日</button><span>${list.length} 个</span></div>`:'';
  if(!list.length){v.innerHTML=`${backBar}<div class="empty"><div class="icon">🔍</div><div>没有匹配的词</div></div>`;return;}
  v.innerHTML=`${backBar}<div class="section-title"><span>${label} · ${list.length} 个</span></div>${list.map(cardHTML).join('')}`;
  bindCardActions(v);
}
function bindCardActions(v){
  v.querySelectorAll('.edit').forEach(b=>b.onclick=e=>{e.stopPropagation();openEditor(allCards.find(x=>x.id===b.dataset.id));});
  v.querySelectorAll('.study').forEach(b=>b.onclick=e=>{e.stopPropagation();startStudy([b.dataset.id]);});
  v.querySelectorAll('.del').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteCard(b.dataset.id);});
}
// 删除生词（确认后移除，并同步到仓库）
function deleteCard(id){
  const card=allCards.find(c=>c.id===id);
  if(!card)return;
  if(!window.confirm(`确定删除「${card.word}」吗？`))return;
  allCards=allCards.filter(c=>c.id!==id);
  saveCards();
  updateSummary();renderCurrentView();
  pushAll();
  toast(`已删除「${card.word}」`);
}

// ---------- 编辑器 ----------
let editingId=null;
let customFields=[]; // 编辑器内自定义栏目 [{label,value}]
function openEditor(card){
  editingId=card?card.id:null;
  document.getElementById('editorTitle').textContent=card?'编辑生词':'记录生词';
  document.getElementById('eWord').value=card?card.word:'';
  document.getElementById('eMeaning').value=card?card.meaning:'';
  document.getElementById('eFocus').value=card?card.focus:'';
  document.getElementById('eTone').value=(card&&card.tone)?card.tone:'';
  document.getElementById('eCollocation').value=(card&&card.collocation)?card.collocation:'';
  document.getElementById('eMisconstrue').value=(card&&(card.misconstrue||card.compare))?(card.misconstrue||card.compare):'';
  // 渲染自定义栏目
  customFields=[];
  const cf=document.getElementById('eCustomFields'); cf.innerHTML='';
  const customs=(card&&Array.isArray(card.custom))?card.custom:[];
  (customs.length?customs:[{label:'',value:''}]).forEach(c=>renderCustomRow(cf,c));
  // 重置预览区
  document.getElementById('eMeaningPreview').classList.add('hidden');
  document.getElementById('eMeaningToggle').textContent='👁 实时预览';
  document.getElementById('eFocusPreview').classList.add('hidden');
  document.getElementById('eFocusToggle').textContent='👁 实时预览';
  document.getElementById('eCollocationPreview').classList.add('hidden');
  document.getElementById('eCollocationToggle').textContent='👁 实时预览';
  document.getElementById('eMisconstruePreview').classList.add('hidden');
  document.getElementById('eMisconstrueToggle').textContent='👁 实时预览';
  document.getElementById('eDupHint').classList.add('hidden');
  document.getElementById('editor').classList.remove('hidden');
}
function closeEditor(){document.getElementById('editor').classList.add('hidden');}
// 渲染一个自定义栏目行 (obj={label,value})
function renderCustomRow(container,obj){
  const wrap=document.createElement('div');
  wrap.className='custom-field';
  wrap.innerHTML=`
    <div class="custom-row">
      <input class="c-name" value="${esc(obj.label||'')}" maxlength="12">
      <textarea class="c-val auto-grow">${esc(obj.value||'')}</textarea>
      <button class="c-del" title="删除栏目">✕</button>
    </div>
    <div class="custom-preview-wrap">
      <span class="custom-prev-toggle">👁 预览</span>
      <div class="md-preview hidden custom-pv"></div>
    </div>`;
  container.appendChild(wrap);
  const cval=wrap.querySelector('.c-val');
  const pv=wrap.querySelector('.custom-pv');
  const tg=wrap.querySelector('.custom-prev-toggle');
  bindAutoGrow(cval);
  bindMdShortcutsOn(cval); // markdown 快捷键 + 换行续序列
  const render=()=>{ pv.innerHTML=md(cval.value); };
  cval.addEventListener('input',()=>{ updateCustomFields(); if(!pv.classList.contains('hidden')) render(); });
  tg.onclick=()=>{ const hidden=pv.classList.contains('hidden'); pv.classList.toggle('hidden'); tg.textContent=hidden?'✏️ 编辑':'👁 预览'; if(hidden)render(); };
  wrap.querySelector('.c-del').onclick=()=>{ wrap.remove(); updateCustomFields(); };
  wrap.querySelector('.c-name').addEventListener('input',updateCustomFields);
  updateCustomFields();
}
function addCustomField(){
  renderCustomRow(document.getElementById('eCustomFields'),{label:'',value:''});
}
// 从 DOM 收集自定义栏目到 customFields
function updateCustomFields(){
  customFields=[];
  document.querySelectorAll('#eCustomFields .custom-row').forEach(row=>{
    const label=row.querySelector('.c-name').value.trim();
    const value=row.querySelector('.c-val').value.trim();
    if(label||value) customFields.push({label,value});
  });
}
// textarea 自适应高度（随输入增多变高）
function bindAutoGrow(ta){
  ta.addEventListener('input',()=>{ ta.style.height='auto'; ta.style.height=(ta.scrollHeight)+'px'; });
  ta.style.height='auto'; ta.style.height=(ta.scrollHeight)+'px';
}
// Markdown 实时预览：点 toggle 切换 编辑/预览；无 toggle 时（toogleId=null）自动常显预览
function bindMdPreview(textareaId, previewId, toggleId){
  const ta=document.getElementById(textareaId);
  const pv=document.getElementById(previewId);
  const tg=toggleId?document.getElementById(toggleId):null;
  const render=()=>{ pv.innerHTML=md(ta.value); pv.scrollTop=0; };
  const update=()=>{
    if(!pv.classList.contains('hidden')) render();
  };
  ta.addEventListener('input',update);
  if(tg){
    tg.onclick=()=>{
      const showing=pv.classList.contains('hidden');
      pv.classList.toggle('hidden', !showing);
      tg.textContent=showing?'✏️ 编辑':'👁 实时预览';
      if(showing) render();
    };
  } else {
    // 无 toggle → 常显实时预览（每次输入刷新）
    pv.classList.remove('hidden');
    ta.addEventListener('input',render);
    render();
  }
}

// Markdown 编辑快捷键：Tab缩进、Ctrl+B粗体、Ctrl+I斜体、Ctrl+` 行内代码
function addMdShortcuts(id){ const t=document.getElementById(id); if(t) bindMdShortcutsOn(t); }
function bindMdShortcutsOn(ta){
  if(!ta)return;
  ta.addEventListener('keydown',e=>{
    const selStart=ta.selectionStart, selEnd=ta.selectionEnd;
    const v=ta.value;
    // 换行自动续序列（列表续项 + 有序自动递增）
    if(e.key==='Enter'){
      // 取光标所在行的前缀（含前导空格和列表标记）
      const lineStart=v.lastIndexOf('\n',selStart-1)+1;
      const leading=v.slice(lineStart,selStart);
      let m=leading.match(/^(\s*)(\d+)[.)]\s+/);     // 有序 1. / 1)
      let mu=leading.match(/^(\s*)([-*•])\s+/);      // 无序 - / * / •
      if(m||mu){
        const pad=m?m[1]:mu[1];
        if(m){ const nxt=parseInt(m[2],10)+1; e.preventDefault(); ta.value=v.slice(0,selStart)+'\n'+pad+nxt+'. '+v.slice(selEnd); const pos=selStart+1+pad.length+String(nxt).length+3; ta.setSelectionRange(pos,pos); ta.dispatchEvent(new Event('input',{bubbles:true})); }
        else{ const marker=mu[2]==='*'?'*':'•'; e.preventDefault(); ta.value=v.slice(0,selStart)+'\n'+pad+marker+' '+v.slice(selEnd); const pos=selStart+1+pad.length+2; ta.setSelectionRange(pos,pos); ta.dispatchEvent(new Event('input',{bubbles:true})); }
        return;
      }
    }
    // Tab：插入两个空格缩进
    if(e.key==='Tab'){
      e.preventDefault();
      const pad='  ';
      ta.value=v.slice(0,selStart)+pad+v.slice(selEnd);
      const pos=selStart+pad.length;
      ta.setSelectionRange(pos,pos);
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return;
    }
    // 是否按下 ctrl/cmd
    if(!(e.ctrlKey||e.metaKey))return;
    let wrap='', before='';
    if(e.key==='b'||e.key==='B'){wrap='**';}
    else if(e.key==='i'||e.key==='I'){wrap='*';}
    else if(e.key==='`'){wrap='`';}
    else if(e.key==='k'||e.key==='K'){before='[',wrap='](url)';}
    else return;
    e.preventDefault();
    const sel=v.slice(selStart,selEnd);
    const replacement=(before?before:'')+wrap+sel+wrap;
    ta.value=v.slice(0,selStart)+replacement+v.slice(selEnd);
    const pos=selStart+replacement.length;
    ta.setSelectionRange(pos,pos);
    ta.dispatchEvent(new Event('input',{bubbles:true}));
  });
}
function bindEditor(){
  document.getElementById('editor').querySelector('[data-close]').onclick=closeEditor;
  document.getElementById('editor').addEventListener('click',e=>{if(e.target===document.getElementById('editor'))closeEditor();});
  bindMdPreview('eMeaning','eMeaningPreview','eMeaningToggle');
  bindMdPreview('eFocus','eFocusPreview','eFocusToggle');
  bindMdPreview('eCollocation','eCollocationPreview','eCollocationToggle');
  bindMdPreview('eMisconstrue','eMisconstruePreview','eMisconstrueToggle');
  // 添加自定义栏目
  document.getElementById('eAddCustom').onclick=addCustomField;
  // 自适应高度
  ['eMeaning','eFocus','eCollocation','eMisconstrue'].forEach(id=>{ const t=document.getElementById(id); if(t) bindAutoGrow(t); });
  // 词语重复实时提示
  document.getElementById('eWord').addEventListener('input',()=>{
    const w=document.getElementById('eWord').value.trim();
    const hint=document.getElementById('eDupHint');
    if(!w){hint.classList.add('hidden');return;}
    const dup=allCards.find(c=>c.word.toLowerCase()===w.toLowerCase() && c.id!==editingId);
    if(dup){hint.textContent=`⚠「${dup.word}」已经存在`;hint.classList.remove('hidden');hint.classList.remove('psing');}
    else{hint.classList.add('hidden');}
  });
  // Markdown 快捷键：Tab 缩进、Ctrl+B 粗体、Ctrl+I 斜体、Ctrl+` 行内代码
  ['eMeaning','eFocus','eCollocation','eMisconstrue'].forEach(id=>addMdShortcuts(id));
  document.getElementById('eSave').onclick=()=>{
    const word=document.getElementById('eWord').value.trim();
    const meaning=document.getElementById('eMeaning').value.trim();
    const focus=document.getElementById('eFocus').value.trim();
    const tone=document.getElementById('eTone').value.trim();
    const collocation=document.getElementById('eCollocation').value.trim();
    const misconstrue=document.getElementById('eMisconstrue').value.trim();
    if(!word){toast('请输入词语');return;}
    // 重复检查：同一词语（忽略大小写）已存在则提示，不保存
    const dup=allCards.find(c=>c.word.toLowerCase()===word.toLowerCase());
    if(dup && dup.id!==editingId){
      toast(`「${dup.word}」已经存在，不用重复添加`);
      return;
    }
    updateCustomFields(); // 收集自定义栏目到 customFields
    let card;
    if(editingId)card=allCards.find(c=>c.id===editingId);
    if(card){card.word=word;card.meaning=meaning;card.focus=focus;card.tone=tone;card.collocation=collocation;card.misconstrue=misconstrue;card.custom=customFields;card.updated_at=new Date().toISOString();}
    else{card=newCard({word,meaning,focus,tone,collocation,misconstrue,custom:customFields});allCards.push(card);}
    saveCards();closeEditor();renderCurrentView();updateSummary();
    if(quizReturn){ quizReturn=false; openQuiz(); toast(`已保存「${word}」`); }
    else if(ghReady()){
      const ok=pushAll();
      Promise.resolve(ok).then(r=>{ toast(r?`已保存并同步「${word}」✔`:`已保存「${word}」但同步失败，请检查设置`); });
    } else {
      toast(`已保存「${word}」（未配置GitHub，未同步）`);
    }
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
  refs.overlay.classList.remove('hidden');refs.gradeRow.classList.remove('hidden');
  refs.label.textContent=cards.every(c=>c.status==='fresh')?'今日新词':'复习';
  renderStudyCard();
}
function renderStudyCard(){
  const c=studyQueue[studyIndex];
  refs.pos.textContent=(studyIndex+1)+' / '+studyQueue.length;
  refs.flipCard.classList.remove('flipped');
  // 正面：词 + 三个输入框（重置）
  document.getElementById('frontWord').textContent=c.word;
  document.getElementById('sMeaning').value='';
  document.getElementById('sTone').value='';
  // 背面初始为空
  document.getElementById('aiText').textContent='';
  document.getElementById('backWord').textContent='';
  document.getElementById('backContent').innerHTML='';
  refs.back.scrollTop=0;
}
// 提交 AI 判定：收集用户理解 → 翻到背面 → 调用 AI → 显示结果
async function submitToAI(){
  const c=studyQueue[studyIndex];
  const uMeaning=document.getElementById('sMeaning').value.trim();
  const uTone=document.getElementById('sTone').value.trim();
  if(!uMeaning&&!uTone){ toast('请至少填一个理解字段'); return; }
  // 翻到背面，先显示加载
  refs.flipCard.classList.add('flipped');
  document.getElementById('aiText').textContent='正在请求 AI 评价…';
  // 构建提示词
  const cardInfo=[
    `词语：${c.word}`,
    c.meaning?`标准释义：${c.meaning}`:'',
    c.tone?`标准感情色彩：${c.tone}`:'',
    c.focus?`标准侧重：${c.focus}`:'',
  ].filter(Boolean).join('\n');
  const userInfo=[
    `用户的词义理解（含侧重）：${uMeaning||'(未填)'}`,
    `用户的感情色彩判断：${uTone||'(未填)'}`,
  ].join('\n');
  const prompt=`你是一个考公词语记忆教练。请根据词条的标准信息和用户的输入，从**意思上**评价用户对该词的理解（不要拘泥于字面表述，意思到位即可）。

${cardInfo}

用户输入：
${userInfo}

请给出：
1. **整体评价**（1-2句话，指出用户的优点和理解有偏差的地方）
2. **掌握建议**：从「很陌生」「有点难」「记住了」「很简单」中选择一个
3. **简短说明**（为什么建议这个等级）

请用下面格式回复（保持简洁，每段不长）：
整体评价：（评价内容）
掌握建议：（等级）
说明：（说明）`;
  const ai=JSON.parse(localStorage.getItem('gk_ai')||'{}');
  const finalPrompt=(ai.selfPromptTmpl||'').replace(/\{词语\}/g,c.word).replace(/\{标准信息\}/g,cardInfo).replace(/\{用户输入\}/g,userInfo)||prompt;
  // 调用 AI
  const aiResp=await callAI(prompt);
  // 渲染背面：完整释义
  document.getElementById('backWord').textContent=c.word;
  const backParts=[];
  if(c.meaning){ backParts.push(`<div class="back-label">📖 释义</div><div class="back-text">${md(c.meaning)}</div>`); }
  if(c.focus){ backParts.push(`<div class="back-label">🎯 侧重</div><div class="back-text">${md(c.focus)}</div>`); }
  if(c.tone){ backParts.push(`<div class="back-label">🎭 感情色彩</div><div class="back-text">${esc(c.tone)}</div>`); }
  if(c.collocation){ backParts.push(`<div class="back-label">🔗 常见搭配</div><div class="back-text">${md(c.collocation)}</div>`); }
  if(c.misconstrue||c.compare){ backParts.push(`<div class="back-label">⚖️ 易错易混</div><div class="back-text">${md(c.misconstrue||c.compare)}</div>`); }
  if(Array.isArray(c.custom)){ c.custom.forEach(it=>{ if(it&&it.label&&it.value){ backParts.push(`<div class="back-label">✏️ ${esc(it.label)}</div><div class="back-text">${md(it.value)}</div>`); } }); }
  document.getElementById('backContent').innerHTML=backParts.join('');
  // 解析 AI 回应
  if(aiResp){
    const verdict=aiResp.replace(/<[^>]+>/g,'');
    document.getElementById('aiText').textContent=verdict;
    const sugMatch=verdict.match(/掌握建议\s*[：:]\s*(.+)/i);
    if(sugMatch){
      const sug=sugMatch[1].trim();
      if(sug.indexOf('很简单')>=0||sug.indexOf('简单')>=0){ aiSuggest=3; }
      else if(sug.indexOf('记住')>=0||sug.indexOf('掌握')>=0||sug.indexOf('良好')>=0){ aiSuggest=2; }
      else if(sug.indexOf('有点难')>=0||sug.indexOf('困难')>=0||sug.indexOf('部分')>=0){ aiSuggest=1; }
      else if(sug.indexOf('很陌生')>=0||sug.indexOf('陌生')>=0||sug.indexOf('重新')>=0){ aiSuggest=0; }
    }
    const btns=document.querySelectorAll('#gradeRow .grade');
    btns.forEach(b=>b.style.outline='none');
    if(aiSuggest>=0 && aiSuggest<=3){
      btns[aiSuggest].style.outline='2px solid var(--primary)';
    }
  } else {
    document.getElementById('aiText').textContent='AI 请求失败，请检查设置或稍后重试。';
  }
}
// 点击"我不会"：跳过AI评价，直接看答案，默认选择很陌生
function skipWord(){
  const c=studyQueue[studyIndex];
  refs.flipCard.classList.add('flipped');
  document.getElementById('backWord').textContent=c.word;
  const backParts=[];
  if(c.meaning){ backParts.push(`<div class="back-label">📖 释义</div><div class="back-text">${md(c.meaning)}</div>`); }
  if(c.focus){ backParts.push(`<div class="back-label">🎯 侧重</div><div class="back-text">${md(c.focus)}</div>`); }
  if(c.tone){ backParts.push(`<div class="back-label">🎭 感情色彩</div><div class="back-text">${esc(c.tone)}</div>`); }
  if(c.collocation){ backParts.push(`<div class="back-label">🔗 常见搭配</div><div class="back-text">${md(c.collocation)}</div>`); }
  if(c.misconstrue||c.compare){ backParts.push(`<div class="back-label">⚖️ 易错易混</div><div class="back-text">${md(c.misconstrue||c.compare)}</div>`); }
  if(Array.isArray(c.custom)){ c.custom.forEach(it=>{ if(it&&it.label&&it.value){ backParts.push(`<div class="back-label">✏️ ${esc(it.label)}</div><div class="back-text">${md(it.value)}</div>`); } }); }
  document.getElementById('backContent').innerHTML=backParts.join('');
  document.getElementById('aiText').textContent='选择了"我不会"，建议评级：很陌生';
  const btns=document.querySelectorAll('#gradeRow .grade');
  btns.forEach(b=>b.style.outline='none');
  btns[0].style.outline='2px solid var(--primary)'; // 高亮"很陌生"
}
let aiSuggest=2;

// ---------- AI 调用 ----------
async function callAI(prompt){
  const ai=getActiveAi(); if(!ai||!ai.key){ toast('请先在设置里配置 AI'); return null; }
  const apiUrl=(ai.base||'https://api.openai.com/v1')+'/chat/completions';
  const model=ai.model||'gpt-4o-mini';
  const body=JSON.stringify({model,messages:[{role:'user',content:prompt}],max_tokens:300,temperature:0.3});
  try{ const resp=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+ai.key},body});
    if(!resp.ok){ toast('AI 请求失败: HTTP '+resp.status); return null; }
    const data=await resp.json(); return data.choices?.[0]?.message?.content||null;
  }catch(e){ toast('AI 请求异常'); return null; }
}
function getActiveAi(){
  const ai=JSON.parse(localStorage.getItem('gk_ai')||'{}');
  if(Array.isArray(ai.profiles)){ return ai.profiles.find(p=>p.active)||null; }
  return ai.key?ai:null;
}

// ---------- AI 设置 ----------
const aiDefaultLookup=`请对成语/词语「\${word}」做详细解析，按下面的栏目格式回答：

【释义】
一句话精准解释，60字以内。重点是这个词在考公真题语境下的核心意思。

【侧重】
从考公逻辑填空角度，说明这个词的常用侧重和语境（用于人还是物、强调程度是轻还是重、是主观评价还是客观描述等）。

【感情色彩】
褒义/贬义/中性/含贬义语境等，简短标注即可。

【常见搭配】
该词在考公真题中常出现的搭配（每项一行，- 开头，如：- 与…相得益彰）。

【易错易混】
列出 2-3 个考公中易混淆的词（每项一行，- 开头），简要点明区别（侧重/对象/程度/搭配之不同）。

请严格按此格式回答，只输出栏目内容，不要额外解释。`;
const aiDefaultSelfTest=`你是一个考公词语记忆教练。请根据词条的标准信息和用户的输入，从**意思上**评价用户对该词的理解（不要拘泥于字面表述，意思到位即可）。\n\n标准信息：\n\${cardInfo}\n\n用户输入：\n\${userInfo}\n\n请给出：\n1. **整体评价**（1-2句话，指出用户的优点和理解有偏差的地方）\n2. **掌握建议**：从「很陌生」「有点难」「记住了」「很简单」中选择一个\n3. **简短说明**（为什么建议这个等级）\n\n请用下面格式回复：\n整体评价：（评价内容）\n掌握建议：（等级）\n说明：（说明）`;

function openSettings(){
  const g=ghConfig();
  document.getElementById('sDaily').value=settings.dailyNew;
  document.getElementById('sTheme').value=settings.theme;
  document.getElementById('ghUser').value=g.user||'nimamxd25';
  document.getElementById('ghRepo').value=g.repo||'gk-cq';
  document.getElementById('ghBranch').value=g.branch||'main';
  document.getElementById('ghToken').value=g.token||'';
  // AI 配置
  const ai=JSON.parse(localStorage.getItem('gk_ai')||'{}');
  if(!ai.promptTmpl) ai.promptTmpl=aiDefaultLookup;
  if(!ai.selfPromptTmpl) ai.selfPromptTmpl=aiDefaultSelfTest;
  document.getElementById('aiPromptTmpl').value=ai.promptTmpl||'';
  document.getElementById('aiSelfPromptTmpl').value=ai.selfPromptTmpl||'';
  if(!Array.isArray(ai.profiles)) ai.profiles=[];
  renderAiProfiles(ai.profiles);
  document.getElementById('settings').classList.remove('hidden');
}
function closeSettings(){document.getElementById('settings').classList.add('hidden');}
function bindSettings(){
  const st=document.getElementById('settings');
  st.querySelector('[data-close]').onclick=closeSettings;
  st.addEventListener('click',e=>{if(e.target===st)closeSettings();});
  document.getElementById('sSave').onclick=()=>{saveGhForm();saveAiConfig();toast('设置已保存 ✔');closeSettings();};
  document.getElementById('sPull').onclick=async()=>{saveGhForm();saveAiConfig();toast('拉取中…');await pullAll();renderCurrentView();updateSummary();toast(ghReady()?'已拉取并合并 ✔':'⚠️ 未配置GitHub，请填写配置');};
  document.getElementById('sPush').onclick=async()=>{saveGhForm();const ok=await pushAll();toast(ok?'已同步到仓库 ✔':'⚠️ 同步失败，请检查配置是否填写正确');};
  document.getElementById('sExport').onclick=()=>{const blob=new Blob([JSON.stringify(allCards,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='生词本备份_'+todayStr()+'.json';a.click();toast('已导出备份');};
  document.getElementById('btnAddAiProfile').onclick=()=>addAiProfile();
}
function renderAiProfiles(profiles){
  const el=document.getElementById('aiProfiles');
  if(!profiles.length){ profiles.push({id:'def',name:'默认',key:'',base:'',model:'',active:true}); }
  el.innerHTML=profiles.map((p,i)=>`<div class="ai-profile${p.active?' active':''}" data-idx="${i}">
    <div class="ai-profile-header">
      <span class="ai-profile-name"><input value="${esc(p.name||'')}" data-field="name" placeholder="配置名称"></span>
      ${p.active?'<span class="ai-profile-badge">使用中</span>':''}
    </div>
    <div class="ai-profile-body">
      <input type="password" data-field="key" value="${esc(p.key||'')}" placeholder="API Key (sk-...)">
      <input data-field="base" value="${esc(p.base||'')}" placeholder="https://api.openai.com/v1">
      <div class="ai-profile-model-row">
        <select data-field="model">${(p._models||[]).map(m=>`<option value="${esc(m)}" ${m===p.model?'selected':''}>${m}</option>`).join('')}${(!p._models||!p._models.length||(p.model&&!p._models.includes(p.model)))?`<option value="${esc(p.model||'')}" selected>${p.model||'（未设置）'}</option>`:''}<option value="__custom__" ${!p.model?'selected':''}>✏️ 自行输入…</option></select>
        <input data-field="modelCustom" style="${(!p._models||!p._models.includes(p.model)) && p.model?'':'display:none'}" value="${(!p._models||!p._models.includes(p.model))?esc(p.model||''):''}" placeholder="输入模型名">
        <button class="fetch-models" data-idx="${i}">获取</button>
      </div>
    </div>
    <div class="ai-profile-actions">
      ${profiles.length>1?`<button class="del-profile" data-idx="${i}">删除</button>`:''}
      <button class="test-profile" data-idx="${i}">测试连接</button>
      ${!p.active?`<button class="activate-btn" data-idx="${i}">启用</button>`:''}
    </div>
  </div>`).join('');
  // 绑定事件：获取模型按钮
  el.querySelectorAll('.fetch-models').forEach(b=>b.onclick=e=>{
    e.preventDefault(); e.stopPropagation();
    const idx=+b.dataset.idx;
    fetchModelsForProfile(idx);
  });
  el.querySelectorAll('.test-profile').forEach(b=>b.onclick=e=>{
    e.preventDefault(); e.stopPropagation();
    const idx=+b.dataset.idx;
    testAiProfile(idx);
  });
  // 模型select联动：选"自行输入"显示文本框
  el.querySelectorAll('select[data-field="model"]').forEach(sel=>{
    sel.onchange=()=>{
      const row=sel.closest('.ai-profile-model-row');
      const ci=row.querySelector('[data-field="modelCustom"]');
      if(sel.value==='__custom__'){ ci.style.display=''; ci.value=''; ci.focus(); }
      else{ ci.style.display='none'; }
    };
  });
  el.querySelectorAll('.activate-btn').forEach(b=>b.onclick=e=>{
    const idx=+b.dataset.idx;
    const profiles=getProfilesFromDOM(); profiles.forEach((p,i)=>{ p.active=i===idx; }); renderAiProfiles(profiles);
  });
  el.querySelectorAll('.del-profile').forEach(b=>b.onclick=e=>{
    const idx=+b.dataset.idx;
    let profiles=getProfilesFromDOM(); if(profiles.length<=1)return;
    profiles.splice(idx,1); if(!profiles.some(p=>p.active))profiles[0].active=true; renderAiProfiles(profiles);
  });
}
function addAiProfile(){
  const profiles=getProfilesFromDOM();
  profiles.push({id:'pro_'+Date.now().toString(36),name:'新配置',key:'',base:'',model:'',active:false, _models:[]});
  renderAiProfiles(profiles);
}
function getProfilesFromDOM(){
  const profiles=[];
  document.querySelectorAll('#aiProfiles .ai-profile').forEach(el=>{
    profiles.push({
      id: el.dataset.xid||('pro_'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)),
      name: el.querySelector('[data-field="name"]').value.trim()||'默认',
      key: el.querySelector('[data-field="key"]').value.trim(),
      base: el.querySelector('[data-field="base"]').value.trim(),
      model: (()=>{ const s=el.querySelector('[data-field="model"]'); const ci=el.querySelector('[data-field="modelCustom"]'); return s.value==='__custom__'?ci.value.trim():s.value; })(),
      active: el.classList.contains('active'),
      _models: Array.from(el.querySelector('select[data-field="model"]').options).map(o=>o.value).filter(v=>v!=='__custom__')
    });
  });
  return profiles;
}
async function fetchModelsForProfile(idx){
  const el=document.querySelectorAll('#aiProfiles .ai-profile')[idx];
  const base=el.querySelector('[data-field="base"]').value.trim()||'https://api.openai.com/v1';
  const key=el.querySelector('[data-field="key"]').value.trim();
  if(!key){ toast('请先填写 API Key'); return; }
  toast('获取模型列表…');
  try{
    const resp=await fetch(base+'/models',{headers:{'Authorization':'Bearer '+key}});
    if(!resp.ok){ toast('获取失败: HTTP '+resp.status); return; }
    const data=await resp.json();
    const models=(data.data||[]).map(m=>m.id).sort();
    if(!models.length){ toast('未获取到模型'); return; }
    const sel=el.querySelector('select[data-field="model"]');
    const ci=el.querySelector('[data-field="modelCustom"]');
    const cur=sel.value==='__custom__'?ci.value.trim():sel.value;
    dl.innerHTML=models.map(m=>`<option value="${esc(m)}">`).join('');
    // pref chat model
    const chatModels=['gpt-4o-mini','gpt-4o','gpt-3.5-turbo','deepseek-chat','qwen-turbo','qwen-plus','claude-3'];
    let found=false;
    for(const pref of chatModels){ const m=models.find(x=>x.includes(pref)); if(m){ sel.value=m; found=true; break; } }
    if(!found&&cur&&models.includes(cur)){ sel.value=cur; }
    else if(!found&&models.length){ sel.value=models[0]; }
    ci.style.display='none';
    toast(`获取到 ${models.length} 个模型`);
  }catch(e){ toast('网络异常'); }
}
// 测试 API 连通性
async function testAiProfile(idx){
  const el=document.querySelectorAll('#aiProfiles .ai-profile')[idx];
  const base=(el.querySelector('[data-field="base"]').value.trim()||'https://api.openai.com/v1');
  const key=el.querySelector('[data-field="key"]').value.trim();
  if(!key){ toast('请先填写 API Key'); return; }
  toast('测试中…');
  try{
    const resp=await fetch(base+'/models',{headers:{'Authorization':'Bearer '+key}});
    if(resp.ok){ toast('✅ 连接成功'); }
    else{ toast('❌ 连接失败: HTTP '+resp.status); }
  }catch(e){ toast('❌ 网络异常'); }
}

function saveAiConfig(){
  const profiles=getProfilesFromDOM();
  const ai={
    profiles,
    promptTmpl: document.getElementById('aiPromptTmpl').value.trim(),
    selfPromptTmpl: document.getElementById('aiSelfPromptTmpl').value.trim()
  };
  localStorage.setItem('gk_ai', JSON.stringify(ai));
}
// 把设置表单里的 GitHub 配置立即写入 localStorage
function saveGhForm(){
  settings.dailyNew=Math.min(100,Math.max(1,+document.getElementById('sDaily').value||20));
  settings.theme=document.getElementById('sTheme').value;saveSettings();
  saveGh({user:document.getElementById('ghUser').value.trim(),repo:document.getElementById('ghRepo').value.trim(),branch:document.getElementById('ghBranch').value.trim()||'main',token:document.getElementById('ghToken').value.trim()});
}

// ---------- 学习流程收尾（SM-2 分级退出） ----------
function gradeFromButton(g){const c=studyQueue[studyIndex];applyGrade(c,g);saveCards();pushAll();studyIndex++;if(studyIndex<studyQueue.length)renderStudyCard();else endStudy();}
function endStudy(){refs.overlay.classList.add('hidden');toast('本组学习完成 🎉');saveCards();pushAll();markStudyDay();updateSummary();updateHeatmap();renderCurrentView();
  if(quizReturn){ quizReturn=false; openQuiz(); } }
function markStudyDay(){
  const days=JSON.parse(localStorage.getItem('gk_studyDays')||'[]');
  if(!days.includes(todayStr())){
    days.push(todayStr());
    if(days.length>100) days.shift();
    localStorage.setItem('gk_studyDays',JSON.stringify(days));
  }
}
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
  s.totalRating+=g;s.lastStudyTime=new Date().toISOString();s.history=s.history||[];s.history.push({date:todayStr(),grade:g});return s;
}
function reviewFlow(){
  const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr());
  const learned=allCards.filter(c=>c.status!=='fresh');
  if(due.length){startStudy(due.map(c=>c.id));refs.label.textContent='复习';}
  else if(learned.length){startStudy(learned.slice(0,settings.dailyNew).map(c=>c.id));refs.label.textContent='巩固复习';}
  else toast('还没有已学词汇，先学习吧');
}

// ---------- AI 查词 ----------
function openAiLookup(){
  document.getElementById('aiLookup').classList.remove('hidden');
  document.getElementById('aiWord').value=''; document.getElementById('aiResultContent').classList.add('hidden'); document.getElementById('btnAiSave').classList.add('hidden');
  // 显示当前模型 + 异步测试连通性
  const ai=getActiveAi();
  const modelEl=document.getElementById('aiLookupModel');
  if(modelEl){ modelEl.textContent=ai?`${ai.name||'API'} · ${ai.model||'未选模型'}`:'未配置 AI'; }
  if(ai){ testAiConnectivitySilent(ai).then(ok=>{ if(modelEl)modelEl.style.color=ok?'var(--good)':'var(--bad)'; }); }
}
function closeAiLookup(){ document.getElementById('aiLookup').classList.add('hidden'); }
async function testAiConnectivitySilent(ai){
  try{ const resp=await fetch((ai.base||'https://api.openai.com/v1')+'/models',{headers:{'Authorization':'Bearer '+ai.key}}); return resp.ok; }
  catch(e){ return false; }
}
async function doAiLookup(){
  const word=document.getElementById('aiWord').value.trim();
  if(!word){ toast('请输入词语'); return; }
  const ai=getActiveAi();
  if(!ai||!ai.model||!ai.key){ toast('请先在设置里配置 AI（API Key + 模型）'); return; }
  document.getElementById('aiLoading').classList.remove('hidden');
  document.getElementById('aiResultContent').classList.add('hidden');
  document.getElementById('btnAiSave').classList.add('hidden');
  const aiData=JSON.parse(localStorage.getItem('gk_ai')||'{}');
  const defaultPrompt=`请对成语/词语「${word}」做详细解析，按下面的栏目格式回答：

【释义】
一句话精准解释，60字以内。重点是这个词在考公真题语境下的核心意思。

【侧重】
从考公逻辑填空角度，说明这个词的常用侧重和语境（用于人还是物、强调程度是轻还是重、是主观评价还是客观描述等）。

【感情色彩】
褒义/贬义/中性/含贬义语境等，简短标注即可。

【常见搭配】
该词在考公真题中常出现的搭配（每项一行，- 开头，如：- 与…相得益彰）。

【易错易混】
列出 2-3 个考公中易混淆的词（每项一行，- 开头），简要点明区别（侧重/对象/程度/搭配之不同）。

请严格按此格式回答，只输出栏目内容，不要额外解释。`;
  const prompt=(ai.promptTmpl||'').replace(/\{词语\}/g,word)||defaultPrompt;
  const resp=await callAI(prompt);
  document.getElementById('aiLoading').classList.add('hidden');
  if(!resp){ document.getElementById('aiResultContent').innerHTML='<b>请求失败</b>，请检查 AI 设置。'; document.getElementById('aiResultContent').classList.remove('hidden'); return; }
  // 解析 AI 返回
  const fields={meaning:'',focus:'',tone:'',collocation:'',misconstrue:''};
  const keys=['释义','侧重','感情色彩','常见搭配','易错易混'];
  const map={释义:'meaning',侧重:'focus',感情色彩:'tone',常见搭配:'collocation',易错易混:'misconstrue'};
  let cur='';
  const lines=resp.split('\n');
  for(const l of lines){
    const tr=l.trim();
    if(!tr)continue;
    let found=false;
    for(const k of keys){
      if(tr.indexOf('【'+k+'】')===0||tr.indexOf('['+k+']')===0||tr.indexOf(k+'：')===0||tr.indexOf(k+':')===0||tr.indexOf(k+' ')===0){
        cur=map[k];found=true;break;
      }
    }
    if(found){
      fields[cur]=(fields[cur]?'\n':'')+tr.replace(/^[【\[]?[^】\]]*[】\]]?\s*[:：]?\s*/,'').trim();
    }else if(cur){
      fields[cur]+=(fields[cur]?'\n':'')+tr;
    }
  }
  // 渲染结果
  let html='<div class="ai-result-fields">';
  for(const k of keys){
    const v=fields[map[k]];
    if(v) html+=`<p><b>${k}</b></p><pre style="white-space:pre-wrap;margin:0 0 10px;font-family:inherit">${esc(v)}</pre>`;
  }
  html+='</div>';
  document.getElementById('aiResultContent').innerHTML=html;
  document.getElementById('aiResultContent').classList.remove('hidden');
  document.getElementById('btnAiSave').classList.remove('hidden');
  // 暂存解析结果
  resolvedFields=fields;
}
let resolvedFields=null;
function saveAiLookupResult(){
  if(!resolvedFields||!resolvedFields.meaning){ toast('请先查询并等待结果'); return; }
  const word=document.getElementById('aiWord').value.trim();
  closeAiLookup();
  openEditor();
  document.getElementById('eWord').value=word;
  document.getElementById('eMeaning').value=resolvedFields.meaning||'';
  document.getElementById('eFocus').value=resolvedFields.focus||'';
  document.getElementById('eTone').value=resolvedFields.tone||'';
  document.getElementById('eCollocation').value=resolvedFields.collocation||'';
  document.getElementById('eMisconstrue').value=resolvedFields.misconstrue||'';
  if(quizReturn){ toast('请确认后点保存，将回到刷题页面'); }
  else{ toast('AI 结果已填入，确认后保存'); }
}

// ---------- 事件 ----------
function bindEvents(){
  document.getElementById('btnStudy').onclick=()=>{browseMode=false;currentSearch='';document.getElementById('searchInput').value='';renderCurrentView();
    const todayKey='gk_daily_'+todayStr();
    let dailyBatch=JSON.parse(localStorage.getItem(todayKey)||'null');
    if(!dailyBatch){ const fresh=allCards.filter(c=>c.status==='fresh'); dailyBatch=fresh.slice(0,settings.dailyNew).map(c=>c.id); localStorage.setItem(todayKey,JSON.stringify(dailyBatch)); }
    const batchCards=dailyBatch.map(id=>allCards.find(c=>c.id===id)).filter(c=>c&&c.status==='fresh');
    if(batchCards.length)startStudy(batchCards.map(c=>c.id));
    else{const due=allCards.filter(c=>c.status!=='fresh'&&c.status!=='mastered'&&c.due<=todayStr());if(due.length)reviewFlow();else toast('还没有新词，先添加或去复习');}
  };
  document.getElementById('btnReview').onclick=()=>{browseMode=false;currentSearch='';document.getElementById('searchInput').value='';renderCurrentView();reviewFlow();};
  document.getElementById('btnLibrary').onclick=goLibrary;
  // "总词汇"卡片点击也进入词库
  const totalCell=document.getElementById('totalCell');
  if(totalCell) totalCell.onclick=goLibrary;
  document.querySelectorAll('[data-goto="library"]').forEach(el=>{ if(el&&el.id!=='totalCell') el.onclick=goLibrary; });
  // "已掌握"统计卡点击 → 查看已掌握词汇
  document.querySelectorAll('[data-stat]').forEach(el=>{
    el.onclick=()=>goStatView(el.dataset.stat);
  });
  // 词库视图内的"返回今日"按钮（委托点击）
  document.getElementById('view').addEventListener('click',e=>{
    const back=e.target.closest('[data-back-home]');
    if(back){browseMode=false;currentSearch='';document.getElementById('searchInput').value='';renderCurrentView();}
  });
  document.getElementById('btnAdd').onclick=()=>{browseMode=false;openEditor();};
  document.getElementById('btnSettings').onclick=openSettings;
  // AI 查词（主页入口 + 编辑器入口均指向同一面板）
  document.getElementById('btnAiLookupHome').addEventListener('click',()=>openAiLookup());
  document.getElementById('btnAiLookup').addEventListener('click',()=>openAiLookup());
  // 刷题
  document.getElementById('btnQuiz').addEventListener('click',openQuiz);
  document.getElementById('quizStartBtn').addEventListener('click',startQuizBatch);
  document.getElementById('quizClose').addEventListener('click',closeQuiz);
  document.getElementById('quizEnd').addEventListener('click',showQuizHome);
  document.getElementById('quizPrev').addEventListener('click',()=>{if(quizIdx>0){quizIdx--;const qid=quizBatch[quizIdx];const q=quizQuestions.find(q=>q.id===qid);q.userAnswer=null;q.wordTags=null;renderQuizQuestion(q);}});
  document.getElementById('quizNext').addEventListener('click',()=>{if(quizIdx<quizBatch.length-1){quizIdx++;const qid=quizBatch[quizIdx];const q=quizQuestions.find(q=>q.id===qid);q.userAnswer=null;q.wordTags=null;renderQuizQuestion(q);}});
  document.getElementById('quizBatchSize').addEventListener('change',()=>{});
  // AI 查词
  document.getElementById('btnAiLookup').addEventListener('click',()=>openAiLookup());
  document.getElementById('aiLookupClose').addEventListener('click',closeAiLookup);
  document.getElementById('btnAiLookupGo').addEventListener('click',doAiLookup);
  document.getElementById('btnAiSave').addEventListener('click',saveAiLookupResult);
  document.getElementById('searchInput').addEventListener('input',e=>{browseMode=true;currentSearch=e.target.value;renderLibrary();});
  document.getElementById('flipCard').addEventListener('click',()=>{}); // 不再手动翻转
  document.getElementById('btnAiSubmit').addEventListener('click',submitToAI);
  document.getElementById('btnSkipWord').addEventListener('click',skipWord);
  document.querySelectorAll('#gradeRow .grade').forEach(b=>b.onclick=()=>gradeFromButton(+b.dataset.grade));
  // 退出学习按钮：关闭覆盖层，回到主界面（保留已学进度并同步）
  document.getElementById('studyExit').addEventListener('click',()=>{
    if(refs && refs.overlay) refs.overlay.classList.add('hidden');
    saveCards();pushAll();updateSummary();renderCurrentView();
    toast('已退出学习');
  });
}

// ---------- boot ----------
function boot(){
  loadSettings();
  const stored=loadCards();
  if(stored&&Array.isArray(stored))allCards=stored;else{allCards=[];saveCards();}
  // 加载预制词库（仅首次，本地标记 builtin_v1 防重复加载）
  const builtinLoaded = localStorage.getItem('builtin_v1');
  if(!builtinLoaded){
    loadBuiltinWords().then(loaded=>{ if(loaded){ localStorage.setItem('builtin_v1','1'); saveCards(); updateSummary(); renderCurrentView(); toast('已加载 713 预制词条'); } });
  }
  updateSummary();renderCurrentView();updateHeatmap();
  bindEditor();bindSettings();bindEvents();
  if(ghReady())setTimeout(()=>pullAll().then(()=>{updateSummary();renderCurrentView();}),600);
}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),2200);}

// ---------- 暴露给快捷指令 / 外部 ----------
window.__pushNow=function(){return pushAll();};
window.__configureGh=function(u,r,b,t){saveGh({user:u,repo:r,branch:b||'main',token:t});return !!u&&!!r&&!!t;};
window.__addCardFromShortcut=async function(word,meaning,thinking){
  const card=newCard({word,meaning,thinking});
  allCards.push(card);saveCards();
  await pushAll();updateSummary();renderCurrentView();
  return card.id;
};

window.addEventListener('load',boot);

// ---------- 刷题模块 ----------
let quizQuestions=[], quizIdx=0, quizAnswered=null, quizReturn=false;
let quizBatch=[], quizBatchSize=20; // 抽取的批次
let quizStats={}; // {id:{correct,wrong,streak,last}} 答题统计
async function loadQuiz(){
  try{
    const r=await fetch('https://raw.githubusercontent.com/nimamxd25/gk-hlf/main/questions.json');
    quizQuestions=await r.json();
  }catch(e){ toast('题库加载失败'); }
}
function openQuiz(){
  quizReturn=false;
  document.getElementById('quizPage').classList.remove('hidden');
  showQuizHome();
}
function showQuizHome(){
  document.getElementById('quizHome').classList.remove('hidden');
  document.getElementById('quizBody').classList.add('hidden');
  document.getElementById('quizFoot').classList.add('hidden');
  if(!quizQuestions.length){ loadQuiz().then(()=>renderQuizHomeStats()); }
  else{ renderQuizHomeStats(); }
}
function renderQuizHomeStats(){
  loadQuizStats();
  const total=quizQuestions.length;
  const done=new Set(Object.keys(quizStats).map(Number));
  const doneCount=done.size;
  const freshCount=total-doneCount;
  let correctTotal=0, wrongTotal=0;
  for(const id in quizStats){ correctTotal+=quizStats[id].correct||0; wrongTotal+=quizStats[id].wrong||0; }
  const acc=correctTotal+wrongTotal>0?Math.round(correctTotal/(correctTotal+wrongTotal)*100):0;
  const wrongPool=quizQuestions.filter(q=>quizStats[q.id]&&quizStats[q.id].wrong>0).length;
  const mastered=Object.values(quizStats).filter(s=>s.streak>=3&&s.wrong===0).length;
  document.getElementById('qsTotal').textContent=total;
  document.getElementById('qsDone').textContent=doneCount;
  document.getElementById('qsFresh').textContent=freshCount;
  document.getElementById('qsAcc').textContent=correctTotal+wrongTotal>0?acc+'%':'--%';
  document.getElementById('qsAcc').style.color=acc>=70?'var(--good)':(acc>0?'var(--bad)':'var(--muted)');
  document.getElementById('qsCorrect').textContent=correctTotal;
  document.getElementById('qsWrong').textContent=wrongTotal;
  document.getElementById('qsWrongPool').textContent=wrongPool;
  document.getElementById('qsMastered').textContent=mastered;
}
function startQuizBatch(){
  buildQuizBatch();
  document.getElementById('quizHome').classList.add('hidden');
  document.getElementById('quizBody').classList.remove('hidden');
  document.getElementById('quizFoot').classList.remove('hidden');
}
function buildQuizBatch(){
  loadQuizStats();
  const sz=parseInt(document.getElementById('quizBatchSize').value)||20;
  quizBatchSize=sz;
  const allIds=quizQuestions.map(q=>q.id);
  // 优先错题 + 没做过 + 连续对>=3降频
  const wrongPool=allIds.filter(id=>(quizStats[id]?.wrong||0)>0);
  const freshPool=allIds.filter(id=>!quizStats[id]);
  const goodPool=allIds.filter(id=>quizStats[id]&&(quizStats[id].wrong||0)===0&&quizStats[id].streak<3);
  const masteredPool=allIds.filter(id=>quizStats[id]&&quizStats[id].streak>=3&&(quizStats[id].wrong||0)===0);
  // 构建候选池：错题权重最高，没抽过的次之，其他正常
  let pool=[];
  pool=pool.concat(wrongPool); // 错题全部
  pool=pool.concat(wrongPool); // 错题双倍权重
  pool=pool.concat(freshPool); // 没做过的
  pool=pool.concat(goodPool); // 做对但不足3次
  pool=pool.concat(masteredPool.slice(0, Math.ceil(masteredPool.length/4))); // 已掌握的少量
  // 随机打乱取 batchSize
  shuffle(pool);
  const batch=pool.slice(0, Math.min(pool.length, quizBatchSize));
  quizBatch=batch;
  quizQuestions.forEach(q=>{q.userAnswer=null;q.wordTags=null;});
  if(!batch.length){ document.getElementById('quizBody').innerHTML='<p>没有可抽的题目</p>'; return; }
  showQuizQuestion(0);
}
function showQuizQuestion(idx){
  quizIdx=idx;
  const qid=quizBatch[quizIdx];
  const q=quizQuestions.find(q=>q.id===qid);
  if(!q)return;
  renderQuizQuestion(q);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]; } }
function loadQuizStats(){ try{quizStats=JSON.parse(localStorage.getItem('quiz_stats')||'{}');}catch(e){quizStats={};} }
function saveQuizStats(){ localStorage.setItem('quiz_stats',JSON.stringify(quizStats)); }
function toggleQuizStats(){
  const panel=document.getElementById('quizStatsPanel');
  panel.classList.toggle('hidden');
  if(!panel.classList.contains('hidden')) renderQuizStats();
}
function renderQuizStats(){
  loadQuizStats();
  const total=quizQuestions.length;
  const done=new Set(Object.keys(quizStats).map(Number));
  const doneCount=done.size;
  const freshCount=total-doneCount;
  let correctTotal=0, wrongTotal=0;
  for(const id in quizStats){ correctTotal+=quizStats[id].correct||0; wrongTotal+=quizStats[id].wrong||0; }
  const acc=correctTotal+wrongTotal>0?Math.round(correctTotal/(correctTotal+wrongTotal)*100):0;
  const wrongPool=quizQuestions.filter(q=>quizStats[q.id]&&quizStats[q.id].wrong>0).length;
  const html=`<button class="quiz-stats-close" onclick="document.getElementById('quizStatsPanel').classList.add('hidden')">✕</button>
    <h3>📊 答题统计</h3>
    <p>总题数：<b>${total}</b> · 已做：<b>${doneCount}</b> · 未做：<b>${freshCount}</b></p>
    <p>总答题次数：<b>${correctTotal+wrongTotal}</b></p>
    <p>正确率：<b style="color:${acc>=70?'var(--good)':'var(--bad)'}">${acc}%</b>（✅${correctTotal} ❌${wrongTotal}）</p>
    <p>当前错题数：<b>${wrongPool}</b></p>
    <p>连续正确≥3（已掌握）：<b>${Object.values(quizStats).filter(s=>s.streak>=3&&s.wrong===0).length}</b> 题</p>
    <p style="font-size:12px;color:var(--muted)">错题优先抽取 · 未做题优先 · 连续对3次减少出现</p>
  `;
  document.getElementById('quizStatsContent').innerHTML=html;
}
function closeQuiz(){ document.getElementById('quizPage').classList.add('hidden'); }
// 记录答题统计并在 renderQuizQuestion 中调用
function recordQuizResult(q, correct){
  const id=q.id;
  if(!quizStats[id]) quizStats[id]={correct:0,wrong:0,streak:0,last:''};
  if(correct){ quizStats[id].correct++; quizStats[id].streak++; }
  else{ quizStats[id].wrong++; quizStats[id].streak=0; }
  quizStats[id].last=new Date().toISOString();
  saveQuizStats();
}
function quizOptionClick(idx){
  const qid=quizBatch[quizIdx];
  const q=quizQuestions.find(q=>q.id===qid);
  if(!q||q.userAnswer!==null)return;
  q.userAnswer=idx;
  const letters=['A','B','C','D'];
  const correct=letters[idx]===q.answer;
  recordQuizResult(q, correct);
  renderQuizQuestion(q);
}
function renderQuizQuestion(q){
  document.getElementById('quizPos').textContent=`${quizIdx+1}/${quizBatch.length}`;
  const stemDisplay=q.stem.replace(/\([\s]*\)/g,'<b>(   )</b>');
  let optionsHTML='';
  const letters=['A','B','C','D'];
  const correct=q.answer;
  const allOptions=flatOptions(q.options);
  allOptions.forEach((optTxt,i)=>{
    const cls=q.userAnswer===i?(correct===letters[i]?'correct':'wrong'):(q.userAnswer!==null&&letters[i]===correct?'reveal':'');
    optionsHTML+=`<button class="quiz-option ${cls}" data-idx="${i}">${optTxt}</button>`;
  });
  let resultHTML='';
  if(q.userAnswer!==null){
    resultHTML=`<div class="quiz-result ${letters[q.userAnswer]===correct?'ok':'fail'}">${letters[q.userAnswer]===correct?'✅ 正确！':'❌ 错误，正确答案是 '+correct}</div>`;
    if(!q.wordTags){
      const wl=extractWords(q);
      q.wordTags=wl.map(w=>({word:w,inLib:allCards.some(c=>c.word===w)}));
    }
    resultHTML+='<div class="quiz-word-tags">'+q.wordTags.map(w=>
      `<span class="quiz-word-tag ${w.inLib?'inlib':''}" data-word="${esc(w.word)}">${w.word}${w.inLib?' 📖':''}</span>`
    ).join('')+'</div>';
  }
  document.getElementById('quizBody').innerHTML=`
    <div class="quiz-meta"><span class="quiz-year">${esc(q.year||'')}${q.prompt?' · '+esc(q.prompt):''}</span></div>
    <div class="quiz-stem">${stemDisplay}</div>
    ${optionsHTML}
    ${resultHTML}
  `;
  document.querySelectorAll('.quiz-option').forEach(b=>{
    b.onclick = function(){ quizOptionClick(+this.dataset.idx); };
  });
  // 绑定词语标签点击（返回刷题回跳的）
  document.querySelectorAll('.quiz-word-tag').forEach(tag=>{
    tag.onclick=()=>{
      const w=tag.dataset.word;
      const card=allCards.find(c=>c.word===w);
      if(card){
        document.getElementById('quizPage').classList.add('hidden');
        quizReturn=true;
        startStudy([card.id]);
      } else {
        openAiLookup();
        document.getElementById('aiWord').value=w;
        quizReturn=true;
        setTimeout(()=>doAiLookup(),400);
      }
    };
  });
}
function flatOptions(opts){
  const result=[];
  opts.forEach(o=>{
    // 按 A. B. C. D. 拆分
    const parts=o.replace(/([A-D])\./g,'||$1.').split('||').filter(Boolean);
    parts.forEach(p=>result.push(p.trim()));
  });
  return result.length===4?result:opts; // fallback
}
function extractWords(q){
  const ws=new Set();
  const letters=['A','B','C','D'];
  const allOpts=flatOptions(q.options);
  allOpts.forEach(o=>{
    o.replace(/^[A-D]\.\s*/,'').split(/\s+/).forEach(p=>{
      p=p.replace(/[；;。，,.、]$/,'').trim();
      if(p.length>=2&&!/^\d+$/.test(p)&&!/[a-zA-Z]/.test(p))ws.add(p);
    });
  });
  return Array.from(ws);
}
})();
