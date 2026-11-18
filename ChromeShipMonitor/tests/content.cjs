const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
let hovered, expanded=false, qty=1, clicks=[], status='', detail='', available=true, scheduledDelay;
const productUrl='https://robertsspaceindustries.com/en/pledge/Standalone-Ships/Test';
let state={id:'1',tabId:1,active:true,url:productUrl,interval:5000,checkSignIn:false,stage:'monitor',status:'ACTIVE',detail:'Checking',updated:Date.now()};
const location={href:productUrl,hostname:'robertsspaceindustries.com',protocol:'https:',pathname:'/en/pledge/Standalone-Ships/Test'};
function element(text='',aria='') {return {innerText:text,textContent:text,value:'',parentElement:null,getAttribute:n=>n==='aria-label'?aria:null,matches:()=>false,closest:()=>null,scrollIntoView(){hovered=this;},getBoundingClientRect:()=>({left:10,top:10,width:40,height:20}),contains:e=>e===hovered};}
const add=element('Add to Cart'),icon=element(),row=element('Add store credits'),chevron=element(),max=element('Max','apply max credit'),apply=element('Add','validate credit'),checkout=element('Continue to checkout'),item=element();
icon.querySelector=()=>null;
row.getAttribute=n=>n==='aria-expanded'?String(expanded):null;
row.querySelector=s=>s.includes('__label')?{textContent:'Add store credits'}:chevron;
item.querySelector=s=>s.includes('__name')?{textContent:'Test'}:{textContent:String(qty)};
const document={title:'Buy Test - Standalone Ship',elementFromPoint:()=>hovered,
 querySelector(s){if(s==='#platform-bar-cart-icon')return icon;if(s==='h1')return {innerText:'Test'};return null;},
 querySelectorAll(s){if(s.startsWith('button,a,'))return location.pathname.includes('/cart')?[checkout]:(available?[add]:[]);
 if(s.includes('cart-items'))return location.pathname.includes('/cart')?[item]:[];
 if(s==='button[data-cy-id="__row"]')return [row];
 if(s.includes('apply max credit'))return expanded?[max]:[];
 if(s.includes('validate credit'))return expanded?[apply]:[];
 return [];}};
const chrome={runtime:{onMessage:{addListener(){}},sendMessage:async m=>{
 if(m.type==='get')return {state:{...state}};
 if(m.type==='report'){if(m.id!==state.id||!state.active)return {ok:false};status=m.status;detail=m.detail;if(m.product)state.product=m.product;if(m.done)state.active=false;return {ok:true};}
 if(m.type==='advance'){if(m.expected!==state.stage||!state.active)return {ok:false};if(!m.noClick)clicks.push([m.expected,m.next,hovered]);state.stage=m.next;state.updated=Date.now();if(m.product)state.product=m.product;return {ok:true};}
}}};
const ctx=vm.createContext({chrome,document,location,URL,Date,Number,String,console,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',pointerEvents:'auto'}),setTimeout:(_fn,ms)=>{scheduledDelay=ms;return 1;},clearTimeout:()=>{}});
const drain=()=>new Promise(r=>setImmediate(r));
async function wake(){ctx.__shipMonitorExtension();await drain();await drain();}
(async()=>{
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../content.js'),'utf8'),ctx); await drain();await drain();
 assert.equal(state.stage,'add');assert.equal(state.product,'Test');
 await wake();assert.equal(state.stage,'cart');
 location.pathname='/en/store/pledge/cart';location.href='https://robertsspaceindustries.com/en/store/pledge/cart';
 await wake();assert.equal(state.stage,'max');assert.equal(clicks.at(-1)[2],row,'click the expandable button itself');
 await wake();assert.equal(state.stage,'max');assert.equal(clicks.filter(c=>c[0]==='max').length,0,'do not click MAX before expansion');
 state.updated=Date.now()-3000;await wake();assert.equal(clicks.at(-1)[0],'max');assert.equal(clicks.at(-1)[2],row,'retry the closed credit row');expanded=true;
 await wake();assert.equal(state.stage,'apply');
 await wake();assert.equal(state.stage,'continue');
 qty=2;await wake();assert.equal(state.active,false);assert.match(detail,/quantity/i);
 assert.equal(clicks.filter(c=>c[0]==='monitor').length,1);
 state={...state,active:true,stage:'continue',updated:Date.now()};qty=1;
 await wake();assert.equal(state.stage,'checkout');
 location.pathname='/en/store/pledge/checkout';await wake();assert.equal(state.active,false);assert.equal(status,'CHECKOUT');
 available=false;location.pathname='/en/pledge/Standalone-Ships/Test';location.href=productUrl;
 state={...state,active:true,stage:'monitor',interval:5000,updated:Date.now()};
 await wake();assert.equal(scheduledDelay,5000,'monitor interval must be used directly as milliseconds');
 console.log('PASS: current-tab sequence, single add, one-ship guard, credits and checkout.');
})().catch(e=>{console.error(e);process.exitCode=1;});
