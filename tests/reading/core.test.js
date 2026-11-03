const test=require('node:test'),assert=require('node:assert/strict'),C=require('../../reading/core.js');
const bank=[{id:'a',family:'f',status:'ready',blanks:[{prefix:'Comp',suffix:'osers',answer:'Composers',missing:5,issues:[]},{prefix:'in',answer:'in fact',missing:4,issues:['phrase']}]},{id:'b',family:'f',status:'ready',blanks:[]},{id:'c',family:'g',status:'ready',blanks:[]}];
test('suffix only and quarantine',()=>{const r=C.grade(bank[0],[' OSERS ','fact']);assert.equal(r.correct,1);assert.equal(r.total,1);assert.equal(C.grade(bank[0],['Composers']).correct,0)});
test('random selection avoids families',()=>assert.equal(new Set(C.select(bank,3).map(p=>p.family)).size,2));
test('deadline is stable across reload',()=>assert.equal(C.remaining({deadline:10000},11000),0));
test('backup rejects unknown IDs without mutation',()=>assert.throws(()=>C.validateBackup({version:1,history:[],favorites:['unknown'],session:null},bank)));
test('backup rejects malformed answers',()=>assert.throws(()=>C.validateBackup({version:1,history:[],favorites:[],session:{ids:['a'],index:0,answers:{a:42},started:1,mode:'daily'}},bank)));
const dated=[
 {id:'late',date:'2026-09-13',status:'ready'},
 {id:'same1',date:'2026-01-21',status:'ready'},
 {id:'same2',date:'2026-01-21',status:'ready'},
 {id:'unknown',date:null,status:'ready'},
 {id:'review',date:'2026-01-20',status:'review'}
];
test('date order is stable, unknown last, input unmutated',()=>{
 assert.deepEqual(C.order(dated,'asc').map(p=>p.id),['review','same1','same2','late','unknown']);
 assert.deepEqual(C.order(dated,'desc').map(p=>p.id),['late','same1','same2','review','unknown']);
 assert.equal(dated[0].id,'late');
});
test('next practice skips submitted and review passages; all done returns null',()=>{
 assert.equal(C.next(dated,[{id:'same1'}],'asc').id,'same2');
 assert.equal(C.next(dated,[{id:'same1'},{id:'same2'}],'desc','late').id,'unknown');
 assert.equal(C.next(dated,dated.map(p=>({id:p.id})),'asc'),null);
});
test('backup accepts old format and remembers order, rejects invalid order',()=>{
 const data={version:1,history:[],favorites:[],session:null};
 assert.equal(C.validateBackup(data,bank).version,1);
 assert.equal(C.validateBackup({...data,order:'desc'},bank).order,'desc');
 assert.throws(()=>C.validateBackup({...data,order:'nonsense'},bank));
});
const reviewBank=[
 {id:'one',title:'First',raw:'People sing _ _ and learn a _ _.',blanks:[{prefix:'sing',missing:2,start:7,end:15,answer:'singer',suffix:'er',issues:[]},{prefix:'a',missing:2,start:26,end:31,answer:'and',suffix:'nd',issues:[]}]},
 {id:'two',title:'Second',raw:'A sing _ _ appears.',blanks:[{prefix:'sing',missing:2,start:2,end:10,answer:'Singer',suffix:'er',issues:[]},{prefix:'x',missing:1,start:0,end:1,answer:'xy',suffix:'y',issues:['internal_blank']}]}
];
test('review merges same words, keeps occurrences, excludes uncertain blanks',()=>{
 const words=C.reviewWords(reviewBank,[{id:'one',answers:['ar','nd'],at:1},{id:'two',answers:['',''],at:2}]);
 assert.equal(words.length,1);assert.equal(words[0].wrongCount,2);assert.equal(words[0].locations.length,2);assert.equal(words[0].pending,true);
 assert.equal(words[0].locations.find(x=>x.id==='two').input,'');
});
test('correct retry archives that occurrence without deleting error history',()=>{
 const history=[{id:'one',answers:['ar','nd'],at:1},{id:'one',answers:['ER','nd'],at:2}];
 const w=C.reviewWords(reviewBank,history)[0];assert.equal(w.pending,false);assert.equal(w.wrongCount,1);assert.equal(w.locations[0].input,'ar');
});
test('context fills neighboring blanks and highlights only selected word',()=>{
 const p={raw:'First sentence. The Comp _ _ _ _ _ used wo _ _. Final sentence.',blanks:[{prefix:'Comp',start:20,end:34,answer:'Composers'},{prefix:'wo',start:40,end:46,answer:'work'}]};
 const c=C.wordContext(p,0);assert.equal(c.word,'Composers');assert.equal(c.before,'The ');assert.equal(c.after,' used work.');
});
test('important words toggle by case-insensitive word without changing original list',()=>{
 const original=[],marked=C.toggleImportant(original,'Singer',10,'one',0);
 assert.equal(original.length,0);assert.equal(marked[0].word,'Singer');
 assert.equal(C.toggleImportant(marked,'singer',11,'two',0).length,0);
});
test('important words round-trip in backups and invalid markers are rejected',()=>{
 const data={version:1,history:[],favorites:[],session:null,importantWords:[{word:'Composers',at:1,sourceId:'a',index:0}]};
 assert.deepEqual(C.validateBackup(data,bank).importantWords,data.importantWords);
 assert.throws(()=>C.validateBackup({...data,importantWords:[{word:'test',at:1,sourceId:'unknown',index:0}]},bank));
 assert.throws(()=>C.validateBackup({...data,importantWords:[{word:'<script>',at:1,sourceId:null,index:null}]},bank));
});
