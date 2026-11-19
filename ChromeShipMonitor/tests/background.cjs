const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
let saved=null, commands=[], failureMode='', tab={id:7,url:'https://robertsspaceindustries.com/en/pledge/Standalone-Ships/Test',title:'Test'};
const chrome={
  storage:{session:{get:async()=>({monitor:saved}),set:async v=>{saved=v.monitor;}}},
  tabs:{get:async id=>{if(id!==tab.id)throw Error('tab');return tab;},sendMessage:async()=>{},onRemoved:{addListener(){}},onUpdated:{addListener(){}}},
  scripting:{executeScript:async()=>{}},
  debugger:{attach:async()=>{if(failureMode==='attach')throw Error('attach failed');},detach:async()=>{},sendCommand:async(_,method,params)=>{if(failureMode==='press'&&params.type==='mousePressed')throw Error('uncertain');commands.push({method,params});}},
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
  assert.equal(saved.log.length,1);assert.equal(saved.log[0].detail,'Checking the selected ship page.');
  await invoke({type:'report',id:saved.id,status:saved.status,detail:saved.detail},sender);assert.equal(saved.log.length,1,'unchanged status must not flood the log');
  saved={...saved,stage:'checkout'};
  r=await invoke({type:'advance',id:saved.id,expected:'checkout',next:'order',x:1,y:2},sender);assert.equal(r.ok,false,'automatic order requires explicit opt-in');
  saved={...saved,dryRun:true};r=await invoke({type:'advance',id:saved.id,expected:'checkout',next:'order',x:1,y:2},sender);assert.equal(r.ok,true,'dry run can reach the agreement step');
  saved={...saved,stage:'monitor'};
  saved={...saved,dryRun:false};commands=[];
  r=await invoke({type:'advance',id:saved.id,expected:'monitor',next:'add',x:20,y:30,product:'Test',detail:'Adding'},sender);
  assert.equal(r.ok,true); assert.equal(saved.stage,'add'); assert.equal(commands.length,3);assert.equal(saved.log.at(-1).detail,'Adding');
  r=await invoke({type:'advance',id:saved.id,expected:'monitor',next:'add',x:20,y:30},sender);
  assert.equal(r.ok,false); assert.equal(commands.length,3,'a repeated add must not click');
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',x:1,y:2},{tab:{id:8},url:tab.url});
  assert.equal(r.ok,false,'another tab must not advance the monitor');
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',noClick:true},sender);
  assert.equal(r.ok,false,'cannot skip opening the cart from the product page');
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',x:1,y:2},sender);assert.equal(r.ok,true);
  for(let n=0;n<2;n++) { r=await invoke({type:'advance',id:saved.id,expected:'cart',next:'cart',x:1,y:2},sender);assert.equal(r.ok,true); }
  r=await invoke({type:'advance',id:saved.id,expected:'cart',next:'cart',x:1,y:2},sender);assert.equal(r.ok,false);assert.equal(saved.active,false,'stop after three cart-opening attempts');
  saved={...saved,active:true,stage:'add'};
  tab={...tab,url:'https://robertsspaceindustries.com/en/store/pledge/cart'};
  r=await invoke({type:'advance',id:saved.id,expected:'add',next:'cart',noClick:true},{...sender,url:tab.url});
  assert.equal(r.ok,true); assert.equal(saved.stage,'cart');
  r=await invoke({type:'advance',id:saved.id,expected:'cart',next:'checkout',x:1,y:2},{...sender,url:tab.url});
  assert.equal(r.ok,false,'cannot skip credit steps');
  r=await invoke({type:'advance',id:saved.id,expected:'cart',next:'max',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true);
  for(let n=0;n<2;n++) { r=await invoke({type:'advance',id:saved.id,expected:'max',next:'max',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true); }
  r=await invoke({type:'advance',id:saved.id,expected:'max',next:'max',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(saved.active,false,'stop after three expansion attempts');
  saved={...saved,active:true,stage:'max',maxAttempts:0,preClickFailures:0};
  r=await invoke({type:'advance',id:saved.id,expected:'max',next:'apply',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true);
  for(let n=0;n<2;n++) { r=await invoke({type:'advance',id:saved.id,expected:'apply',next:'apply',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true); }
  r=await invoke({type:'advance',id:saved.id,expected:'apply',next:'apply',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(saved.active,false,'stop after three MAX attempts');
  saved={...saved,active:true,stage:'apply',preClickFailures:0};
  r=await invoke({type:'advance',id:saved.id,expected:'apply',next:'continue',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true);
  const afterAdd=commands.length;
  r=await invoke({type:'advance',id:saved.id,expected:'continue',next:'continue',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(commands.length,afterAdd,'ADD cannot be pressed twice');
  saved={...saved,active:true,stage:'continue',checkoutAttempts:0,preClickFailures:0};
  r=await invoke({type:'advance',id:saved.id,expected:'continue',next:'checkout',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true);
  for(let n=0;n<2;n++) { r=await invoke({type:'advance',id:saved.id,expected:'checkout',next:'checkout',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true); }
  r=await invoke({type:'advance',id:saved.id,expected:'checkout',next:'checkout',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(saved.active,false,'stop after three checkout-opening attempts');
  saved={...saved,active:true,stage:'continue',checkoutAttempts:0,preClickFailures:0};failureMode='attach';
  r=await invoke({type:'advance',id:saved.id,expected:'continue',next:'checkout',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(saved.active,true);assert.equal(saved.stage,'continue','retry is safe before a press is sent');
  failureMode='press';r=await invoke({type:'advance',id:saved.id,expected:'continue',next:'checkout',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(saved.active,false,'do not repeat a potentially dispatched press');
  failureMode='';saved={...saved,active:true,autoOrder:true,stage:'terms'};
  saved={...saved,dryRun:true};r=await invoke({type:'advance',id:saved.id,expected:'terms',next:'submitted',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false,'dry run cannot submit the final confirmation');
  saved={...saved,dryRun:false};
  r=await invoke({type:'advance',id:saved.id,expected:'terms',next:'submitted',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,true);
  const afterFinal=commands.length;
  r=await invoke({type:'advance',id:saved.id,expected:'terms',next:'submitted',x:1,y:2},{...sender,url:tab.url});assert.equal(r.ok,false);assert.equal(commands.length,afterFinal,'final order confirmation must not repeat');
  for(let n=0;n<105;n++) await invoke({type:'report',id:saved.id,status:'ACTIVE',detail:'Step '+n},{...sender,url:tab.url});
  assert.equal(saved.log.length,100,'activity log must remain bounded');
  await invoke({type:'stop'}); assert.equal(saved.active,false);
  console.log('PASS: session isolation, single add, navigation and checkout stage guards.');
})().catch(e=>{console.error(e);process.exitCode=1;});
