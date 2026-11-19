const $ = id => document.getElementById(id);
let selectedTab, state;
const call = message => chrome.runtime.sendMessage(message);

async function refresh() {
  [selectedTab] = await chrome.tabs.query({active:true, currentWindow:true});
  state = (await call({type:'get'})).state;
  const active = state?.active && state.tabId === selectedTab?.id;
  const other = state?.active && !active;
  $('activity').textContent = active ? '● ACTIVE' : other ? '● ACTIVE IN ANOTHER TAB' : '● INACTIVE';
  $('activity').className = active || other ? 'active' : 'inactive';
  $('status').textContent = state?.status || 'Ready';
  $('detail').textContent = state?.detail || 'Open the ship page you want to monitor.';
  $('toggle').textContent = active || other ? 'Stop monitoring' : 'Start monitoring';
  $('interval').disabled = active || other;
  $('signIn').disabled = active || other;
  $('autoOrder').disabled = active || other;
  $('dryRun').disabled = active || other;
  if (state?.interval) $('interval').value = state.interval;
  if (state?.checkSignIn != null) $('signIn').checked = state.checkSignIn;
  if (state?.autoOrder != null) $('autoOrder').checked = state.autoOrder;
  if (state?.dryRun != null) $('dryRun').checked = state.dryRun;
  const entries=$('logEntries'); entries.replaceChildren();
  for (const entry of state?.log || []) {
    const item=document.createElement('li');
    item.textContent=`${new Date(entry.time).toLocaleTimeString()} · ${entry.status}: ${entry.detail}`;
    entries.appendChild(item);
  }
  $('logEmpty').hidden=!!state?.log?.length;
  $('shipName').textContent = active || other ? (state.product || state.title || 'Selected ship') : (selectedTab?.title || 'Open an RSI ship page');
  const image = state?.image;
  if (image && (active || other || state.tabId === selectedTab?.id)) {
    $('shipImage').src = image; $('shipImage').style.display='block'; $('imagePlaceholder').style.display='none';
  } else { $('shipImage').style.display='none'; $('imagePlaceholder').style.display='block'; }
}
$('toggle').addEventListener('click', async () => {
  $('toggle').disabled=true;
  try {
    if (state?.active) await call({type:'stop'});
    else {
      const interval=Number($('interval').value);
      if (!Number.isInteger(interval)||interval<1||interval>86400000) throw new Error('Enter an interval from 1 to 86400000 milliseconds.');
      const result=await call({type:'start',tabId:selectedTab?.id,interval,checkSignIn:$('signIn').checked,autoOrder:$('autoOrder').checked,dryRun:$('dryRun').checked});
      if (!result.ok) throw new Error(result.error);
    }
    await refresh();
  } catch(e) { $('status').textContent='Needs attention'; $('detail').textContent=e.message; }
  finally { $('toggle').disabled=false; }
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.monitor) refresh().catch(()=>{});});
refresh().catch(e=>{$('detail').textContent=e.message;});
