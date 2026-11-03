const test=require('node:test'),assert=require('node:assert/strict'),C=require('../../reading/core.js');
const bank=[
 {id:'a-review',family:'a',date:'2026-01-01',status:'review',blanks:[]},
 {id:'a-old',family:'a',date:'2026-02-01',status:'ready',blanks:[]},
 {id:'a-new',family:'a',date:'2026-03-01',status:'ready',blanks:[]},
 {id:'b',family:'b',date:'2026-01-20',status:'ready',blanks:[]},
 {id:'c',family:'c',date:'2026-01-21',status:'ready',blanks:[]}
];
test('unique directory retains one ready version per family and full-bank frequency',()=>{
 assert.deepEqual(C.unique(bank,'frequency').map(p=>p.id),['a-old','b','c']);
 assert.equal(C.frequencies(bank).get('a-old'),3);
 assert.deepEqual(C.unique(bank,'desc').map(p=>p.id),['a-new','c','b']);
 assert.equal(bank.length,5);
});
test('continuous practice skips the entire family if any original version was completed',()=>{
 assert.equal(C.next(bank,[{id:'a-new'}],'frequency').id,'b');
 assert.equal(C.next(bank,[],'frequency','a-new').id,'b');
 assert.equal(C.next(bank,[{id:'a-new'},{id:'b'},{id:'c'}],'frequency'),null);
});
test('group progress aggregates originals without rewriting or losing old records',()=>{
 const history=[{id:'a-new',at:1,answers:['x']},{id:'b',at:2,answers:[]},{id:'a-old',at:3,answers:['y']}];
 const saved=JSON.stringify(history),progress=C.groupProgress(bank,history);
 assert.equal(progress.get('a').count,2);assert.equal(progress.get('a').latest.id,'a-old');
 assert.equal(progress.get('b').count,1);assert.equal(JSON.stringify(history),saved);
});
