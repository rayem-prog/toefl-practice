'use strict';
const bank=BANK.passages,byId=new Map(bank.map(p=>[p.id,p])),KEY='word-completion-v1';
const frequencies=Core.frequencies(bank),families=new Map(bank.map(p=>[p.family||p.id,frequencies.get(p.id)]));
const repeatedFamilies=[...families.values()].filter(n=>n>1).length,maxFrequency=Math.max(...families.values());
const fresh=()=>({version:1,history:[],favorites:[],session:null,order:'asc',importantWords:[]});
let state=fresh(),view='daily',result=null,selected=null;
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(s){$('#notice').textContent=s}
try{const saved=localStorage.getItem(KEY);if(saved)state=Core.validateBackup(JSON.parse(saved),bank)}catch(e){notice('本地记录无法读取。请恢复有效备份；原数据未被覆盖。')}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));return true}catch(e){notice('浏览器无法保存记录，请立即导出备份。');return false}}
function latest(id){return [...state.history].reverse().find(h=>h.id===id)}
function familyKey(id){const p=byId.get(id);return p?(p.family||p.id):id}
function familyFavorite(id){const key=familyKey(id);return state.favorites.some(f=>familyKey(f)===key)}
function familyWrong(p,progress){const h=progress.get(p.family||p.id)?.latest;if(!h)return false;const g=Core.grade(byId.get(h.id),h.answers);return g.correct<g.total}
function isWrong(id){const h=latest(id);if(!h)return false;const g=Core.grade(byId.get(id),h.answers);return g.correct<g.total}
function formatTime(s){s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
function meta(p){return esc(p.date||'材料未注明日期')+' · '+esc(p.source)+' · 本题库收录 '+frequencies.get(p.id)+' 次 · PDF '+p.pages.join('、')+' 页 · '+p.blanks.length+' 空 · <a href="原始题库.pdf#page='+p.pages[0]+'" target="_blank">查看原题</a>'}
function list(){
 const q=$('#search').value.toLowerCase(),f=$('#filter').value,progress=Core.groupProgress(bank,state.history);
 const matched=new Set(bank.filter(p=>(p.title+' '+p.date+' '+p.source).toLowerCase().includes(q)).map(p=>p.family||p.id));
 const rows=Core.unique(bank,state.order||'asc').filter(p=>matched.has(p.family||p.id)&&
 (f==='all'||(f==='completed'&&progress.has(p.family||p.id))||(f==='unfinished'&&!progress.has(p.family||p.id))||f===p.status||(f==='favorite'&&familyFavorite(p.id))||(f==='wrong'&&familyWrong(p,progress))));
 $('#bankCount').textContent=rows.length+' / '+families.size+' 篇';
 $('#list').innerHTML=rows.map(p=>{const record=progress.get(p.family||p.id),h=record?.latest,g=h&&Core.grade(byId.get(h.id),h.answers),ongoing=state.session?.ids.some(id=>familyKey(id)===(p.family||p.id)),count=record?.count||0;
 const badge=h?'<span class="progress completed">✓ 已完成</span>':ongoing?'<span class="progress ongoing">进行中</span>':'<span class="progress unstarted">未做</span>';
 return '<button class="item '+((p.family||p.id)===familyKey(selected)?'selected':'')+'" data-id="'+p.id+'"><strong>'+esc(p.title)+'</strong><div class="item-status">'+badge+'<span class="progress frequency">收录 '+frequencies.get(p.id)+' 次</span>'+(h&&ongoing?'<span class="progress ongoing">重练中</span>':'')+'</div><small>'+esc(p.date||'未注明日期')+' · '+p.blanks.length+' 空'+(g?' · 练习 '+count+' 次 · 最近 '+g.correct+'/'+g.total:'')+(familyFavorite(p.id)?' · ★':'')+'</small>'+(frequencies.get(p.id)>1?'<div class="family-progress">重复版本已合并 · 只刷一次</div>':'')+(p.status==='review'?'<br><em>待复核</em>':'')+'</button>'}).join('')||'<p class="empty">没有匹配文章。</p>';
 $('#list').querySelectorAll('button').forEach(b=>b.onclick=()=>{const p=byId.get(b.dataset.id),h=progress.get(p.family||p.id)?.latest;start([f==='wrong'&&h?h.id:p.id],f==='wrong'?'wrong':'daily')});
}
function setNav(){document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===view))}
function favorite(id){const key=familyKey(id);if(familyFavorite(id))state.favorites=state.favorites.filter(f=>familyKey(f)!==key);else state.favorites.push(id);save();list();const b=$('#favorite');if(b)b.textContent=familyFavorite(id)?'★ 已收藏':'☆ 收藏文章'}
function dashboard(){
 selected=null;setNav();list();
 const progress=Core.groupProgress(bank,state.history),unique=Core.unique(bank,state.order||'asc');
 const wrong=unique.filter(p=>familyWrong(p,progress)),ready=unique.filter(p=>p.status==='ready');
 $('#main').innerHTML='<div class="eyebrow">补全单词专项 · '+(view==='mock'?'限时训练':view==='wrong'?'错题重练':'日常练习')+'</div><h1>'+(view==='mock'?'给这一组练习设定时限':view==='wrong'?'在原文里，再练一次':'从一篇文章开始')+'</h1><p class="muted">点击左侧文章，只填写单词缺失的后半部分。提交后查看参考答案与完整原文。</p>'+
 '<div class="stats"><div class="stat"><b>'+families.size+'</b><span>去重文章</span></div><div class="stat"><b>'+ready.length+'</b><span>已校验可组卷</span></div><div class="stat"><b>'+wrong.length+'</b><span>待重练文章</span></div><div class="stat"><b>'+state.history.length+'</b><span>累计练习</span></div></div>'+
 (state.session?'<div class="card"><h2>有一组未完成的练习</h2><p>'+state.session.ids.length+' 篇 · '+(state.session.mode==='mock'?'专项限时训练':'日常练习')+'</p><button class="primary" id="resume">继续练习</button></div>':'')+
 (view==='mock'?'<section class="paper"><h2>补全单词专项限时训练</h2><p class="muted">仅使用全部校验通过的文章，避开相似内容。所有文章在交卷后统一判分。</p><div class="form"><label>文章篇数<input id="count" type="number" min="1" max="'+ready.length+'" value="3"></label><label>总时限（分钟）<input id="minutes" type="number" min="1" max="240" value="10"></label><button id="beginMock" class="primary">开始计时</button></div><p class="footer">这是补全单词专项训练，非完整托福阅读考试。计时开始后，离开或刷新页面不会暂停。</p></section>':
 view==='wrong'?'<section class="paper"><h2>'+wrong.length+' 篇待重练</h2><p>保留整篇上下文。历史成绩仍然保存，最近一次结果决定待重练状态。</p><button id="beginWrong" class="primary" '+(!wrong.length?'disabled':'')+'>重练第一篇错题</button></section>':
 '<div class="grid"><section class="card"><h2>高频优先刷题</h2><p>按本题库相似文章收录次数从高到低，相同文章只取一次，跳过已做文章。同频按日期由早到晚。</p><button id="highFrequency" class="primary">开始 / 继续高频刷题</button><p class="footer">'+bank.length+' 个原条目 · '+families.size+' 篇去重文章 · '+repeatedFamilies+' 组重复 · 最高 '+maxFrequency+' 次。次数仅代表本题库收录。</p></section><section class="card"><h2>按当前排序连续练习</h2><p>使用左侧选定排序，跳过已完成文章，逐篇提交和复盘。</p><button id="sequential" class="primary">开始 / 继续顺序</button></section><section class="card"><h2>随机选文</h2><p>从未做的已校验文章中随机挑选一篇，相同文章只出现一次。</p><button id="random">随机一篇</button></section><section class="card"><h2>我的收藏</h2><p>'+new Set(state.favorites.map(familyKey)).size+' 篇文章已收藏，随时回到原文。</p><button id="favorites">查看收藏</button></section></div>')+
 '<p class="footer">题库来自提供的 PDF · '+BANK.summary.review+' 篇待复核，异常空不参与自动判分 · <a href="校验报告.html" target="_blank">查看题库校验报告</a></p>';
 if($('#resume'))$('#resume').onclick=()=>{view=state.session.mode;exercise()};
 if($('#beginMock'))$('#beginMock').onclick=()=>{
  const n=Number($('#count').value),m=Number($('#minutes').value);
  if(!Number.isInteger(n)||n<1||n>ready.length||!Number.isFinite(m)||m<1||m>240)return notice('请输入有效篇数及 1—240 分钟的总时限。');
  const chosen=Core.select(bank,n);
  if(chosen.length<n)return notice('避开相似内容后最多可选 '+chosen.length+' 篇，请减少篇数。');
  start(chosen.map(p=>p.id),'mock',m);
 };
 if($('#beginWrong'))$('#beginWrong').onclick=()=>start([progress.get(wrong[0].family||wrong[0].id).latest.id],'wrong');
 if($('#highFrequency'))$('#highFrequency').onclick=()=>{state.order='frequency';$('#order').value='frequency';save();list();const next=Core.next(bank,state.history,'frequency');if(next)start([next.id],'daily');else notice('可自动判分的文章已全部完成。可以手选文章重练。')};
 if($('#sequential'))$('#sequential').onclick=()=>{const next=Core.next(bank,state.history,state.order||'asc');if(next)start([next.id],'daily');else notice('可自动判分的文章已全部完成。可以手选文章重练，或进入错题重练。')};
 if($('#random'))$('#random').onclick=()=>{const chosen=Core.select(bank.filter(p=>!progress.has(p.family||p.id)),1);if(chosen.length)start(chosen.map(p=>p.id),'daily');else notice('可自动判分的文章已全部完成。可以手选文章重练。')};
 if($('#favorites'))$('#favorites').onclick=()=>{$('#filter').value='favorite';list()};
}
function start(ids,mode,minutes){
 if(state.session){notice('请先继续并提交当前练习，或在答题页结束练习后重新选文。');view=state.session.mode;return exercise()}
 state.session={ids,index:0,answers:{},started:Date.now(),mode,...(mode==='mock'?{deadline:Date.now()+minutes*60000}: {})};
 result=null;view=mode;save();notice('');exercise();
}
function blankGuide(value,missing){
 return value?' '.repeat(Math.min(value.length,missing))+'_'.repeat(Math.max(0,missing-value.length)):'';
}
function passage(p,answers,review=false){
 let html='',cursor=0;
 p.blanks.forEach((b,i)=>{
  html+=esc(p.raw.slice(cursor,b.start)).replace(/\n/g,' ');
  if(review){const r=Core.grade(p,answers).rows[i];html+='<span class="word '+(!r.valid?'':r.correct?'filled':'badword')+'" title="'+esc(!r.valid?'待复核':'你的答案：'+r.full)+'">'+esc(b.answer||b.prefix+'_'.repeat(b.missing))+'</span>'}
  else if(b.issues.includes('internal_blank'))html+='<span class="word">'+esc(p.raw.slice(b.start,b.end))+' <span class="badge">待复核</span></span>';
  else html+='<span class="word">'+esc(b.prefix)+'<span class="blank-wrap"><input class="blank" placeholder="'+'_'.repeat(b.missing)+'" data-index="'+i+'" aria-label="第 '+(i+1)+' 空，已知 '+esc(b.prefix)+'，缺失 '+b.missing+' 个字母" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="'+b.missing+'" style="width:calc('+b.missing+'ch + '+(b.missing+4)+'px)" value="'+esc(answers[i]||'')+'"><span class="blank-guide" aria-hidden="true">'+esc(blankGuide(answers[i]||'',b.missing))+'</span></span></span>';
  cursor=b.end;
 });
 return html+esc(p.raw.slice(cursor)).replace(/\n/g,' ');
}
function exercise(){
 const s=state.session;if(!s)return dashboard();
 if(s.mode==='mock'&&Core.remaining(s)===0)return submit(true);
 const p=byId.get(s.ids[s.index]);selected=p.id;setNav();list();
 const answers=s.answers[p.id]||[];
 $('#main').innerHTML='<div class="topline"><span class="eyebrow">'+(s.mode==='mock'?'专项限时训练 · 第 '+(s.index+1)+' / '+s.ids.length+' 篇':s.mode==='wrong'?'错题重练':'日常练习')+'</span><span id="timer" class="timer"></span></div><div class="topline"><h1>'+esc(p.title)+'</h1><button id="favorite">'+(familyFavorite(p.id)?'★ 已收藏':'☆ 收藏文章')+'</button></div><div class="meta">'+meta(p)+'</div>'+
 (p.status==='review'?'<p class="warn">本篇包含原材料异常。你仍可练习，但异常空不会判分；提交后显示原 PDF 参考答案及复核原因。</p>':'')+
 '<section class="paper passage" id="passage">'+passage(p,answers)+'</section><div class="toolbar"><span id="filled" class="muted"></span><div>'+
 (s.mode==='mock'?'<button id="prev" '+(s.index===0?'disabled':'')+'>上一篇</button> <button id="next" '+(s.index===s.ids.length-1?'disabled':'')+'>下一篇</button> ':'')+
 '<button class="primary" id="submit">'+(s.mode==='mock'?'统一交卷':'提交本篇')+'</button></div></div><p class="footer">只填缺失字母 · Enter / Tab 下一空 · Shift+Enter 上一空 · 输入即时保存 · <button id="markSelection">★ 标记选中词</button> <button id="end">结束本次练习</button></p>';
 $('#favorite').onclick=()=>favorite(p.id);
 $('#passage').querySelectorAll('input').forEach(input=>{input.oninput=()=>{
  const i=Number(input.dataset.index);
  input.value=input.value.replace(/[^A-Za-z]/g,'').slice(0,p.blanks[i].missing);
  input.nextElementSibling.textContent=blankGuide(input.value,p.blanks[i].missing);
  if(!s.answers[p.id])s.answers[p.id]=Array(p.blanks.length).fill('');
  s.answers[p.id][i]=input.value;save();filled();
 };input.onkeydown=e=>{
  if(e.key!=='Enter'||e.isComposing||e.repeat)return;
  e.preventDefault();
  const inputs=[...$('#passage').querySelectorAll('input')],index=inputs.indexOf(input),next=inputs[index+(e.shiftKey?-1:1)];
  if(next)next.focus();else if(!e.shiftKey)($('#next')&&!$('#next').disabled?$('#next'):$('#submit')).focus();
 };
 });
 $('#markSelection').onclick=()=>{
  const selection=window.getSelection();
  if(!selection||!$('#passage').contains(selection.anchorNode)||!$('#passage').contains(selection.focusNode))return notice('先在文章中选中一个已显示的英文单词，再点击标记。');
  addImportant(selection.toString().trim(),p.id,null);
 };
 $('#submit').onclick=()=>{if(s.mode==='mock'&&!confirm('交卷后将统一显示成绩，不能继续修改。确定交卷？'))return;submit()};
 $('#end').onclick=()=>{if(confirm('结束会删除本次未提交的输入，已提交记录保留。确定结束？')){state.session=null;save();dashboard()}};
 if($('#prev'))$('#prev').onclick=()=>{s.index--;save();exercise()};
 if($('#next'))$('#next').onclick=()=>{s.index++;save();exercise()};
 filled();tick();
}
function filled(){const s=state.session,p=byId.get(s.ids[s.index]),a=s.answers[p.id]||[];const blocked=p.blanks.filter(b=>b.issues.includes('internal_blank')).length;$('#filled').textContent='已填 '+a.filter(x=>x.trim()).length+' / '+(p.blanks.length-blocked)+' 可填写空'+(blocked?' · '+blocked+' 空待复核':'')+' · 自动保存'}
function tick(){
 const s=state.session;if(!s)return;
 if(s.mode==='mock'&&Core.remaining(s)===0){submit(true);return}
 if($('#timer'))$('#timer').textContent=s.mode==='mock'?'剩余 '+formatTime(Core.remaining(s)):'用时 '+formatTime((Date.now()-s.started)/1000);
}
function submit(auto=false){
 const s=state.session;if(!s)return;
 const now=Date.now(),ended=s.mode==='mock'?Math.min(now,s.deadline):now,batch='run-'+now;
 const records=s.ids.map(id=>({id,answers:s.answers[id]||[],elapsed:Math.max(0,(ended-s.started)/1000),at:now,batch,mode:s.mode}));
 state.history.push(...records);state.session=null;save();result=records;
 if(auto)notice('时限已到，所有文章已自动交卷。');
 showResult(records);
}
function showResult(records){
 result=records;selected=records[0].id;list();
 const scores=records.map(h=>Core.grade(byId.get(h.id),h.answers)),correct=scores.reduce((a,g)=>a+g.correct,0),total=scores.reduce((a,g)=>a+g.total,0);
 $('#main').innerHTML='<div class="eyebrow">练习复盘 · '+records.length+' 篇</div><h1>'+(total?Math.round(correct/total*100)+'% 正确率':'本次没有可自动判分的空')+'</h1><div class="stats"><div class="stat"><b>'+correct+' / '+total+'</b><span>答对 / 可判分空</span></div><div class="stat"><b>'+formatTime(records[0].elapsed)+'</b><span>本组用时</span></div><div class="stat"><b>'+scores.reduce((a,g)=>a+g.rows.filter(r=>!r.valid).length,0)+'</b><span>待复核空 · 未计分</span></div></div><button class="primary" id="continue">继续练习</button> <button id="retry">重做本组</button> <button id="reviewWords">综合复习</button>'+
 records.map((h,hi)=>{const p=byId.get(h.id),g=scores[hi];return '<section class="paper"><div class="topline"><h2>'+esc(p.title)+'</h2><button data-fav="'+p.id+'">'+(familyFavorite(p.id)?'★ 已收藏':'☆ 收藏')+'</button></div><div class="meta">'+meta(p)+' · 答案 PDF '+p.answerPages.join('、')+' 页</div><div class="scroll"><table><thead><tr><th>空 / 编号</th><th>你的补全 → 整词</th><th>PDF 参考答案</th><th>结果</th><th>重点词</th></tr></thead><tbody>'+g.rows.map((r,i)=>'<tr><td>'+(i+1)+' / '+esc(p.blanks[i].label)+'</td><td>'+esc(r.input||'未填')+' → '+esc(r.full)+'</td><td>'+esc(r.answer)+'</td><td class="'+(!r.valid?'muted':r.correct?'good':'bad')+'">'+(!r.valid?'待复核：'+esc(p.blanks[i].issues.join(' / ')):r.correct?'✓ 正确':'✕ 错误')+'</td><td>'+(r.valid?importantButton(r.answer,p.id,i):'—')+'</td></tr>').join('')+'</tbody></table></div><details open><summary>填回答案后的完整文章</summary><div class="passage">'+passage(p,h.answers,true)+'</div></details>'+(p.status==='review'?'<details><summary>原始材料与全部参考答案</summary><pre style="white-space:pre-wrap">'+esc(p.raw)+'\n\n'+esc(p.originalAnswers.map(a=>a.label+' → '+a.answer).join('\n'))+'</pre></details>':'')+'</section>'}).join('');
 $('[id=continue]').onclick=()=>{if(records.length===1){const next=Core.next(bank,state.history,state.order||'asc',records[0].id);if(next)start([next.id],'daily');else{view='daily';dashboard();notice('可自动判分的文章已全部完成。可以手选文章重练，或进入错题重练。')}}else{view='mock';dashboard()}};
 $('#reviewWords').onclick=()=>{view='words';wordReview()};
 bindImportant();
 $('#retry').onclick=()=>start(records.map(h=>h.id),records.length>1?'mock':'daily',records.length>1?Math.max(1,Math.ceil(records[0].elapsed/60)):undefined);
 document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=()=>{favorite(b.dataset.fav);b.textContent=familyFavorite(b.dataset.fav)?'★ 已收藏':'☆ 收藏'});
}
function history(){
 selected=null;list();setNav();
 const progress=Core.groupProgress(bank,state.history);
 const grouped=new Map();for(const h of [...state.history].reverse()){if(!grouped.has(h.batch))grouped.set(h.batch,[]);grouped.get(h.batch).unshift(h)}
 $('#main').innerHTML='<div class="eyebrow">练习记录</div><h1>每一次练习都有记录</h1><p class="muted">选择一组查看复盘。每篇的练习次数、最近成绩、错题和收藏状态见下表。</p>'+
 '<section class="paper"><h2>历次练习</h2>'+([...grouped].map(([id,hs])=>{const gs=hs.map(h=>Core.grade(byId.get(h.id),h.answers));return '<p><button data-batch="'+esc(id)+'">'+esc(new Date(hs[0].at).toLocaleString())+' · '+hs.length+' 篇 · '+gs.reduce((a,g)=>a+g.correct,0)+' / '+gs.reduce((a,g)=>a+g.total,0)+'</button></p>'}).join('')||'<p class="empty">还没有提交记录。从左侧选一篇开始。</p>')+'</section>'+
 '<section class="paper scroll"><table><thead><tr><th>文章</th><th>次数</th><th>最近成绩</th><th>状态</th></tr></thead><tbody>'+Core.unique(bank,state.order||'asc').filter(p=>progress.has(p.family||p.id)||familyFavorite(p.id)).map(p=>{const record=progress.get(p.family||p.id),h=record?.latest,g=h&&Core.grade(byId.get(h.id),h.answers);return '<tr><td>'+esc(p.title)+'</td><td>'+(record?.count||0)+'</td><td>'+(g?g.correct+'/'+g.total:'未练习')+'</td><td>'+(familyWrong(p,progress)?'待重练 ':'')+(familyFavorite(p.id)?'★ 收藏':'')+'</td></tr>'}).join('')+'</tbody></table></section>';
 document.querySelectorAll('[data-batch]').forEach(b=>b.onclick=()=>showResult(grouped.get(b.dataset.batch)));
}

function important(word){return (state.importantWords||[]).some(w=>w.word.toLowerCase()===word.toLowerCase())}
function importantButton(word,id=null,index=null){
 return '<button data-important-word="'+esc(word)+'" data-source="'+(id||'')+'" data-blank="'+(index===null?'':index)+'">'+(important(word)?'★ 重点词':'☆ 标记重点')+'</button>';
}
function toggleImportant(word,id=null,index=null){
 try{state.importantWords=Core.toggleImportant(state.importantWords||[],word,Date.now(),id,index);save();return true}catch(e){notice(e.message);return false}
}
function addImportant(word,id=null,index=null){
 if(important(word))return notice(word+' 已在重点词中。');
 if(toggleImportant(word,id,index))notice('已添加重点词：'+word);
}
function bindImportant(after){
 document.querySelectorAll('[data-important-word]').forEach(b=>b.onclick=()=>{
  if(toggleImportant(b.dataset.importantWord,b.dataset.source||null,b.dataset.blank===''?null:Number(b.dataset.blank))){
   document.querySelectorAll('[data-important-word]').forEach(x=>x.textContent=important(x.dataset.importantWord)?'★ 重点词':'☆ 标记重点');
   if(after)after();
  }
 });
}
function wordReview(){
 result=null;selected=null;view='words';setNav();list();
 const collect=()=>{
  const map=new Map(Core.reviewWords(bank,state.history).map(w=>[w.word.toLowerCase(),w]));
  for(const marker of state.importantWords||[]){
   const key=marker.word.toLowerCase();
   if(!map.has(key))map.set(key,{word:marker.word,locations:[],wrongCount:0,pending:false,lastWrongAt:0});
   map.get(key).marker=marker;
  }
  return [...map.values()].sort((a,b)=>(b.lastWrongAt||b.marker?.at||0)-(a.lastWrongAt||a.marker?.at||0));
 };
 const all=collect();
 $('#main').innerHTML='<div class="eyebrow">综合复习 · 错词与重点词</div><h1>把需要再记一次的词放在一起</h1><p class="muted">错词从提交记录自动归集，重点词由你自主标记。重练答对后保留历史；重点标记需手动取消。</p><div class="stats"><div class="stat"><b>'+all.length+'</b><span>去重后的单词</span></div><div class="stat"><b>'+all.filter(w=>w.pending).length+'</b><span>待复习错词</span></div><div class="stat"><b>'+(state.importantWords||[]).length+'</b><span>自主标记重点词</span></div></div><section class="card review-controls"><div class="form"><label>手动添加重点词<input id="addWord" placeholder="例如 sustainability" autocomplete="off" spellcheck="false"></label><button id="addImportant">添加重点词</button></div><div class="review-filters"><input id="wordSearch" aria-label="搜索复习词" placeholder="搜索单词或文章标题"><select id="reviewKind" aria-label="复习类别"><option value="all">错词 + 重点词</option><option value="wrong">仅错词</option><option value="important">仅重点词</option></select><select id="reviewStatus" aria-label="复习状态"><option value="pending">待复习</option><option value="all">全部（含已答对）</option><option value="resolved">已答对的错词</option></select></div></section><p id="reviewCount" class="meta"></p><div id="reviewList"></div>';
 const draw=()=>{
  const q=$('#wordSearch').value.trim().toLowerCase(),kind=$('#reviewKind').value,status=$('#reviewStatus').value;
  const collected=collect(),counts=$('#main .stats').querySelectorAll('.stat b');
  counts[0].textContent=collected.length;counts[1].textContent=collected.filter(w=>w.pending).length;counts[2].textContent=(state.importantWords||[]).length;
  const words=collected.filter(w=>{
   if(kind==='wrong'&&!w.wrongCount||kind==='important'&&!w.marker)return false;
   if(status==='pending'&&!w.pending&&!(w.marker&&kind!=='wrong')||status==='resolved'&&(!w.wrongCount||w.pending))return false;
   return !q||(w.word+' '+w.locations.map(l=>byId.get(l.id).title).join(' ')+' '+(w.marker?.sourceId?byId.get(w.marker.sourceId).title:'')).toLowerCase().includes(q);
  });
  $('#reviewCount').textContent='当前显示 '+words.length+' 个词';
  $('#reviewList').innerHTML=words.map(w=>{
   const marker=w.marker;
   const occurrences=w.locations.map(l=>{
    const p=byId.get(l.id),blank=p.blanks[l.index],c=Core.wordContext(p,l.index);
    return '<div class="review-occurrence"><div class="topline"><span class="badge">'+(l.pending?'待复习':'✓ 最近已答对')+'</span><span class="meta">错误 '+l.wrongCount+' 次'+(l.missingCount?' · 其中未填 '+l.missingCount+' 次':'')+'</span></div><p class="review-answer">最近错答：<b class="bad">'+esc(l.input?blank.prefix+l.input:'未填')+'</b> · 参考：<b>'+esc(blank.answer)+'</b> · 应填后缀：<code>'+esc(blank.suffix)+'</code></p><p class="review-context" lang="en">'+esc(c.before)+'<mark>'+esc(c.word)+'</mark>'+esc(c.after)+'</p><div class="topline"><span class="meta">'+esc(p.title)+' · '+meta(p)+'</span><button data-retrain="'+p.id+'">回到原文重练</button></div></div>';
   }).join('');
   let source='';
   if(marker?.sourceId&&!w.locations.some(l=>l.id===marker.sourceId&&l.index===marker.index)){
    const p=byId.get(marker.sourceId);
    const c=marker.index!==null?Core.wordContext(p,marker.index):null;
    source='<div class="review-occurrence"><p class="meta">重点词标记来源：'+esc(p.title)+'</p>'+(c?'<p class="review-context">'+esc(c.before)+'<mark>'+esc(c.word)+'</mark>'+esc(c.after)+'</p>':'')+'<button data-retrain="'+p.id+'">回到原文</button></div>';
   }
   return '<article class="paper review-word" data-word="'+esc(w.word)+'"><div class="topline"><h2>'+esc(w.word)+' <span class="badge">'+(w.wrongCount?'错词 · '+w.wrongCount+' 次':'自主重点词')+'</span></h2>'+importantButton(w.word,marker?.sourceId||null,marker?.index??null)+'</div>'+occurrences+source+(!w.locations.length&&!source?'<p class="muted">手动添加的重点词。</p>':'')+'</article>';
  }).join('')||'<section class="paper empty">当前没有匹配的复习词。提交练习后错词会自动出现，也可以在上方手动添加重点词。</section>';
  bindImportant(draw);
  document.querySelectorAll('[data-retrain]').forEach(b=>b.onclick=()=>start([b.dataset.retrain],'wrong'));
 };
 $('#wordSearch').oninput=draw;$('#reviewKind').onchange=draw;$('#reviewStatus').onchange=draw;
 $('#addImportant').onclick=()=>{const value=$('#addWord').value.trim();addImportant(value);if(important(value)){$('#addWord').value='';draw()}};
 $('#addWord').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('#addImportant').click()}};
 draw();
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{view=b.dataset.mode;if(view==='history')history();else if(view==='words')wordReview();else dashboard()});
$('#search').oninput=list;$('#filter').onchange=list;
$('#order').onchange=()=>{state.order=$('#order').value;save();list()};
$('#home').onclick=e=>{e.preventDefault();view='daily';dashboard()};
$('#backup').onclick=()=>{
 const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='补全单词记录-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('备份已导出，包含历史、收藏和未完成练习。');
};
$('#restore').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;
 try{if(file.size>20000000)throw Error('备份文件过大');const imported=Core.validateBackup(JSON.parse(await file.text()),bank);if(!confirm('备份有效：'+imported.history.length+' 条记录。恢复将替换当前历史、收藏及未完成练习。建议先导出当前记录。确定恢复？'))return;state=imported;$('#order').value=state.order||'asc';save();view=state.session?.mode||'daily';notice('备份已恢复。');if(state.session)exercise();else dashboard()}catch(err){notice(err.message||'无法恢复备份，现有记录未更改。')}finally{e.target.value=''}
};
$('#order').value=state.order||'asc';
setInterval(tick,1000);
if(state.session){view=state.session.mode;exercise()}else dashboard();
