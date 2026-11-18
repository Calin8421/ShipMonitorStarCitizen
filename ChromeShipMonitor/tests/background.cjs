const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
let saved=null, commands=[], tab={id:7,url:'https://robertsspaceindustries.com/en/pledge/Standalone-Ships/Test',title:'Test'};
const chrome={
  storage:{session:{get:async()=>({monitor:saved}),set:async v=>{saved=v.monitor;}}},
  tabs:{get:async id=>{if(id!==tab.id)throw Error('tab');return tab;},sendMessage:async()=>{},onRemoved:{addListener(){}},onUpdated:{addListener(){}}},
  scripting:{executeScript:async()=>{}},
  debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_,method,params)=>commands.push({method,params})},
  runtime:{onMessage:{addListener(){}}}
};
const ctx=vm.createContext({chrome,URL,crypto:{randomUUID:()=> 'session-1'},Date,Number,String,Promise,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),ctx);
const invoke=(m,s={})=>ctx.handle(m,s);
const sender={tab:{id:7},url:tab.url};
(async()=>{
  let r=await invoke({type:'start',tabId:7,interval:5000,checkSignIn:true}); assert.equal(r.ok,true);
  assert.equal(saved.interval,5000);
  assert.equal(saved.stage,'monitor');
  r=await invoke({type:'advance',id:saved.id,expected:'monitor',next:'add',x:20,y:30,product:'Test',detail:'Adding'},sender);
  assert.equal(r.ok,true); assert.equal(saved.stage,'add'); assert.equal(commands.length,3);
  r=await invoke({type:'advance',id:saved.id,expected:'monitor',next:'add',x:20,y:30},sender);
  assert.equal(r.ok,false); assert.equal(commands.length,3,'a repeated add must not click');
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',x:1,y:2},{tab:{id:8},url:tab.url});
  assert.equal(r.ok,false,'another tab must not advance the monitor');
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',noClick:true},sender);
  assert.equal(r.ok,false,'cannot skip opening the cart from the product page');
  tab={...tab,url:'https://robertsspaceindustries.com/en/store/pledge/cart'};
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',noClick:true},{...sender,url:tab.url});
  assert.equal(r.ok,true); assert.equal(saved.stage,'cart');
  r=await invoke({type:'advance',id:saved.id,expected:'cart',next:'checkout',x:1,y:2},{...sender,url:tab.url});
  assert.equal(r.ok,false,'cannot skip credit steps');
  r=await invoke({type:'advance',id:saved.id,expected:'cart',next:'max',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true);
  for(let n=0;n<2;n++) { r=await invoke({type:'advance',id:saved.id,expected:'max',next:'max',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true); }
  r=await invoke({type:'advance',id:saved.id,expected:'max',next:'max',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(saved.active,false,'stop after three expansion attempts');
  await invoke({type:'stop'}); assert.equal(saved.active,false);
  console.log('PASS: session isolation, single add, navigation and checkout stage guards.');
})().catch(e=>{console.error(e);process.exitCode=1;});
