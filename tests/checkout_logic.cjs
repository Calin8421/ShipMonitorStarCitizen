const vm=require('vm'),fs=require('fs'),assert=require('assert');
const scripts=Object.fromEntries(['INSPECT','CLICK_CART','RSI_CART_STEP'].map(n=>[n,fs.readFileSync('build/'+n+'.js','utf8')]));
let page='product',count=0,blocked=true,itemPresent=true,cookieVisible=true,cookieClicks=0,expanded=false,creditButton='MAX',amount='',applied='',duplicate=false,point,expansionAttribute=true,missingItemNodes=false,itemName='Avenger Stalker';
function el(text,tag='BUTTON'){return {innerText:text,value:'',tagName:tag,disabled:false,parentElement:null,getAttribute(){return null},matches(){return false},closest(){return null},scrollIntoView(){},getBoundingClientRect(){return {width:100,height:40,left:10,top:10}},contains(other){return other===this}}}
const add=el('Add to Cart'),cart=el('0','DIV'),checkout=el('Continue to checkout'),item=el('Avenger Stalker','DIV');
const cookie=el('Allow all cookies');cookie.click=()=>{cookieClicks++;cookieVisible=false;blocked=false;};
const header=el('Add store credits');header.getAttribute=k=>k==='aria-expanded'?(expansionAttribute?String(expanded):null):k==='aria-label'?'Expand':null;
const max=el('MAX','SPAN'), apply=el('ADD','SPAN'), amountInput=el('','INPUT'), arrow=el('','SVG');
arrow.getBoundingClientRect=()=>({width:20,height:20,left:180,top:10});header.querySelector=()=>arrow;
max.getAttribute=k=>k==='aria-label'?'Set maximum':null;
const area=el('','DIV');header.parentElement=area;area.querySelectorAll=s=>!expanded?[]:s==='input'?[amountInput]:s.startsWith('button')?(creditButton==='MAX'?[max]:[apply]):[];
const location={protocol:'https:',hostname:'robertsspaceindustries.com',port:'',pathname:'/en/pledge/Standalone-Ships/Avenger-Stalker',href:'https://robertsspaceindustries.com/en/pledge/Standalone-Ships/Avenger-Stalker'};
const document={title:'Buy Avenger Stalker - Standalone Ship | Star Citizen Store',body:{get innerText(){return page==='cart'?'Shopping bag\n'+(itemPresent?'1 item\nItems in your cart [1]\n'+itemName:'')+'\n'+applied:applied}},elementFromPoint(){return blocked?{}:point||add},querySelector(s){if(s==='#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll')return cookieVisible?cookie:null;if(s.includes('meta['))return null;if(s==='h1')return {innerText:'Avenger Stalker'};if(s==='#platform-bar-cart-icon .a-ticker__endValue')return {innerText:String(count)};if(s==='#platform-bar-cart-icon')return cart;return null},querySelectorAll(s){if(s.startsWith('[class*=cartLineItem'))return page==='cart'&&itemPresent&&!missingItemNodes?[item]:[];if(s==='[data-cy-id=__row],.m-summaryUnit__row')return [];if(s.includes('input[type=password]')&&!s.includes('input[type=submit]'))return [];if(s.includes('[role=dialog]'))return [];if(s.includes('button,a,'))return page==='product'?[add]:[header,...(duplicate?[el('Add store credits')]:[]),checkout];return []}};
const ctx=vm.createContext({document,location,URL,window:{},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1',pointerEvents:'auto'}),setTimeout});
async function run(code){return JSON.parse(await vm.runInContext(code,ctx))}
function step(n, previousCount=0, product='Avenger Stalker'){return scripts.RSI_CART_STEP.replaceAll('__COUNT__',String(previousCount)).replaceAll('__PRODUCT__',JSON.stringify(product)).replaceAll('__STAGE__',String(n))}
(async()=>{
 let r=await run(scripts.INSPECT);assert.equal(r.status,'AVAILABLE');assert.equal(cookieClicks,1);
 r=await run(scripts.CLICK_CART.replace('__EXPECTED_URL__',JSON.stringify(location.href)));assert.equal(r.status,'READY');assert.equal(r.product,'Avenger Stalker');assert.equal(r.count,0);
 r=await run(step(0));assert.equal(r.status,'WAIT');count=1;point=cart;r=await run(step(0));assert.equal(r.status,'OPEN_CART');
 page='cart';location.pathname='/en/store/pledge/cart';point=header;
 // A nonempty badge alone is insufficient: wait for a rendered cart item.
 itemPresent=false;r=await run(step(1));assert.equal(r.status,'WAIT');itemPresent=true;
 // A pre-existing cart must not authorize checkout before the add increments its badge.
 count=1;r=await run(step(1,1));assert.equal(r.status,'WAIT');
 // The product page's title may differ from the cart text. Once our add has
 // increased the count and a cart item is rendered, proceed even if names differ.
 itemName='L-21 Wolf';item.innerText=itemName;r=await run(step(1,0,'L-21 Wolf - Standalone Ship'));assert.equal(r.status,'OPEN_CREDITS');
 itemName='Avenger Stalker';item.innerText=itemName;
 duplicate=true;r=await run(step(1));assert.equal(r.status,'NEEDS_ATTENTION');duplicate=false;r=await run(step(1));assert.equal(r.status,'OPEN_CREDITS');
 point=arrow;r=await run(step(1));assert.equal(r.status,'OPEN_CREDITS');assert.equal(r.x,190);point=header;
 expansionAttribute=false;missingItemNodes=true;r=await run(step(1));assert.equal(r.status,'OPEN_CREDITS');r=await run(step(2));assert.equal(r.status,'OPEN_CREDITS');expansionAttribute=true;missingItemNodes=false;
 r=await run(step(2));assert.equal(r.status,'OPEN_CREDITS');
 expanded=true;point=max;r=await run(step(2));assert.equal(r.status,'MAX_CREDITS');
 amountInput.value='110.00';r=await run(step(3));assert.equal(r.status,'WAIT'); // MAX has not changed to ADD yet.
 creditButton='ADD';point=apply;amountInput.value='0';r=await run(step(3));assert.equal(r.status,'WAIT');amountInput.value='110.00';r=await run(step(3));assert.equal(r.status,'ADD_CREDITS');
 point=checkout;r=await run(step(4));assert.equal(r.status,'OPEN_CHECKOUT');
 location.pathname='/en/store/pledge/checkout';r=await run(step(4));assert.equal(r.status,'NEEDS_ATTENTION');r=await run(step(5));assert.equal(r.status,'CHECKOUT');
 console.log('PASS: cookie handling, cart count and rendered item verification, title mismatch, collapsed panel and chevron, MAX-to-ADD transition, and checkout.');
})().catch(e=>{console.error(e);process.exit(1)});
