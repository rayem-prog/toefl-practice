(function(root){
const norm=s=>String(s||'').trim().toLowerCase();
const C={
 toggleImportant(words,word,at,sourceId=null,index=null){
  if(!/^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/.test(word)||word.length>60)throw Error('请选择或输入一个英文单词');
  if(words.some(w=>norm(w.word)===norm(word)))return words.filter(w=>norm(w.word)!==norm(word));
  return [...words,{word,at,sourceId,index}];
 },
 reviewWords(bank,history){
  const passages=new Map(bank.map(p=>[p.id,p])),locations=new Map();
  for(const h of history){
   const p=passages.get(h.id);if(!p)continue;
   for(const r of C.grade(p,h.answers).rows){
    if(!r.valid)continue;
    const key=p.id+':'+r.index;let item=locations.get(key);
    if(!item){item={id:p.id,index:r.index,word:r.answer,input:'',wrongCount:0,missingCount:0,lastWrongAt:0,pending:false};locations.set(key,item)}
    item.pending=!r.correct;
    if(!r.correct){item.wrongCount++;if(!r.input.trim())item.missingCount++;item.input=r.input;item.lastWrongAt=h.at}
   }
  }
  const words=new Map();
  for(const loc of locations.values()){
   if(!loc.wrongCount)continue;
   const key=norm(loc.word);let word=words.get(key);
   if(!word){word={word:loc.word,locations:[],wrongCount:0,lastWrongAt:0,pending:false};words.set(key,word)}
   word.locations.push(loc);word.wrongCount+=loc.wrongCount;word.lastWrongAt=Math.max(word.lastWrongAt,loc.lastWrongAt);word.pending=word.pending||loc.pending;
  }
  return [...words.values()].sort((a,b)=>b.lastWrongAt-a.lastWrongAt);
 },
 wordContext(p,index){
  let text='',cursor=0,start=0,end=0;
  p.blanks.forEach((b,i)=>{
   text+=p.raw.slice(cursor,b.start);
   if(i===index)start=text.length;
   text+=b.answer||b.prefix+'_'.repeat(b.missing);
   if(i===index)end=text.length;
   cursor=b.end;
  });
  text+=p.raw.slice(cursor);
  const before=text.slice(0,start),after=text.slice(end);
  const left=Math.max(before.lastIndexOf('.'),before.lastIndexOf('?'),before.lastIndexOf('!'))+1;
  const right=after.search(/[.!?]/);
  return {before:before.slice(left).replace(/\s+/g,' ').trimStart(),word:text.slice(start,end),after:after.slice(0,right<0?undefined:right+1).replace(/\s+/g,' ')};
 },
 frequencies(bank){
  const groups=new Map();
  for(const p of bank){const key=p.family||p.id;groups.set(key,(groups.get(key)||0)+1)}
  return new Map(bank.map(p=>[p.id,groups.get(p.family||p.id)]));
 },
 unique(bank,order='asc'){
  const ordered=C.order(bank,order),chosen=new Map();
  for(const p of ordered){const key=p.family||p.id,prev=chosen.get(key);if(!prev||(prev.status!=='ready'&&p.status==='ready'))chosen.set(key,p)}
  return ordered.filter(p=>chosen.get(p.family||p.id).id===p.id);
 },
 groupProgress(bank,history){
  const byId=new Map(bank.map(p=>[p.id,p])),groups=new Map();
  for(const h of history){const p=byId.get(h.id);if(!p)continue;const key=p.family||p.id,prev=groups.get(key);groups.set(key,{count:(prev?.count||0)+1,latest:h})}
  return groups;
 },
 order(bank,order='asc'){
  if(order==='original')return [...bank];
  const counts=order==='frequency'?C.frequencies(bank):null;
  return [...bank].sort((a,b)=>{
   if(counts&&counts.get(a.id)!==counts.get(b.id))return counts.get(b.id)-counts.get(a.id);
   if(!a.date)return b.date?1:0;
   if(!b.date)return -1;
   return a.date.localeCompare(b.date)*(order==='desc'?-1:1);
  });
 },
 next(bank,history,order='asc',current=null){
  const ordered=C.unique(bank,order),done=C.groupProgress(bank,history),currentPassage=bank.find(p=>p.id===current);
  const eligible=p=>p.status==='ready'&&!done.has(p.family||p.id);
  const index=ordered.findIndex(p=>currentPassage&&(p.family||p.id)===(currentPassage.family||currentPassage.id));
  return ordered.slice(index+1).find(eligible)||ordered.find(eligible)||null;
 },
 grade(p,answers=[]){const rows=p.blanks.map((b,i)=>({index:i,input:answers[i]||'',full:b.prefix+(answers[i]||''),answer:b.answer,valid:!b.issues.length,correct:!b.issues.length&&norm(answers[i])===norm(b.suffix)}));return {rows,correct:rows.filter(r=>r.correct).length,total:rows.filter(r=>r.valid).length}},
 select(bank,n){const seen=new Set();return [...bank].sort(()=>Math.random()-.5).filter(p=>p.status==='ready'&&!seen.has(p.family)&&seen.add(p.family)).slice(0,n)},
 remaining(s,now=Date.now()){return Math.max(0,Math.ceil((s.deadline-now)/1000))},
 validateBackup(d,bank){
 const ids=new Map(bank.map(p=>[p.id,p])), fail=()=>{throw Error('备份格式或题目数据不匹配，现有记录未更改')};
 const strings=a=>Array.isArray(a)&&a.every(x=>typeof x==='string');
 const answers=(id,a)=>ids.has(id)&&strings(a)&&a.length<=ids.get(id).blanks.length&&a.every(x=>x.length<100);
 if(d?.importantWords!==undefined){
  if(!Array.isArray(d.importantWords))fail();
  const seen=new Set();
  for(const w of d.importantWords){
   if(!w||typeof w.word!=='string'||w.word.length>60||!/^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/.test(w.word)||!Number.isFinite(w.at)||seen.has(norm(w.word)))fail();
   seen.add(norm(w.word));
   if(w.sourceId!==null&&!ids.has(w.sourceId))fail();
   if(w.index!==null&&(!Number.isInteger(w.index)||w.index<0||w.sourceId===null||w.index>=ids.get(w.sourceId).blanks.length))fail();
  }
 }
 if(d&&d.order!==undefined&&!['asc','desc','original','frequency'].includes(d.order))fail();
 if(!d||d.version!==1||!Array.isArray(d.history)||!strings(d.favorites)||!d.favorites.every(id=>ids.has(id)))fail();
 for(const h of d.history)if(!h||!answers(h.id,h.answers)||!Number.isFinite(h.elapsed)||h.elapsed<0||!Number.isFinite(h.at)||typeof h.batch!=='string')fail();
 if(d.session){const s=d.session;if(!strings(s.ids)||!s.ids.length||!s.ids.every(id=>ids.has(id))||!Number.isInteger(s.index)||s.index<0||s.index>=s.ids.length||!['daily','mock','wrong'].includes(s.mode)||!Number.isFinite(s.started)||!s.answers||typeof s.answers!=='object'||Array.isArray(s.answers))fail();for(const [id,a]of Object.entries(s.answers))if(!s.ids.includes(id)||!answers(id,a))fail();if(s.mode==='mock'&&(!Number.isFinite(s.deadline)||s.deadline<=s.started||s.ids.some(id=>ids.get(id).status!=='ready')))fail()}
 return JSON.parse(JSON.stringify(d));
 }
};
if(typeof module!=='undefined')module.exports=C;else root.Core=C
})(globalThis);
