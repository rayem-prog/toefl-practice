const test=require('node:test'),assert=require('node:assert/strict'),C=require('../../reading/core.js');
const bank=[
 {id:'single',family:'s',date:'2026-01-01',status:'ready',blanks:[]},
 {id:'a2',family:'a',date:'2026-03-01',status:'ready',blanks:[]},
 {id:'b1',family:'b',date:'2026-02-01',status:'ready',blanks:[]},
 {id:'a1',family:'a',date:'2026-01-20',status:'ready',blanks:[]},
 {id:'a3',family:'a',date:null,status:'review',blanks:[]},
 {id:'b2',family:'b',date:'2026-02-01',status:'ready',blanks:[]},
 {id:'unassigned1',date:null,status:'ready',blanks:[]},
 {id:'unassigned2',date:null,status:'ready',blanks:[]}
];
test('frequency counts families across original entries and treats missing family independently',()=>{
 const counts=C.frequencies(bank);assert.equal(counts.get('a1'),3);assert.equal(counts.get('b2'),2);assert.equal(counts.get('single'),1);assert.equal(counts.get('unassigned1'),1);
});
test('frequency order is descending, with chronological stable ties and unknown dates last',()=>{
 assert.deepEqual(C.order(bank,'frequency').map(p=>p.id),['a1','a2','a3','b1','b2','single','unassigned1','unassigned2']);
 assert.equal(bank[0].id,'single');
 assert.equal(C.next(bank,[{id:'a1'}],'frequency').id,'b1');
 assert.equal(C.next(bank,[{id:'a1'},{id:'a2'}],'frequency','a2').id,'b1');
});
test('frequency preference and completed history round-trip without marking siblings completed',()=>{
 const data={version:1,order:'frequency',history:[{id:'a1',answers:[],elapsed:1,at:1,batch:'x'}],favorites:[],session:null};
 assert.deepEqual(C.validateBackup(data,bank),data);
 assert.equal(C.validateBackup({version:1,history:[],favorites:[],session:null},bank).history.length,0);
});
