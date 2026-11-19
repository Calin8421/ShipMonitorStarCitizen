const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
let hovered, expanded=false, qty=1, clicks=[], status='', detail='', available=true, showAdd=true, duplicateCheckout=false, duplicateCredit=false, scheduledDelay, orderVisible=false, dialogVisible=false, agreed=false, amountDue='$0.00', resultMessage='';
const productUrl='https://robertsspaceindustries.com/en/pledge/Standalone-Ships/Test';
let state={id:'1',tabId:1,active:true,url:productUrl,interval:5000,checkSignIn:false,stage:'monitor',status:'ACTIVE',detail:'Checking',updated:Date.now()};
const location={href:productUrl,hostname:'robertsspaceindustries.com',protocol:'https:',pathname:'/en/pledge/Standalone-Ships/Test'};
function element(text='',aria='') {return {innerText:text,textContent:text,value:'',parentElement:null,getAttribute:n=>n==='aria-label'?aria:null,matches:()=>false,closest:()=>null,scrollIntoView(){hovered=this;},getBoundingClientRect:()=>({left:10,top:10,width:40,height:20}),contains:e=>e===hovered};}
const add=element('Add to Cart'),icon=element(),row=element('Add store credits'),chevron=element(),max=element('Max','apply max credit'),apply=element('Add','validate credit'),checkout=element('Continue to checkout'),item=element();
const checkoutDuplicate=element('Continue to checkout'),applyDuplicate=element('Add','validate credit');
const place=element('Place order'),checkboxDisplay=element(),agreeButton=element('I agree'),dialog=element('Disclaimer');
const checkbox={get checked(){return agreed;},getAttribute:()=>null,closest:()=>({querySelector:()=>checkboxDisplay})};
dialog.querySelector=()=>checkbox;
dialog.querySelectorAll=()=>[agreeButton];
const total=element();total.querySelector=()=>({textContent:amountDue});
icon.querySelector=()=>null;
row.getAttribute=n=>n==='aria-expanded'?String(expanded):null;
row.querySelector=s=>s.includes('__label')?{textContent:'Add store credits'}:chevron;
item.querySelector=s=>s.includes('__name')?{textContent:'Test'}:{textContent:String(qty)};
const document={title:'Buy Test - Standalone Ship',elementFromPoint:()=>hovered,
 querySelector(s){if(s==='#platform-bar-cart-icon')return icon;if(s==='h1')return {innerText:'Test'};return null;},
 querySelectorAll(s){if(s.startsWith('button,a,'))return location.pathname.includes('/cart')?(orderVisible?[place]:[checkout]):(available?[add]:[]);
 if(s.includes('cart-items'))return location.pathname.includes('/cart')?[item]:[];
 if(s==='dialog[data-cy-id="modal"][role="dialog"]')return dialogVisible?[dialog]:[];
 if(s==='h1,h2,h3,[role="alert"],[role="status"]')return resultMessage?[element(resultMessage)]:[];
 if(s==='.c-cartAction__totalRow')return [total];
 if(s==='button[data-cy-id="__row"]')return [row];
 if(s==='button.c-cartAction__button[data-cy-id="__button"]')return duplicateCheckout?[checkout,checkoutDuplicate]:[checkout];
 if(s.includes('apply max credit'))return expanded?[max]:[];
 if(s.includes('validate credit'))return expanded&&showAdd?(duplicateCredit?[apply,applyDuplicate]:[apply]):[];
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
 state.updated=Date.now()-800;await wake();assert.equal(state.stage,'cart');assert.equal(clicks.at(-1)[2],icon,'retry opening the cart');
 location.pathname='/en/store/pledge/cart';location.href='https://robertsspaceindustries.com/en/store/pledge/cart';
 await wake();assert.equal(state.stage,'max');assert.equal(clicks.at(-1)[2],row,'click the expandable button itself');
 await wake();assert.equal(state.stage,'max');assert.equal(clicks.filter(c=>c[0]==='max').length,0,'do not click MAX before expansion');
 state.updated=Date.now()-3000;await wake();assert.equal(clicks.at(-1)[0],'max');assert.equal(clicks.at(-1)[2],row,'retry the closed credit row');expanded=true;
 await wake();assert.equal(state.stage,'apply');
 showAdd=false;state.updated=Date.now()-800;await wake();assert.equal(state.stage,'apply');assert.equal(clicks.at(-1)[0],'apply');assert.equal(clicks.at(-1)[2],max,'retry MAX while ADD has not appeared');
 showAdd=true;duplicateCredit=true;
 await wake();assert.equal(state.stage,'continue');
 qty=2;await wake();assert.equal(state.active,false);assert.match(detail,/quantity/i);
 assert.equal(clicks.filter(c=>c[0]==='monitor').length,1);
 state={...state,active:true,stage:'continue',updated:Date.now()};qty=1;duplicateCheckout=true;
 await wake();assert.equal(state.stage,'checkout');assert.equal(clicks.at(-1)[2],checkout,'proceed to checkout even if ADD is still visible');
 assert.equal(clicks.filter(c=>c[2]===apply).length,1,'press ADD only once');
 state.updated=Date.now()-800;await wake();assert.equal(state.stage,'checkout');assert.equal(clicks.at(-1)[2],checkout,'retry checkout when still on the cart');
 location.pathname='/en/store/pledge/checkout';await wake();assert.equal(state.active,false);assert.equal(status,'CHECKOUT');
 location.pathname='/en/store/pledge/cart';location.href='https://robertsspaceindustries.com/en/store/pledge/cart';
 state={...state,active:true,autoOrder:true,stage:'checkout',updated:Date.now()};orderVisible=true;amountDue='$12.00';
 await wake();assert.equal(state.active,false);assert.match(detail,/not verified as zero/,'nonzero totals must not be ordered');
 state={...state,active:true,autoOrder:true,stage:'checkout',updated:Date.now()};amountDue='$0.00';
 await wake();assert.equal(state.stage,'order');assert.equal(clicks.at(-1)[2],place);
 dialogVisible=true;await wake();assert.equal(state.stage,'terms');assert.equal(clicks.at(-1)[2],checkboxDisplay);
 agreed=true;await wake();assert.equal(state.stage,'submitted');assert.equal(clicks.at(-1)[2],agreeButton);
 await wake();assert.equal(state.active,true);assert.equal(status,'WAITING FOR ORDER RESULT');
 resultMessage='Order pending';await wake();assert.equal(state.active,true);assert.equal(status,'WAITING FOR ORDER RESULT','pending is not completion');
 resultMessage='Order confirmed';await wake();assert.equal(state.active,false);assert.equal(status,'ORDER CONFIRMATION DETECTED');
 assert.equal(clicks.filter(c=>c[2]===agreeButton).length,1,'final order confirmation must be sent once');
 resultMessage='';state={...state,active:true,autoOrder:false,dryRun:true,stage:'terms',updated:Date.now()};
 await wake();assert.equal(state.active,false);assert.equal(status,'DRY RUN COMPLETE');assert.equal(clicks.filter(c=>c[2]===agreeButton).length,1,'dry run must never send final confirmation');
 state={...state,active:true,autoOrder:true,dryRun:false,stage:'submitted',updated:Date.now()};resultMessage='Payment failed';
 await wake();assert.equal(state.active,false);assert.equal(status,'NEEDS ATTENTION');
 state={...state,active:true,stage:'submitted',updated:Date.now()-90001};resultMessage='';
 await wake();assert.equal(state.active,false);assert.match(detail,/Could not confirm the order result/);
 available=false;location.pathname='/en/pledge/Standalone-Ships/Test';location.href=productUrl;
 state={...state,active:true,stage:'monitor',interval:5000,updated:Date.now()};
 await wake();assert.equal(scheduledDelay,5000,'monitor interval must be used directly as milliseconds');
 console.log('PASS: current-tab sequence, single add, one-ship guard, credits and checkout.');
})().catch(e=>{console.error(e);process.exitCode=1;});
