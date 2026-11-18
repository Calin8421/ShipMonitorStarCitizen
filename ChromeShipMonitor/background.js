const storage = chrome.storage.session;
let serial = Promise.resolve();
const locked = fn => { const next=serial.then(fn,fn); serial=next.catch(()=>{}); return next; };
const read = async () => (await storage.get('monitor')).monitor || null;
const save = async state => { await storage.set({monitor:state}); return state; };
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
    const state={id:crypto.randomUUID(),active:true,tabId:tab.id,url:tab.url,title:tab.title||'Selected ship',interval:message.interval,checkSignIn:!!message.checkSignIn,stage:'monitor',status:'ACTIVE',detail:'Checking the selected ship page.',updated:Date.now()};
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
    const allowed={monitor:['add'],add:['cart'],cart:['max'],max:['max','apply'],apply:['continue'],continue:['checkout']};
    if(!allowed[state.stage]?.includes(message.next)) return {ok:false};
    const tab=await chrome.tabs.get(state.tabId);
    if(!shop(tab.url)) return {ok:false};
    if(message.noClick) {
      if(!((state.stage==='add'&&message.next==='cart'&&/(?:^|\/)cart(?:\/|$)/i.test(new URL(tab.url).pathname)) || (state.stage==='cart'&&message.next==='max'))) return {ok:false};
      await save({...state,stage:message.next,updated:Date.now(),detail:message.detail}); return {ok:true};
    }
    if(!Number.isFinite(message.x)||!Number.isFinite(message.y)||message.x<0||message.y<0) return {ok:false};
    const openingCredits=message.next==='max' && (state.stage==='cart'||state.stage==='max');
    const creditOpenAttempts=openingCredits?(state.creditOpenAttempts||0)+1:(state.creditOpenAttempts||0);
    if(openingCredits&&creditOpenAttempts>3) {
      await save({...state,active:false,status:'NEEDS ATTENTION',detail:'Could not open Add store credits. Open the section manually and review the cart.'});
      return {ok:false};
    }
    // Advance before dispatching: an uncertain response must never repeat a click.
    await save({...state,stage:message.next,updated:Date.now(),creditOpenAttempts,product:message.product||state.product,detail:message.detail});
    const target={tabId:state.tabId}; let attached=false;
    try {
      await chrome.debugger.attach(target,'1.3'); attached=true;
      const pos={x:message.x,y:message.y};
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pos});
      await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pos});
      return {ok:true};
    } catch(e) {
      const latest=await read();
      if(latest?.id===state.id) await save({...latest,active:false,status:'NEEDS ATTENTION',detail:'A browser click could not be confirmed. Check the cart before retrying.'});
      return {ok:false};
    } finally { if(attached) try { await chrome.debugger.detach(target); } catch {} }
  }
  return {ok:false};
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{ locked(()=>handle(message,sender)).then(reply,e=>reply({ok:false,error:e.message})); return true; });
chrome.tabs.onRemoved.addListener(tabId=>{locked(async()=>{const s=await read();if(s?.active&&s.tabId===tabId)await save({...s,active:false,status:'INACTIVE',detail:'The monitored tab was closed.'});});});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.url&&!shop(change.url)) locked(async()=>{const s=await read();if(s?.active&&s.tabId===tabId)await save({...s,active:false,status:'NEEDS ATTENTION',detail:'The monitored tab left the RSI shop.'});});});
