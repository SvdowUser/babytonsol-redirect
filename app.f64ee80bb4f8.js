const API='https://babyt-wallet-review.svdowuser.deno.net/api/dashboard';
const MINT='Bo3sVJY52FNDBxT3uDN92FcL277fXriy1Un7dXuQpump';
const $=id=>document.getElementById(id);
const FEE_MAX_AGE_MS=12*60000;
function claimable(f){return f?.status==='observed'&&f.vaultsStatus==='observed'&&!f.stale&&fresh(Date.parse(f.checkedAt),FEE_MAX_AGE_MS)&&units(f.creatorVaultsClaimableRaw)!==null;}
const number=value=>Number.isSafeInteger(value)?new Intl.NumberFormat('en-US').format(value):'—';
let latest=null,fetching=false,cooldownUntil=0,marketQuote=null,activeTab='rewards';
function ago(timestamp){const ms=Date.now()-Date.parse(timestamp);if(!Number.isFinite(ms))return'unknown';const m=Math.max(0,Math.floor(ms/60000));return m<1?'just now':m<60?`${m} min ago`:`${Math.floor(m/60)}h ${m%60}m ago`;}
function units(raw,decimals=9){if(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isInteger(decimals)||decimals<0||decimals>18)return null;const p=raw.padStart(decimals+1,'0'),whole=decimals?p.slice(0,-decimals):p,f=decimals?p.slice(-decimals).replace(/0+$/,''):'';return whole+(f?'.'+f:'');}
function totalAmount(raw){const v=units(raw);if(v===null)return'—';const [w,f='']=v.split('.'),g=new Intl.NumberFormat('en-US').format(BigInt(w));if(f.length<=5)return g+(f?'.'+f:'');if(w==='0'&&f.slice(0,5)==='00000')return'<0.00001';const rounded=units(String(((BigInt(raw)+5000n)/10000n)*10000n)),[rw,rf='']=rounded.split('.');return'≈ '+new Intl.NumberFormat('en-US').format(BigInt(rw))+(rf?'.'+rf:'');}
function amountAt(id,raw){$(id).textContent=totalAmount(raw);$(id).title=units(raw)!==null?units(raw)+' SOL':'';}
function status(text,warning=false){$('connection-status').textContent=text;$('connection-status').classList.toggle('warning',warning);}
function fresh(at,age=5*60000){const n=Date.now()-at;return Number.isFinite(n)&&n>=0&&n<=age;}
function solPrice(){if(marketQuote&&fresh(marketQuote.checkedAt)&&marketQuote.solPriceUsd>0)return marketQuote.solPriceUsd;const f=latest?.fees;return fresh(Date.parse(f?.priceCheckedAt),12*60000)&&Number.isFinite(f?.quotePriceUsd)&&f.quotePriceUsd>0?f.quotePriceUsd:null;}
function usd(raw){const p=solPrice(),v=units(raw);if(p===null||v===null)return'—';const n=Number(v)*p;return Number.isFinite(n)?'≈ '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n):'—';}
function quoteSol(v){return Number.isFinite(v)&&v>=0?'≈ '+new Intl.NumberFormat('en-US',{maximumFractionDigits:5}).format(v)+' SOL':'— SOL';}
function renderValueQuotes(){
  const policy=latest?.plan?.holderRewardPolicy,min=Number(policy?.minHoldingUsd??20);
  $('minimum-usd').textContent='$'+min;
  let tokens=null;
  if(marketQuote&&fresh(marketQuote.checkedAt)&&marketQuote.tokenPriceUsd>0)tokens=Math.ceil(min/marketQuote.tokenPriceUsd);
  else if(policy?.priceStatus==='fresh'&&/^\d+$/.test(policy.minimumWholeTokens??'')&&fresh(Date.parse(latest?.fees?.priceCheckedAt)))tokens=Number(policy.minimumWholeTokens);
  $('minimum-tokens').textContent=Number.isSafeInteger(tokens)?'≈ '+number(tokens)+' BabyT':'Token quote unavailable';
  $('minimum-tokens').title='Indicative token amount. The server checks the $'+min+' minimum again using a fresh price before paying.';
  const funding=latest?.ledger?.funding??{},f=latest?.fees,raw=claimable(f)?f.creatorVaultsClaimableRaw:null;
  for(const [id,value]of[['total-paid-usd',funding.paidHoldersRaw],['earned-usd',funding.claimedRaw],['unclaimed-usd',raw],['owed-usd',funding.owedHoldersRaw]])$(id).textContent=usd(value);
  $('native-balance').textContent=raw!==null?usd(raw):'Waiting for a fresh balance';
  const price=solPrice();$('sol-price-caption').textContent=price===null?'Current SOL price unavailable':'1 SOL ≈ '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(price);
}
function drawSplit(split){
  const values=[split.holders,split.buybacks,split.creator];if(!values.every(n=>Number.isInteger(n)&&n>=0)||values.reduce((a,b)=>a+b,0)!==10000)return;
  const canvas=$('split-chart'),ctx=canvas.getContext('2d');if(!ctx)return;ctx.clearRect(0,0,1100,16);
  const colors=['#496310','#91b29d','#6e6b65'];let x=0;
  values.forEach((v,i)=>{const width=v/10000*1100;ctx.fillStyle=colors[i];ctx.beginPath();ctx.roundRect(x+(i?2:0),0,Math.max(0,width-(i?2:0)-(i<2?2:0)),16,8);ctx.fill();x+=width;});
  canvas.setAttribute('aria-label',`Allocation after costs: ${values[0]/100}% holders, ${values[1]/100}% buybacks, ${values[2]/100}% protocol`);
  ['holders','buybacks','creator'].forEach(k=>$(k+'-split').textContent=split[k]/100+'%');
}
function render(data){
  const f=data.fees??{},auto=data.automation??{},badge=document.querySelector('.setup-badge');
  badge.textContent=auto.claimingEnabled&&auto.buybacksEnabled?'Automation enabled':auto.claimingEnabled?'Auto-claim enabled':'Automation paused';badge.dataset.state=auto.claimingEnabled||auto.buybacksEnabled?'enabled':'warning';
  const observed=f.status==='observed'&&f.vaultsStatus==='observed',hasBalance=claimable(f),raw=f.creatorVaultsClaimableRaw;
  status(hasBalance?'Latest report':observed?'Report outdated':'Data unavailable',!hasBalance);
  $('last-checked').textContent=f.checkedAt?`Updated ${ago(f.checkedAt)}`:'Awaiting first report';$('last-checked').title=f.checkedAt?new Date(f.checkedAt).toLocaleString():'';
  $('holder-count').textContent=number(data.monitoring?.holders);
  const balance=$('unclaimed-balance');balance.replaceChildren();balance.removeAttribute('title');
  if(hasBalance){balance.append(document.createTextNode(units(raw)),Object.assign(document.createElement('span'),{className:'amount-unit',textContent:'SOL'}));balance.title=units(raw)+' SOL';}
  else balance.textContent='—';
  $('native-balance').textContent=hasBalance?'From BabyT trading fees':f.stale?'Waiting for a fresh balance':'Balance unavailable';
  amountAt('rewards-unclaimed',hasBalance?raw:null);
  const price=solPrice();
  const threshold=price&&Number.isFinite(data.plan?.claimThresholdUsd)&&data.plan.claimThresholdUsd>0?data.plan.claimThresholdUsd/price:null,native=hasBalance?Number(units(raw)):null;
  $('threshold-label').textContent=quoteSol(threshold);$('threshold-label').title=threshold!==null?threshold.toFixed(9)+' SOL at the latest exchange rate':'';
  const progress=native!==null&&threshold!==null&&Number.isFinite(native),el=$('claim-progress');el.classList.toggle('unknown',!progress);
  if(progress){$('claim-progress-fill').style.width=Math.min(100,native/threshold*100)+'%';el.setAttribute('aria-valuenow',String(Math.min(native,threshold)));el.setAttribute('aria-valuemax',String(threshold));el.setAttribute('aria-valuetext',`${units(raw)} SOL of ${quoteSol(threshold)}`);$('claim-progress-caption').textContent=native>=threshold?(auto.claimingEnabled?'Ready for the next check':'Threshold reached · auto-claim paused'):quoteSol(threshold-native)+' to go';}
  else{$('claim-progress-fill').style.width='0';el.removeAttribute('aria-valuenow');el.removeAttribute('aria-valuemax');el.setAttribute('aria-valuetext','Current progress unavailable');$('claim-progress-caption').textContent='Waiting for a current balance';}
  const labels={awaiting_first_check:'Auto-claim is enabled. Waiting for its first check.',disabled:'Auto-claim is not activated.',below_threshold:'Auto-claim is waiting for the threshold.',signer_configuration_needed:'Creator fee wallet setup is pending.',submitted:'A fee claim is awaiting confirmation.',pending_confirmation:'A fee claim is awaiting confirmation.',confirmed:'The latest fee claim is confirmed.',gas_funding_needed:'The fee wallet needs SOL for network costs.',confirmed_receipt_unavailable:'The last claim needs receipt reconciliation.'};
  $('claim-status').textContent=labels[data.claiming?.status]??'Waiting for the next auto-claim report.';
  const funding=data.ledger?.funding??{};
  for(const [id,key]of[['total-paid','paidHoldersRaw'],['total-claimed','claimedRaw'],['owed-holders','owedHoldersRaw'],['holders-allocated','allocatedHoldersRaw'],['buybacks-allocated','allocatedBuybacksRaw'],['creator-allocated','allocatedCreatorRaw']])amountAt(id,funding[key]);
  if(data.plan?.splitBps)drawSplit(data.plan.splitBps);
  const policy=data.plan?.holderRewardPolicy,minimum=policy?.minHoldingUsd??20,cap=Number.isInteger(policy?.maxGroupRewardBps)?policy.maxGroupRewardBps/100:1;
  $('holder-rules').textContent=`At least $${minimum} in BabyT. Each holder or known linked group is capped at ${cap}% of the holder budget per round. Flagged wallets stay on hold.`;
  renderValueQuotes();
}
async function refresh(manual=false){if(fetching||manual&&Date.now()<cooldownUntil)return;fetching=true;$('refresh').disabled=true;
  try{const response=await fetch(API,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Unavailable');const data=await response.json();if(data.schemaVersion!==1||data.mint!==MINT||!['read_only','auto_claim'].includes(data.mode))throw Error('Unexpected report');latest=data;render(data);renderActivity();}
  catch{status(latest?'Last report':'Offline',true);const badge=document.querySelector('.setup-badge');badge.textContent='Status unavailable';badge.dataset.state='warning';if(!latest){$('last-checked').textContent='No current report';$('empty-description').textContent='Activity unavailable';$('empty-hint').textContent='Try refreshing in a moment.';}}
  finally{fetching=false;cooldownUntil=Date.now()+5000;setTimeout(()=>{$('refresh').disabled=false;},5000);}}
$('refresh').addEventListener('click',()=>refresh(true));
$('copy-mint').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(MINT);$('copy-status').className='sr-only';$('copy-status').textContent='Address copied.';$('copy-label').textContent='Copied';$('copy-mint').querySelector('img').src='./assets/vendor/check.svg';setTimeout(()=>{$('copy-label').textContent='Copy';$('copy-mint').querySelector('img').src='./assets/vendor/copy.svg';},2500);}catch{$('copy-status').textContent=MINT;$('copy-status').className='copy-fallback';$('copy-label').textContent='Address shown';}});
const tabs=[...document.querySelectorAll('[role=tab]')];
function selectTab(tab){activeTab=tab.dataset.tab;tabs.forEach(t=>{const a=t===tab;t.setAttribute('aria-selected',String(a));t.tabIndex=a?0:-1;});$('activity-panel').setAttribute('aria-labelledby',tab.id);renderActivity();}
function renderActivity(){
  const list=$('activity-list');list.replaceChildren();
  if(!latest){$('activity-empty-state').hidden=false;list.hidden=true;return;}
  const daily=activeTab!=='buybacks',activity=latest.ledger?.activity;
  const rows=daily?(activity?.[activeTab]??[]).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.day)&&Number.isSafeInteger(r.count)&&r.count>0&&units(r.amountRaw)!==null):(latest.ledger?.buybacks??[]).filter(r=>r.status==='confirmed'&&/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(r.signature??'')&&units(r.amountRaw)!==null);
  $('activity-title').textContent={rewards:'Recent payouts',buybacks:'Recent buybacks',claims:'Recent claims'}[activeTab];
  $('activity-caption').textContent=daily?(activity?.coverageLimited?'Recent totals · history incomplete':'Last 72 hours · daily totals (UTC)'):'Latest confirmed buybacks';
  $('activity-empty-state').hidden=rows.length>0;list.hidden=rows.length===0;
  $('empty-description').textContent=daily&&(!activity||activity.coverageLimited)?'Activity summaries unavailable':{rewards:'No payouts in the last 72 hours',buybacks:'No buybacks yet',claims:'No claims in the last 72 hours'}[activeTab];
  $('empty-hint').textContent={rewards:'Confirmed SOL payments appear here.',buybacks:'Confirmed BabyT buybacks appear here.',claims:'Confirmed claims appear here.'}[activeTab];
  for(const row of rows){const item=document.createElement(daily?'div':'a');item.className='payout-row';if(!daily){item.href='https://solscan.io/tx/'+row.signature;item.target='_blank';item.rel='noopener noreferrer';}
    const icon=Object.assign(document.createElement('img'),{src:'./assets/solana-user-eda3ddbe.png',className:'sol-icon small',alt:'',width:24,height:24});
    const info=document.createElement('div'),amount=document.createElement('strong'),date=document.createElement('small');amount.textContent=totalAmount(row.amountRaw)+' SOL';amount.title=units(row.amountRaw)+' SOL';
    date.textContent=daily?`${number(row.count)} ${activeTab==='rewards'?'payments':'claims'} · ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(row.day+'T00:00:00Z'))}`:Number.isFinite(Date.parse(row.confirmedAt))?new Date(row.confirmedAt).toLocaleString():'Confirmed';info.append(amount,date);
    const value=document.createElement('span');value.className='payout-usd';value.textContent=usd(row.amountRaw)+(daily?'':' ↗');item.append(icon,info,value);list.append(item);
  }
}
tabs.forEach((tab,index)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(index+1)%tabs.length;else if(e.key==='ArrowLeft')n=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();selectTab(tabs[n]);tabs[n].focus();});});
window.addEventListener('babyt-market-quote',event=>{const q=event.detail;if(!q||!Number.isFinite(q.tokenPriceUsd)||q.tokenPriceUsd<=0||!fresh(q.checkedAt))return;marketQuote=q;if(latest)render(latest);else renderValueQuotes();renderActivity();});
drawSplit({holders:6250,buybacks:2000,creator:1750});refresh();setInterval(()=>{if(document.visibilityState==='visible'){if(latest)render(latest);else renderValueQuotes();renderActivity();}},30000);setInterval(()=>{if(document.visibilityState==='visible')refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
