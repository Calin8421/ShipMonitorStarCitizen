const storage = chrome.storage.session;
let serial = Promise.resolve();
const locked = fn => { const next=serial.then(fn,fn); serial=next.catch(()=>{}); return next; };
const read = async () => (await storage.get('monitor')).monitor || null;
const save = async state => {
  const previous=(await storage.get('monitor')).monitor;
  const same=previous?.id===state.id;
  const log=same&&Array.isArray(previous.log)?previous.log.slice(-99):[];
  if(!same || previous.stage!==state.stage || previous.status!==state.status || previous.detail!==state.detail || previous.active!==state.active)
    log.push({time:Date.now(),status:String(state.status||'ACTIVE').slice(0,60),detail:String(state.detail||'').slice(0,300)});
  const updated={...state,log};
  await storage.set({monitor:updated}); return updated;
};
const shop = value => { try { const u=new URL(value); return u.protocol==='https:' && ['robertsspaceindustries.com','www.robertsspaceindustries.com'].includes(u.hostname) && (!u.port||u.port==='443'); } catch { return false; } };

async function handle(message,sender) {
  if (message.type==='get') return {state:await read()};
  if (message.type==='start') {
    const old=await read();
    if(old?.active) return {ok:false,error:'Monitoring is already active.'};
    const tab=await chrome.tabs.get(message.tabId);
    if(!shop(tab.url)||!/^\/([a-z]{2}\/)?pledge\//i.test(new URL(tab.url).pathname))
      return {ok:false,error:'Open the ship’s RSI pledge page in the current tab first.'};
    if(!Number.isInteger(message.interval)||message.interval<1||message.interval>86400000) return {ok:false,error:'Invalid interval.'};
    const state={id:crypto.randomUUID(),active:true,tabId:tab.id,url:tab.url,title:tab.title||'Selected ship',interval:message.interval,checkSignIn:!!message.checkSignIn,autoOrder:!!message.autoOrder,dryRun:!!message.dryRun,stage:'monitor',status:'ACTIVE',detail:'Checking the selected ship page.',updated:Date.now()};
    await save(state);
    try {
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
      await chrome.tabs.sendMessage(tab.id,{type:'wake'});
      return {ok:true};
    } catch(e) { await save({...state,active:false,status:'NEEDS ATTENTION',detail:'Could not access the tab. Reload the ship page and try again.'}); return {ok:false,error:'Could not access the tab. Reload the ship page and try again.'}; }
  }
  if (message.type==='stop') {
    const state=await read();
    if(state) await save({...state,active:false,status:'INACTIVE',detail:'Monitoring stopped.'});
    return {ok:true};
  }
  const state=await read();
  if(!state?.active || sender.tab?.id!==state.tabId || message.id!==state.id || !shop(sender.url||'')) return {ok:false};
  if(message.type==='report') {
    const update={...state,status:String(message.status||'ACTIVE').slice(0,60),detail:String(message.detail||'').slice(0,300)};
    if(message.image && /^https:\/\//i.test(message.image)) update.image=message.image;
    if(message.product) update.product=String(message.product).slice(0,150);
    if(message.done) update.active=false;
    await save(update); return {ok:true};
  }
  if(message.type==='advance') {
    if(state.stage!==message.expected) return {ok:false};
    const allowed={monitor:['add'],add:['cart'],cart:['cart','max'],max:['max','apply'],apply:['apply','continue'],continue:['checkout'],checkout:['checkout','order'],order:['terms'],terms:['submitted']};
    if(!allowed[state.stage]?.includes(message.next)) return {ok:false};
    if(['order','terms'].includes(message.next)&&!state.autoOrder&&!state.dryRun) return {ok:false};
    if(message.next==='submitted'&&(!state.autoOrder||state.dryRun)) return {ok:false};
    const tab=await chrome.tabs.get(state.tabId);
    if(!shop(tab.url)) return {ok:false};
    if(message.noClick) {
      if(!((state.stage==='add'&&message.next==='cart'&&/(?:^|\/)cart(?:\/|$)/i.test(new URL(tab.url).pathname)) || (state.stage==='cart'&&message.next==='max') || (state.stage==='order'&&message.next==='terms'))) return {ok:false};
      await save({...state,stage:message.next,updated:Date.now(),detail:message.detail}); return {ok:true};
    }
    if(!Number.isFinite(message.x)||!Number.isFinite(message.y)||message.x<0||message.y<0) return {ok:false};
    const openingCredits=message.next==='max' && (state.stage==='cart'||state.stage==='max');
    const creditOpenAttempts=openingCredits?(state.creditOpenAttempts||0)+1:(state.creditOpenAttempts||0);
    if(openingCredits&&creditOpenAttempts>3) {
      await save({...state,active:false,status:'NEEDS ATTENTION',detail:'Could not open Add store credits. Open the section manually and review the cart.'});
      return {ok:false};
    }
    const selectingMax=message.next==='apply' && (state.stage==='max'||state.stage==='apply');
    const maxAttempts=selectingMax?(state.maxAttempts||0)+1:(state.maxAttempts||0);
    if(selectingMax&&maxAttempts>3) {
      await save({...state,active:false,status:'NEEDS ATTENTION',detail:'MAX did not change to ADD after three attempts. Check the store credit section.'});
      return {ok:false};
    }
    const openingCart=message.next==='cart' && (state.stage==='add'||state.stage==='cart');
    const cartAttempts=openingCart?(state.cartAttempts||0)+1:(state.cartAttempts||0);
    if(openingCart&&cartAttempts>3) {
      await save({...state,active:false,status:'NEEDS ATTENTION',detail:'The cart did not open after three attempts. Check the browser.'});
      return {ok:false};
    }
    const openingCheckout=message.next==='checkout' && (state.stage==='continue'||state.stage==='checkout');
    const checkoutAttempts=openingCheckout?(state.checkoutAttempts||0)+1:(state.checkoutAttempts||0);
    if(openingCheckout&&checkoutAttempts>3) {
      await save({...state,active:false,status:'NEEDS ATTENTION',detail:'Checkout did not open after three attempts. Review the cart.'});
      return {ok:false};
    }
    // Advance before dispatching: an uncertain response must never repeat a click.
    await save({...state,stage:message.next,updated:Date.now(),creditOpenAttempts,maxAttempts,cartAttempts,checkoutAttempts,product:message.product||state.product,detail:message.detail});
    const target={tabId:state.tabId}; let attached=false, pressAttempted=false;
    try {
      await chrome.debugger.attach(target,'1.3'); attached=true;
      const pos={x:message.x,y:message.y};
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
      pressAttempted=true;
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
      if(state.preClickFailures) {
        const latest=await read();
        if(latest?.id===state.id) await save({...latest,preClickFailures:0});
      }
      return {ok:true};
    } catch(e) {
      const latest=await read();
      if(latest?.id===state.id) {
        const failures=(state.preClickFailures||0)+1;
        if(!pressAttempted&&failures<3) await save({...latest,stage:state.stage,updated:Date.now(),preClickFailures:failures,status:'ACTIVE',detail:'Browser input could not start; retrying.'});
        else await save({...latest,active:false,status:'NEEDS ATTENTION',detail:pressAttempted?'A browser click could not be confirmed. Check the cart before retrying.':'Browser input failed repeatedly. Check the browser and try again.'});
      }
      return {ok:false};
    } finally { if(attached) try { await chrome.debugger.detach(target); } catch {} }
  }
  return {ok:false};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{ locked(()=>handle(message,sender)).then(reply,e=>reply({ok:false,error:e.message})); return true; });
chrome.tabs.onRemoved.addListener(tabId=>{locked(async()=>{const s=await read();if(s?.active&&s.tabId===tabId)await save({...s,active:false,status:'INACTIVE',detail:'The monitored tab was closed.'});});});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url&&!shop(change.url)) locked(async()=>{const s=await read();if(s?.active&&s.tabId===tabId)await save({...s,active:false,status:'NEEDS ATTENTION',detail:'The monitored tab left the RSI shop.'});});});
