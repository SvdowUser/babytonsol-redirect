const API='https://babyt-wallet-review.svdowuser.deno.net/api/dashboard';
const MINT='Bo3sVJY52FNDBxT3uDN92FcL277fXriy1Un7dXuQpump';
const $=id=>document.getElementById(id);
const number=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('en-US').format(value):'—';
let latest=null,fetching=false,cooldownUntil=0;
function ago(timestamp){const elapsed=Date.now()-Date.parse(timestamp);if(!Number.isFinite(elapsed))return'unknown';const mins=Math.max(0,Math.floor(elapsed/60000));return mins<1?'just now':mins<60?`${mins} min ago`:`${Math.floor(mins/60)}h ${mins%60}m ago`;}
function units(raw,decimals=9){if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isInteger(decimals)||decimals<0||decimals>18)return null;const padded=raw.padStart(decimals+1,'0'),whole=decimals?padded.slice(0,-decimals):padded,fraction=decimals?padded.slice(-decimals).replace(/0+$/,''):'';return whole+(fraction?'.'+fraction:'');}
function status(text,warning=false){$('connection-status').textContent=text;$('connection-status').classList.toggle('warning',warning);}
function totalAmount(raw){const value=units(raw);if(value===null)return'—';const [whole,fraction='']=value.split('.');const grouped=new Intl.NumberFormat('en-US').format(BigInt(whole));if(fraction.length<=4)return grouped+(fraction?'.'+fraction:'');if(whole==='0'&&fraction.slice(0,4)==='0000')return'<0.0001';return'≈ '+grouped+'.'+fraction.slice(0,4);}
function balanceAmount(raw){
  if(units(raw)===null)return null;
  const amount=BigInt(raw),step=10000n;
  if(amount>0n&&amount<step/2n)return {value:'<0.00001',approx:false};
  const rounded=(amount+step/2n)/step*step;
  return {value:units(rounded.toString()),approx:rounded!==amount};
}
function quoteSol(value){
  if(!Number.isFinite(value)||value<0)return '—';
  if(value>0&&value<0.00001)return '<0.00001 SOL';
  return '≈ '+new Intl.NumberFormat('en-US',{maximumFractionDigits:5}).format(value)+' SOL';
}
function render(data){const m=data.monitoring,f=data.fees??{};
  const auto=data.automation??{},badge=document.querySelector('.setup-badge');
  if(badge){badge.textContent=auto.claimingEnabled&&auto.buybacksEnabled?'Automation enabled':auto.claimingEnabled?'Auto-claim enabled':auto.buybacksEnabled?'Buybacks enabled':'Automation paused';badge.dataset.state=auto.claimingEnabled||auto.buybacksEnabled?'enabled':'warning';}
  const feeObserved=f.status==='observed'&&f.vaultsStatus==='observed';
  status(feeObserved&&!f.stale?'Latest report':f.stale?'Report outdated':'Data unavailable',!feeObserved||f.stale);
  $('last-checked').textContent=f.checkedAt?`Updated ${ago(f.checkedAt)}`:'Awaiting first report';
  $('last-checked').title=f.checkedAt?new Date(f.checkedAt).toLocaleString():'';
  $('setup-message').textContent=data.automation?.claimingEnabled?(data.automation?.buybacksEnabled?'Auto-claim and buybacks are enabled.':'Auto-claim is enabled. Buybacks are still in setup.'):'Auto-claim and buybacks are not active yet.';
  const policy=data.plan?.holderRewardPolicy;
  if(policy&&typeof policy.minHoldingTokens==='string'&&/^\d+$/.test(policy.minHoldingTokens)&&Number.isSafeInteger(policy.maxGroupRewardBps)){
    const minimum=new Intl.NumberFormat('en-US').format(BigInt(policy.minHoldingTokens));
    $('holder-rules').textContent=`Hold at least ${minimum} BabyT. Rewards are paid in SOL, with a ${policy.maxGroupRewardBps/100}% limit per holder or known linked wallet group in each rewards round.`;
  }
  $('creator-wallet-status').textContent=data.setup?.creatorWallet?.keyVerified?'Creator fee wallet verified.':'Creator fee wallet setup is pending.';
  $('holder-count').textContent=number(m?.holders);$('checked-count').textContent=number(m?.scannedWallets);$('checked-total').textContent=` / ${number(m?.holders)}`;
  if(m)$('history-detail').textContent=`${number(m.limitedHistoryWallets)} observed wallets have limited history.${m.scanInterrupted?' The latest pass was interrupted.':''}`;
  // Display native SOL directly. Only the threshold conversion needs a fresh price.
  const raw=f.creatorVaultsClaimableRaw;
  const hasBalance=feeObserved&&!f.stale&&units(raw)!==null;
  const native=hasBalance?Number(units(raw)):null;
  const priceAge=Date.now()-Date.parse(f.priceCheckedAt);
  const priceFresh=Number.isFinite(priceAge)&&priceAge>=0&&priceAge<75*60000;
  const price=priceFresh&&Number.isFinite(f.quotePriceUsd)&&f.quotePriceUsd>0?f.quotePriceUsd:null;
  const thresholdUsd=data.plan?.claimThresholdUsd;
  const thresholdQuote=price!==null&&Number.isFinite(thresholdUsd)&&thresholdUsd>0?thresholdUsd/price:null;
  const thresholdSol=Number.isFinite(thresholdQuote)&&thresholdQuote>0?thresholdQuote:null;
  const amount=$('unclaimed-balance');amount.replaceChildren();amount.removeAttribute('title');
  if(hasBalance){
    const display=balanceAmount(raw);
    if(display.approx)amount.append(Object.assign(document.createElement('span'),{className:'approx',textContent:'≈'}));
    amount.append(document.createTextNode(display.value),Object.assign(document.createElement('span'),{className:'amount-unit',textContent:'SOL'}));
    amount.title=units(raw)+' SOL';
    $('native-balance').textContent='From BabyT trading fees';
  }else{
    amount.textContent='—';
    $('native-balance').textContent=f.stale?'Waiting for a fresh balance':'Balance unavailable';
  }
  $('vault-amount').textContent=hasBalance?units(raw)+' SOL':'Not currently available';
  $('fee-note').textContent='All amounts are shown in SOL. The claim threshold is converted at the latest exchange rate and may change with the SOL price.';
  $('threshold-label').textContent=thresholdSol!==null?quoteSol(thresholdSol):'— SOL';
  $('threshold-label').title=thresholdSol!==null?thresholdSol.toFixed(9)+' SOL at the latest exchange rate':'';
  const hasProgress=native!==null&&Number.isFinite(native)&&thresholdSol!==null;
  $('claim-progress').classList.toggle('unknown',!hasProgress);
  if(hasProgress){
    $('claim-progress-fill').style.width=Math.min(100,native/thresholdSol*100)+'%';
    $('claim-progress').setAttribute('aria-valuenow',String(Math.min(native,thresholdSol)));
    $('claim-progress').setAttribute('aria-valuemax',String(thresholdSol));
    $('claim-progress').setAttribute('aria-valuetext',`${units(raw)} SOL of a threshold of ${quoteSol(thresholdSol)}`);
    $('claim-progress-caption').textContent=native>=thresholdSol?(auto.claimingEnabled?'Ready for the next check':'Threshold reached · auto-claim paused'):`${quoteSol(Math.max(0,thresholdSol-native))} to go`;
  }else{
    $('claim-progress-fill').style.width='0';
    $('claim-progress').removeAttribute('aria-valuenow');$('claim-progress').removeAttribute('aria-valuemax');
    $('claim-progress').setAttribute('aria-valuetext','Current progress unavailable');
    $('claim-progress-caption').textContent=hasBalance?'Threshold quote unavailable':'Waiting for a current balance';
  }
  for(const [id,address]of[['pump-vault-link',f.pumpCreatorVaultAddress],['amm-vault-link',f.ammCreatorVaultAddress]]){const valid=typeof address==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);$(id).hidden=!valid;if(valid)$(id).href='https://solscan.io/account/'+address;}
  const claim=data.claiming;const labels={awaiting_first_check:'Auto-claim is enabled. Waiting for its first check.',disabled:'Auto-claim is not activated.',below_threshold:'Auto-claim is waiting for the threshold.',signer_configuration_needed:'Creator fee wallet setup is pending.',submitted:'A fee claim was submitted and is awaiting confirmation.',pending_confirmation:'A fee claim is awaiting confirmation.',confirmed:'The latest fee claim is confirmed.',gas_funding_needed:'The fee wallet needs SOL for network costs.',confirmed_receipt_unavailable:'The last claim needs receipt reconciliation.'};$('claim-status').textContent=labels[claim?.status]??'Auto-claim setup is pending.';
  for(const [id,key]of[['total-claimed','claimedRaw'],['total-buybacks','buybackSpentRaw']]){const raw=data.ledger?.funding?.[key];$(id).textContent=totalAmount(raw);$(id).title=units(raw)!==null?units(raw)+' SOL':'';}
  const split=data.plan?.splitBps;if(split&&[split.holders,split.buybacks,split.creator].every(Number.isInteger)&&split.holders+split.buybacks+split.creator===10000){$('holders-split').textContent=split.holders/100+'%';$('buybacks-split').textContent=split.buybacks/100+'%';$('creator-split').textContent=split.creator/100+'%';}
}
async function refresh(manual=false){if(fetching||manual&&Date.now()<cooldownUntil)return;fetching=true;$('refresh').disabled=true;
  try{const response=await fetch(API,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Unavailable');const data=await response.json();if(data.schemaVersion!==1||data.mint!==MINT||!['read_only','auto_claim'].includes(data.mode))throw Error('Unexpected report');latest=data;render(data);renderActivity();}
  catch{status(latest?'Last report':'Offline',true);const badge=document.querySelector('.setup-badge');if(badge){badge.textContent='Status unavailable';badge.dataset.state='warning';}$('setup-message').textContent='Live reports are unavailable. Automatic activity cannot be verified.';if(!latest){$('last-checked').textContent='No current report';$('empty-description').textContent='Activity unavailable';$('empty-hint').textContent='Try refreshing in a moment.';}}
  finally{fetching=false;cooldownUntil=Date.now()+5000;setTimeout(()=>{$('refresh').disabled=false;},5000);}}
$('refresh').addEventListener('click',()=>refresh(true));
$('copy-mint').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(MINT);$('copy-status').className='sr-only';$('copy-status').textContent='Address copied.';$('copy-label').textContent='Copied';setTimeout(()=>{$('copy-label').textContent='Copy';},2500);}catch{$('copy-status').textContent=MINT;$('copy-status').className='copy-fallback';$('copy-label').textContent='Address shown';}});
let activeTab='buybacks';
const empty={buybacks:'No buybacks yet',claims:'No claims yet'},tabs=[...document.querySelectorAll('[role=tab]')];
function selectTab(tab){activeTab=tab.dataset.tab;tabs.forEach(item=>{const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;});$('activity-panel').setAttribute('aria-labelledby',tab.id);renderActivity();}
function renderActivity(){
  const list=$('activity-list');list.replaceChildren();
  if(!latest){$('activity-empty-state').hidden=false;list.hidden=true;$('empty-description').textContent=fetching?'Loading activity…':'Activity unavailable';$('empty-hint').textContent='Confirmed transactions appear here.';return;}
  const rows=(latest?.ledger?.[activeTab]??[]).filter(row=>row.status==='confirmed'&&typeof row.signature==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(row.signature)&&units(row.amountRaw)!==null);
  $('activity-empty-state').hidden=rows.length>0;list.hidden=rows.length===0;
  $('empty-description').textContent=empty[activeTab];$('empty-hint').textContent=activeTab==='buybacks'?'Confirmed buybacks will appear here.':'Confirmed fee claims will appear here.';
  for(const row of rows){const link=document.createElement('a');link.className='claim-row';link.href='https://solscan.io/tx/'+row.signature;link.target='_blank';link.rel='noopener noreferrer';
    const label=document.createElement('span');label.textContent={claims:'Fee claim',buybacks:'BabyT buyback'}[activeTab];const date=document.createElement('small');date.textContent=Number.isFinite(Date.parse(row.confirmedAt))?new Date(row.confirmedAt).toLocaleString():'Confirmed';label.append(date);
    const value=document.createElement('strong');value.textContent=units(row.amountRaw)+' SOL ↗';link.append(label,value);list.append(link);}
}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectTab(tabs[next]);tabs[next].focus();});});
refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},10*60*1000);
