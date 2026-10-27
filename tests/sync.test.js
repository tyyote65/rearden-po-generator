// node tests/sync.test.js — tests the POSYNC merge logic against a MOCK shared file (no OneDrive).
const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/../index.html','utf8').split('/*POSYNC-BEGIN')[1].split('/*POSYNC-END*/')[0];
const POSYNC=new Function('return (function(){/*'+src+'; return POSYNC})()')();
// mock OneDrive file with eTag semantics
const file={etag:1,J:{next:1,issued:[]}};
const io=(delay=0)=>({meta:async()=>file.etag,read:async()=>JSON.parse(JSON.stringify(file.J)),
 write:async(J,et)=>{await new Promise(r=>setTimeout(r,delay));if(et!==file.etag)return 412;file.J=JSON.parse(JSON.stringify(J));file.etag++;return 200}});
const nos=()=>Promise.resolve();
async function issue(dev,meta){return POSYNC.sharedUpdate(io(Math.random()*5),J=>{const n=J.next||1;const code='RR-GEN-P00-R-HD-'+String(n).padStart(5,'0');J.next=n+1;J.issued.push(Object.assign({code,at:new Date().toISOString()},meta));dev.last=code;return true},5).then(r=>{dev.issued.push(POSYNC.toLocal(r.J.issued.find(x=>x.code==dev.last)));return dev.last})}
const sync=async dev=>{const r=await POSYNC.sharedUpdate(io(),J=>POSYNC.pushLocal(J,dev.issued),8,nos);POSYNC.mergeShared(dev.issued,r.J.issued)};
const view=dev=>JSON.stringify(dev.issued.map(r=>[r.code,r.status||'issued']).sort());
(async()=>{let pass=0;const t=(n,f)=>{f();console.log('PASS',n);pass++};
const A={issued:[]},B={issued:[]};
// seed: shared file holds 9 POs (like 00001-00009); A has them locally, B (phone) has nothing
for(let i=0;i<9;i++)await issue(A,{vendor:'V'+i});
// A also has an old signed-out L#### code and a local-only signed-in PO missing from shared
A.issued.push({code:'RR-GEN-P00-C-AM-L0001',vendor:'x',issuedAt:'2026-01-01'});
A.issued.push({code:'RR-GEN-P00-C-AM-00050',vendor:'orphan',issuedAt:'2026-01-02',shared:true});
await issue(B,{vendor:'Home Depot'});
t('phone initially sees only its own PO',()=>assert.equal(B.issued.length,1));
await sync(B);await sync(A);await sync(B);
t('A and B converge',()=>assert.equal(view(A).replace(/,\["RR-GEN-P00-C-AM-L0001","issued"\]/,''),view(B)));
t('L#### never pushed',()=>assert(!file.J.issued.some(x=>/L\d{4}$/.test(x.code))));
t('orphan pushed, next bumped past it (no reuse)',()=>{assert(file.J.issued.some(x=>x.code.endsWith('00050')));assert.equal(file.J.next,51)});
t('B shows 11 POs',()=>assert.equal(B.issued.length,11));
// conflicting void: A voids 00003 locally (offline), B's copy says issued, shared says issued
Object.assign(A.issued.find(x=>x.code.endsWith('00003')),{status:'void',voidedAt:'2026-10-27T10:00:00Z',voidNote:'dup'});
// B gets a stale "issued" pull: void must survive
await sync(B);await sync(A);await sync(B);
t('void wins everywhere and is final',()=>{for(const d of[A,B])assert.equal(d.issued.find(x=>x.code.endsWith('00003')).status,'void');assert.equal(file.J.issued.find(x=>x.code.endsWith('00003')).status,'void')});
// shared copy loses void? (simulate stale shared) -> local void still kept and re-pushed
file.J.issued.find(x=>x.code.endsWith('00003')).status=undefined;file.etag++;
await sync(B);t('stale un-void in shared cannot undo void',()=>{assert.equal(B.issued.find(x=>x.code.endsWith('00003')).status,'void');assert.equal(file.J.issued.find(x=>x.code.endsWith('00003')).status,'void')});
// shared wins for non-void fields
file.J.issued.find(x=>x.code.endsWith('00004')).note='edited in shared';file.etag++;await sync(A);
t('shared wins on other fields',()=>assert.equal(A.issued.find(x=>x.code.endsWith('00004')).note,'edited in shared'));
// two simultaneous writers: 20 concurrent issues + concurrent syncs
const before=file.J.issued.length;
const run=async(d,v)=>{for(let i=0;i<10;i++)await issue(d,{vendor:v});await sync(d)};await Promise.all([run(A,'a'),run(B,'b')]);
const codes=file.J.issued.map(x=>x.code);
t('simultaneous writers: no lost writes, no duplicate numbers',()=>{assert.equal(codes.length,before+20);assert.equal(new Set(codes).size,codes.length)});
await sync(A);await sync(B);
t('converge after concurrency',()=>assert.equal(view(A).replace(/,\["RR-GEN-P00-C-AM-L0001","issued"\]/,''),view(B)));
t('nothing ever deleted',()=>assert(A.issued.some(x=>x.code.endsWith('L0001'))&&B.issued.length===codes.length));
console.log(pass+' tests passed')})().catch(e=>{console.error('FAIL',e);process.exit(1)});
