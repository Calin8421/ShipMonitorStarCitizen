(() => {
  if (globalThis.__shipMonitorExtension) { globalThis.__shipMonitorExtension(); return; }
  let timer, running=false;
  const send = m => chrome.runtime.sendMessage(m);
  const norm = s => String(s||'').replace(/\s+/g,' ').trim();
  const clean = s => norm(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const visible = e => {
    if(!e) return false;
    for(let p=e;p;p=p.parentElement) { const s=getComputedStyle(p); if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0) return false; }
    const r=e.getBoundingClientRect(); return r.width>0&&r.height>0;
  };
  const controls = () => [...document.querySelectorAll('button,a,[role=button],[role=link],input[type=submit],input[type=button]')];
  const label = e => norm(e.getAttribute('aria-label')||e.value||e.innerText);
  const point = e => {
    if(!visible(e)||e.matches(':disabled')||e.closest('[aria-disabled=true]')||getComputedStyle(e).pointerEvents==='none') return null;
    e.scrollIntoView({block:'center',inline:'center'});
    const r=e.getBoundingClientRect(), x=r.left+r.width/2, y=r.top+r.height/2, at=document.elementFromPoint(x,y);
    return at&&(at===e||e.contains(at))?{x,y}:null;
  };
  const report = (s,status,detail,extra={}) => send({type:'report',id:s.id,status,detail,...extra});
  const finish = (s,detail,status='NEEDS ATTENTION') => report(s,status,detail,{done:true});
  const go = async (s,next,e,detail,product) => {
    const p=point(e); if(!p) return false;
    const r=await send({type:'advance',id:s.id,expected:s.stage,next,detail,product,...p});
    return !!r?.ok;
  };
  const cartPage = () => /\/(?:cart|shopping-cart)(?:\/|$)/i.test(location.pathname);
  const onShop = () => ['robertsspaceindustries.com','www.robertsspaceindustries.com'].includes(location.hostname) && location.protocol==='https:';
  const signedIn = () => {
    if ([...document.querySelectorAll('input[type=password]')].some(visible)) return false;
    const es=controls().filter(visible);
    if(es.some(e=>/^(sign[ -]?in|log[ -]?in)$/i.test(label(e)))) return false;
    if(es.some(e=>/^(sign[ -]?out|log[ -]?out)$/i.test(label(e)))) return true;
    const toolbar=document.querySelector('#platform-bar-cart-icon')?.parentElement;
    return !!toolbar && ([...toolbar.querySelectorAll('[class*=avatar i],[data-cy-id*=avatar i]')].some(visible) || [...toolbar.querySelectorAll('button[aria-label],[role=button][aria-label]')].filter(visible).some(e=>/^(my account|account menu|profile menu)$/i.test(e.getAttribute('aria-label')||'')));
  };
  const creditRow = () => {
    const rows=[...document.querySelectorAll('button[data-cy-id="__row"]')].filter(e=>visible(e)&&/^add store credits?$/i.test(norm(e.querySelector('[data-cy-id="__label"]')?.textContent)));
    if(rows.length<=1) return rows;
    const ready=rows.filter(e=>point(e));
    return ready.length ? [ready[0]] : [];
  };
  const checkoutControl = () => {
    const matches=e=>visible(e)&&/^(?:(?:proceed|continue|go) to )?checkout$/i.test(norm(e.innerText)||label(e));
    const specific=[...document.querySelectorAll('button.c-cartAction__button[data-cy-id="__button"]')].filter(matches);
    const candidates=specific.length?specific:controls().filter(matches);
    return {button:candidates.find(e=>point(e))||null, found:candidates.length>0};
  };
  const orderResult = () => {
    const messages=[...document.querySelectorAll('h1,h2,h3,[role="alert"],[role="status"]')].filter(visible).map(e=>norm(e.innerText||e.textContent));
    if(messages.some(t=>/^(?:(?:your|the) )?(?:order|payment|pledge) (?:has )?(?:failed|was declined|was not completed|could not be completed)[.!]?$/i.test(t))) return 'error';
    if(messages.some(t=>/^(?:(?:your|the) )?(?:order|pledge) (?:has been |is |was )?(?:confirmed|complete|completed|successfully placed)[.!]?$/i.test(t)||/^thank you for your (?:order|pledge|purchase)[.!]?$/i.test(t))) return 'confirmation';
    return null;
  };
  async function tick() {
    if(running) return; running=true;
    let delay=250, reschedule=false, state;
    try {
      const s=state=(await send({type:'get'}))?.state;
      if(!s?.active) return;
      // A second RSI tab must never operate the monitored tab's session.
      const here=await send({type:'report',id:s.id,status:s.status,detail:s.detail});
      if(!here?.ok) return;
      reschedule=true;
      if(!onShop()) { await finish(s,'The monitored tab left the RSI shop.'); return; }
      if(s.stage==='monitor') {
        if(location.href!==s.url) { await report(s,'WAITING','Return to the selected ship page in this tab to resume monitoring.'); delay=2000; return; }
        const cookie=document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
        if(cookie&&visible(cookie)&&!cookie.disabled) { cookie.click(); delay=750; return; }
        const image=document.querySelector('meta[property="og:image"]')?.content || '';
        if(s.checkSignIn&&!signedIn()) { await report(s,'WAITING FOR SIGN-IN','Sign in to RSI in this tab, then return to the selected ship page.',{image}); delay=2000; return; }
        const buttons=controls().filter(e=>visible(e)&&/\badd\s+to\s+cart\b/i.test(label(e)));
        if(buttons.length>1) { await finish(s,'Multiple Add to Cart controls found.'); return; }
        if(buttons.length===1 && point(buttons[0])) {
          const icon=document.querySelector('#platform-bar-cart-icon');
          if(!icon) { await finish(s,'Could not locate the cart.'); return; }
          const badge=icon.querySelector('.a-ticker__endValue');
          const count=badge?Number(norm(badge.textContent)):0;
          if(!Number.isInteger(count)||count!==0) { await finish(s,'Empty the cart before monitoring so that checkout contains only one ship.'); return; }
          const match=(document.title||'').match(/^Buy\s+(.+?)\s+-\s+(?:Standalone|Ship|Pledge)/i);
          const product=norm(match?match[1]:document.querySelector('h1')?.innerText||'');
          if(!product) { await finish(s,'Could not identify the selected ship.'); return; }
          await report(s,'AVAILABLE','Adding one ship to the cart.',{image,product});
          await go(s,'add',buttons[0],'Adding one ship to the cart.',product); return;
        }
        await report(s,'MONITORING','Waiting for Add to Cart to become available.',{image});
        delay=s.interval;
        timer=setTimeout(async()=>{
          try { const now=(await send({type:'get'})).state; if(now?.active&&now.id===s.id&&now.stage==='monitor'&&location.href===s.url) location.reload(); } catch {}
        },delay);
        return;
      }
      if(Date.now()-s.updated>90000) { await finish(s,s.stage==='submitted'?'Could not confirm the order result. Check RSI order history before retrying.':'The shop did not complete the current step. Check the cart before retrying.'); return; }
      if(s.stage==='add') {
        if(cartPage()) { await send({type:'advance',id:s.id,expected:'add',next:'cart',noClick:true,detail:'Checking the cart.'}); return; }
        const icon=document.querySelector('#platform-bar-cart-icon');
        if(icon) await go(s,'cart',icon,'Checking the cart.');
        return;
      }
      if(s.stage==='submitted') {
        const result=orderResult();
        if(result==='error') await finish(s,'RSI displayed an order or payment error. Check the order before retrying.');
        else if(result==='confirmation') await report(s,'ORDER CONFIRMATION DETECTED','RSI displayed an order confirmation. Check order history for payment and fulfillment.',{done:true});
        else await report(s,'WAITING FOR ORDER RESULT','Final confirmation was attempted once; waiting for RSI.');
        return;
      }
      if(s.stage==='checkout') {
        if(!s.autoOrder&&!s.dryRun&&(/\/checkout(?:\/|$)/i.test(location.pathname)||controls().some(e=>visible(e)&&/^(proceed to pay|continue to payment|add (a |an )?address|place order)$/i.test(label(e))))) { await report(s,'CHECKOUT','Checkout is open. Review and complete the order yourself.',{done:true}); return; }
      }
      const orderPage=['checkout','order','terms'].includes(s.stage)&&/\/checkout(?:\/|$)/i.test(location.pathname);
      if(!cartPage()&&!orderPage) {
        if(s.stage==='cart'&&location.href===s.url&&Date.now()-s.updated>=750) {
          const icon=document.querySelector('#platform-bar-cart-icon');
          if(icon) await go(s,'cart',icon,'The cart is still closed; retrying.');
        } else await report(s,'ACTIVE',s.stage==='checkout'?'Waiting for checkout to open.':'Waiting for the cart to open.');
        return;
      }
      const items=[...document.querySelectorAll('[data-cy-id="cart-items"] [data-cy-id="cart-line-item"]')].filter(visible);
      if(items.length===0) { await report(s,'ACTIVE','Waiting for the selected ship in the cart.'); return; }
      if(items.length!==1) { await finish(s,'The cart contains more than one item. Review it before continuing.'); return; }
      const item=items[0], actual=clean(item.querySelector('[data-cy-id="__name"]')?.textContent), expected=clean(s.product);
      if(!actual||!expected) return;
      if(actual!==expected&&!actual.startsWith(expected+' ')&&!expected.startsWith(actual+' ')) { await finish(s,'The cart item does not match the selected ship.'); return; }
      const q=item.querySelector('[data-cy-id="number_field__ticker"].a-ticker__endValue');
      if(!q) return;
      const qty=Number(norm(q.textContent));
      if(qty!==1) { await finish(s,'The cart quantity is not one. Review the cart.'); return; }
      if((s.autoOrder||s.dryRun)&&['checkout','order','terms'].includes(s.stage)) {
        const totals=[...document.querySelectorAll('.c-cartAction__totalRow')].filter(visible);
        if(!totals.length) { await report(s,'ACTIVE','Waiting to verify the order total.'); return; }
        const amounts=totals.map(e=>norm(e.querySelector('[data-cy-id="price_unit__value"]')?.textContent).replace(/[^0-9.,-]/g,''));
        if(amounts.some(a=>!/^0+(?:[.,]0{1,2})?$/.test(a))) { await finish(s,'The amount due is not verified as zero. Review and place the order yourself.'); return; }
      }
      if(s.stage==='order'||s.stage==='terms') {
        const dialogs=[...document.querySelectorAll('dialog[data-cy-id="modal"][role="dialog"]')].filter(visible)
          .filter(e=>/disclaimer/i.test(e.innerText||'')&&e.querySelector('input[data-cy-id="checkbox__input"][type="checkbox"]'));
        if(dialogs.length>1) { await finish(s,'Multiple agreement dialogs found. Review the order yourself.'); return; }
        if(!dialogs.length) { await report(s,'ACTIVE','Waiting for the order agreement dialog.'); return; }
        const dialog=dialogs[0], checkbox=dialog.querySelector('input[data-cy-id="checkbox__input"][type="checkbox"]');
        const checked=checkbox.checked||checkbox.getAttribute('aria-checked')==='true';
        if(s.stage==='order') {
          if(checked) await send({type:'advance',id:s.id,expected:'order',next:'terms',noClick:true,detail:'Agreement checkbox already selected.'});
          else {
            const target=checkbox.closest('label')?.querySelector('[data-cy-id="checkbox__display"]');
            if(target) await go(s,'terms',target,'Selecting the agreement checkbox.');
            else await report(s,'ACTIVE','Waiting for the agreement checkbox.');
          }
          return;
        }
        if(!checked) { await report(s,'ACTIVE','Waiting for the agreement checkbox to be selected.'); return; }
        if(s.dryRun) { await report(s,'DRY RUN COMPLETE','Stopped before I agree. No final order confirmation was sent.',{done:true}); return; }
        const buttons=[...dialog.querySelectorAll('button[data-cy-id="modal_footer__primary_button"]')].filter(e=>visible(e)&&/^i agree$/i.test(norm(e.innerText)));
        if(buttons.length!==1) { await report(s,'ACTIVE','Waiting for the I agree button.'); return; }
        if(point(buttons[0])) await go(s,'submitted',buttons[0],'Sending final order confirmation.');
        else await report(s,'ACTIVE','Waiting for I agree to become clickable.');
        return;
      }
      if(s.stage==='cart') {
        const rows=creditRow(); if(rows.length>1) { await finish(s,'Multiple store credit sections found.'); return; }
        if(!rows.length) { await report(s,'ACTIVE','Looking for Add store credits. Confirm you are signed in.'); return; }
        const row=rows[0], open=row.getAttribute('aria-expanded');
        if(open==='true') { await send({type:'advance',id:s.id,expected:'cart',next:'max',noClick:true,detail:'Selecting MAX store credit.'}); return; }
        if(open==='false') await go(s,'max',row,'Opening store credits.');
        return;
      }
      if(s.stage==='max'||s.stage==='apply') {
        if(s.stage==='max') {
          const rows=creditRow();
          if(rows.length>1) { await finish(s,'Multiple store credit sections found.'); return; }
          if(!rows.length) { await report(s,'ACTIVE','Waiting for the store credit section.'); return; }
          const expanded=rows[0].getAttribute('aria-expanded');
          if(expanded==='false') {
            if(Date.now()-s.updated>=750) await go(s,'max',rows[0],'Opening store credits.');
            return;
          }
          if(expanded!=='true') { await report(s,'ACTIVE','Waiting for store credits to open.'); return; }
        }
        const isMax=s.stage==='max', selector=isMax?'button[aria-label="apply max credit" i]':'button[aria-label="validate credit" i]';
        const buttons=[...document.querySelectorAll(selector)].filter(visible);
        const button=buttons.find(e=>point(e));
        if(button) await go(s,isMax?'apply':'continue',button,isMax?'Selecting maximum store credit.':'Applying store credit.');
        else if(buttons.length) await report(s,'ACTIVE',isMax?'Waiting for the MAX button to become clickable.':'Waiting for the ADD button to become clickable.');
        else if(!isMax&&Date.now()-s.updated>=750) {
          const rows=creditRow();
          const maxButtons=[...document.querySelectorAll('button[aria-label="apply max credit" i]')].filter(visible);
          const maxButton=maxButtons.find(e=>point(e));
          if(rows.length===1&&rows[0].getAttribute('aria-expanded')==='true'&&maxButton)
            await go(s,'apply',maxButton,'MAX has not changed to ADD; retrying MAX.');
        }
        return;
      }
      if(s.stage==='continue') {
        const checkout=checkoutControl();
        if(checkout.button) await go(s,'checkout',checkout.button,'Opening checkout.');
        else await report(s,'ACTIVE',checkout.found?'Waiting for Continue to checkout to become clickable.':'Looking for Continue to checkout.');
        return;
      }
      if(s.stage==='checkout'&&(s.autoOrder||s.dryRun)) {
        const buttons=controls().filter(e=>visible(e)&&/^place (?:the )?order$/i.test(norm(e.innerText)||label(e)));
        if(buttons.length) {
          // The cart and amount due were verified before this action.
          const order=buttons.find(e=>point(e));
          if(order) await go(s,'order',order,'Opening the order agreement.');
          else await report(s,'ACTIVE','Waiting for Place order to become clickable.');
          return;
        }
      }
      if(s.stage==='checkout'&&Date.now()-s.updated>=750) {
        const checkout=checkoutControl();
        if(checkout.button) {
          const button=checkout.button, busy=button.closest('[aria-busy="true"], [data-loading="true"]')||button.matches(':disabled')||button.getAttribute('aria-disabled')==='true';
          if(!busy) await go(s,'checkout',button,'Checkout is still closed; retrying.');
        } else await report(s,'ACTIVE',checkout.found?'Waiting for Continue to checkout to become clickable.':'Waiting for checkout to open.');
      }
    } catch(e) {
      if(state?.active) try { await finish(state,'Could not inspect the shop page. Check the cart before retrying.'); } catch {}
    }
    finally { running=false; if(reschedule&&!timer) timer=setTimeout(()=>{timer=null;tick();},delay); }
  }
  globalThis.__shipMonitorExtension=()=>{clearTimeout(timer);timer=null;tick();};
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='wake') globalThis.__shipMonitorExtension();});
  globalThis.__shipMonitorExtension();
})();
