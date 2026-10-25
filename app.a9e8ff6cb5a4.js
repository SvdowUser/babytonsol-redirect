const API='https://babyt-wallet-review.svdowuser.deno.net/api/dashboard';
const MINT='Bo3sVJY52FNDBxT3uDN92FcL277fXriy1Un7dXuQpump';
const $=id=>document.getElementById(id);
const usd=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const number=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('en-US').format(value):'—';
let latest=null,fetching=false,cooldownUntil=0;
function ago(timestamp){const elapsed=Date.now()-Date.parse(timestamp);if(!Number.isFinite(elapsed))return'unknown';const mins=Math.max(0,Math.floor(elapsed/60000));return mins<1?'just now':mins<60?`${mins} min ago`:`${Math.floor(mins/60)}h ${mins%60}m ago`;}
function units(raw,decimals=9){if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isInteger(decimals)||decimals<0||decimals>18)return null;const padded=raw.padStart(decimals+1,'0'),whole=decimals?padded.slice(0,-decimals):padded,fraction=decimals?padded.slice(-decimals).replace(/0+$/,''):'';return whole+(fraction?'.'+fraction:'');}
function status(text,warning=false){$('connection-status').textContent=text;$('connection-status').classList.toggle('warning',warning);}
function rawAmount(raw,approx){const native=units(raw);return native===null?'—':`${native} SOL${Number.isFinite(approx)?' · ≈ '+usd(approx):''}`;}
function render(data){const m=data.monitoring,f=data.fees??{};
  const feeObserved=f.status==='observed'&&f.vaultsStatus==='observed';
  status(feeObserved&&!f.stale?'30 min updates':f.stale?'Old report':'Unavailable',!feeObserved||f.stale);
  $('last-checked').textContent=f.checkedAt?`Fees checked ${ago(f.checkedAt)}`:'Waiting for the first fee report';
  $('last-checked').title=f.checkedAt?new Date(f.checkedAt).toLocaleString():'';
  $('setup-message').textContent=data.automation?.claimingEnabled?'Auto-claim is armed. Holder payouts and buybacks are still in setup.':'Claims and automatic payouts are not active yet.';
  $('holder-count').textContent=number(m?.holders);$('checked-count').textContent=number(m?.scannedWallets);$('checked-total').textContent=` / ${number(m?.holders)}`;
  if(m)$('history-detail').textContent=`${number(m.limitedHistoryWallets)} observed wallets have limited history.${m.scanInterrupted?' The latest pass was interrupted.':''}`;
  // Only funds already in the creator vaults belong in the claimable balance.
  // Pending curve/pool fees are a separate source, shown in Details.
  const raw=f.creatorVaultsClaimableRaw,priceFresh=Number.isFinite(Date.parse(f.priceCheckedAt))&&Date.now()-Date.parse(f.priceCheckedAt)<75*60000;
  const hasBalance=f.status==='observed'&&f.vaultsStatus==='observed'&&!f.stale&&units(raw)!==null;
  const total=hasBalance&&priceFresh&&Number.isFinite(f.creatorVaultsClaimableUsd)&&f.creatorVaultsClaimableUsd>=0?f.creatorVaultsClaimableUsd:null;
  $('unclaimed-balance').replaceChildren();
  if(total!==null){$('unclaimed-balance').append(Object.assign(document.createElement('span'),{className:'approx',textContent:'≈'}),document.createTextNode(usd(total)));$('native-balance').textContent=units(raw)+' SOL';}
  else if(hasBalance){$('unclaimed-balance').textContent='—';$('native-balance').textContent=units(raw)+' SOL · USD quote unavailable';}
  else{$('unclaimed-balance').textContent='—';$('native-balance').textContent=f.vaultsStatus==='unavailable'?'Fee vault observation unavailable':'Checking fee vaults';}
  $('vault-amount').textContent=rawAmount(f.creatorVaultsClaimableRaw,priceFresh?f.creatorVaultsClaimableUsd:null);
  $('accrued-amount').textContent=rawAmount(f.tokenFeesAwaitingSweepRaw,priceFresh?f.tokenFeesAwaitingSweepUsd:null);
  $('fee-note').textContent='Creator vault balance only. Pending pool fees are shown separately in Details. USD values are estimates.';
  const threshold=data.plan?.claimThresholdUsd;$('threshold-label').textContent=Number.isFinite(threshold)?usd(threshold):'Not set';
  const hasProgress=total!==null&&Number.isFinite(threshold)&&threshold>0;
  $('claim-progress').classList.toggle('unknown',!hasProgress);
  if(hasProgress){$('claim-progress-fill').style.width=Math.min(100,total/threshold*100)+'%';$('claim-progress').setAttribute('aria-valuenow',String(total));$('claim-progress').setAttribute('aria-valuemax',String(threshold));$('claim-progress').setAttribute('aria-valuetext',`Approximately ${usd(total)} of ${usd(threshold)} in creator fee vaults`);$('claim-progress-caption').textContent=total>=threshold?'Threshold reached · claiming is still in setup':`${usd(Math.max(0,threshold-total))} to the proposed threshold`;}
  else{$('claim-progress-fill').style.width='0';$('claim-progress').removeAttribute('aria-valuenow');$('claim-progress').removeAttribute('aria-valuemax');$('claim-progress').setAttribute('aria-valuetext','Current USD balance unavailable');$('claim-progress-caption').textContent='Progress available with a current USD balance';}
  for(const [id,address]of[['pump-vault-link',f.pumpCreatorVaultAddress],['amm-vault-link',f.ammCreatorVaultAddress]]){const valid=typeof address==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);$(id).hidden=!valid;if(valid)$(id).href='https://solscan.io/account/'+address;}
  const claim=data.claiming;const labels={disabled:'Auto-claim is not activated.',below_threshold:'Auto-claim is armed and waiting for the threshold.',signer_configuration_needed:'Auto-claim is waiting for its separate gas wallet.',submitted:'A fee claim was submitted and is awaiting confirmation.',pending_confirmation:'A fee claim is awaiting confirmation.',confirmed:'The latest fee claim is confirmed.',gas_funding_needed:'The gas wallet needs SOL for network costs.',confirmed_receipt_unavailable:'The last claim needs receipt reconciliation.'};$('claim-status').textContent=labels[claim?.status]??'Auto-claim setup is pending.';
  const split=data.plan?.splitBps;if(split&&[split.holders,split.buybacks,split.creator].every(Number.isInteger)&&split.holders+split.buybacks+split.creator===10000){$('holders-split').textContent=split.holders/100+'%';$('buybacks-split').textContent=split.buybacks/100+'%';$('creator-split').textContent=split.creator/100+'%';}
}
async function refresh(manual=false){if(fetching||manual&&Date.now()<cooldownUntil)return;fetching=true;$('refresh').disabled=true;
  try{const response=await fetch(API,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Unavailable');const data=await response.json();if(data.schemaVersion!==1||data.mint!==MINT||!['read_only','auto_claim'].includes(data.mode))throw Error('Unexpected report');latest=data;render(data);renderActivity();}
  catch{status(latest?'Last report':'Offline',true);$('setup-message').textContent='Live reports are unavailable. Claims and payouts are still in setup.';if(!latest)$('last-checked').textContent='No current report available';}
  finally{fetching=false;cooldownUntil=Date.now()+5000;setTimeout(()=>{$('refresh').disabled=false;},5000);}}
$('refresh').addEventListener('click',()=>refresh(true));
$('copy-mint').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(MINT);$('copy-status').textContent='Address copied.';}catch{$('copy-status').textContent=MINT;}});
let activeTab='distributions';
const empty={distributions:'No rewards recorded here yet.',buybacks:'No buybacks recorded here yet.',claims:'No fee claims recorded here yet.'},tabs=[...document.querySelectorAll('[role=tab]')];
function selectTab(tab){activeTab=tab.dataset.tab;tabs.forEach(item=>{const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;});$('activity-panel').setAttribute('aria-labelledby',tab.id);renderActivity();}
function renderActivity(){
  const list=$('activity-list');list.replaceChildren();
  const rows=(latest?.ledger?.[activeTab]??[]).filter(row=>row.status==='confirmed'&&typeof row.signature==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(row.signature)&&units(row.amountRaw)!==null);
  $('activity-empty-state').hidden=rows.length>0;list.hidden=rows.length===0;
  $('empty-description').textContent=empty[activeTab];
  for(const row of rows){const link=document.createElement('a');link.className='claim-row';link.href='https://solscan.io/tx/'+row.signature;link.target='_blank';link.rel='noopener noreferrer';
    const label=document.createElement('span');label.textContent='Fee claim';const date=document.createElement('small');date.textContent=Number.isFinite(Date.parse(row.confirmedAt))?new Date(row.confirmedAt).toLocaleString():'Confirmed';label.append(date);
    const value=document.createElement('strong');value.textContent=units(row.amountRaw)+' SOL / WSOL ↗';link.append(label,value);list.append(link);}
}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectTab(tabs[next]);tabs[next].focus();});});
refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},10*60*1000);
