(() => {
  'use strict';
  const MINT='Bo3sVJY52FNDBxT3uDN92FcL277fXriy1Un7dXuQpump';
  const POOL='5fuRHZJfb6rBesKCTZECYT1t9uEidvCZ53YFbWc3xn8N';
  const SOL='So11111111111111111111111111111111111111112';
  const DEX='https://api.dexscreener.com/latest/dex/pairs/solana/'+POOL;
  const GECKO='https://api.geckoterminal.com/api/v2/networks/solana/pools/'+POOL+'/ohlcv/';
  const LINK='https://dexscreener.com/solana/'+POOL;
  const $=id=>document.getElementById(id);
  const ranges={ '1h':{timeframe:'minute',aggregate:1,limit:60,seconds:3600,change:'h1'}, '6h':{timeframe:'minute',aggregate:5,limit:72,seconds:21600,change:'h6'}, '1d':{timeframe:'minute',aggregate:15,limit:96,seconds:86400,change:'h24'}, '7d':{timeframe:'hour',aggregate:1,limit:168,seconds:604800,change:null} };
  let market=null,chart=null,series=null,range='1d',request=0;
  const cache=new Map();
  const cacheKey='babyt-chart-v1:'+POOL+':';
  function cached(key){
    const memory=cache.get(key);if(memory&&Date.now()-memory.at<120000)return memory;
    try{const saved=JSON.parse(localStorage.getItem(cacheKey+key));const age=Date.now()-saved?.at;if(saved&&Number.isFinite(age)&&age>=0&&age<120000)return saved;}catch{}
    return null;
  }
  function saveCache(key,data){const saved={at:Date.now(),data};cache.set(key,saved);try{localStorage.setItem(cacheKey+key,JSON.stringify(saved));}catch{}}
  const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  function money(n,compact=true){return valid(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:compact?'compact':'standard',maximumFractionDigits:compact?2:Math.abs(n)<0.01?9:2}).format(n):'—';}
  function change(id,n){const e=$(id);e.classList.remove('positive','negative');e.textContent=Number.isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'%':'—';if(Number.isFinite(n))e.classList.add(n>=0?'positive':'negative');}
  async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(14000)});if(!r.ok)throw new Error('Data unavailable ('+r.status+')');return r.json();}
  function metricHeader(){
    if(!market)return;
    $('market-cap').textContent=money(market.cap);$('market-price').textContent=money(market.price,false);$('market-volume').textContent=money(market.volume);change('market-change',market.changes.h24);
    $('chart-value').textContent=money(market.cap??market.price,market.cap!==null);
    $('chart-context').textContent=market.cap!==null?'Market cap estimate':'BabyT price · USD';
    const key=ranges[range].change;change('chart-change',key?market.changes[key]:null);
    $('market-status').textContent='Market data · Dexscreener';
    $('market-status').title='Retrieved '+new Date(market.at).toLocaleString();
  }
  async function loadMarket(){
    try{
      const data=await json(DEX);
      const p=data.pairs?.find(p=>p.chainId==='solana'&&p.pairAddress===POOL&&p.baseToken?.address===MINT&&p.quoteToken?.address===SOL);
      if(!p||!Number.isFinite(Number(p.priceUsd))||Number(p.priceUsd)<=0)throw new Error('Wrong market');
      market={price:Number(p.priceUsd),cap:valid(p.marketCap)&&p.marketCap>0?p.marketCap:null,volume:valid(p.volume?.h24)?p.volume.h24:null,changes:p.priceChange??{},at:Date.now()};
      metricHeader();return true;
    }catch(error){
      console.warn('BabyT market data:',error.message);
      $('market-status').textContent=market?'Last market report':'Market data unavailable';
      return false;
    }
  }
  function createChart(){
    if(chart)return;
    const lib=window.LightweightCharts;if(!lib)throw new Error('Chart unavailable');
    chart=lib.createChart($('market-chart'),{
      autoSize:true,layout:{background:{type:lib.ColorType.Solid,color:'#ffffff'},textColor:'#6e7566',fontSize:10,fontFamily:'Arial, Helvetica, sans-serif',attributionLogo:true},
      grid:{vertLines:{visible:false},horzLines:{color:'#edece5',style:lib.LineStyle.Dotted}},
      rightPriceScale:{borderVisible:false,scaleMargins:{top:.08,bottom:.08}},
      timeScale:{borderVisible:false,timeVisible:true,secondsVisible:false,rightOffset:1,fixLeftEdge:true},
      crosshair:{mode:lib.CrosshairMode.Normal,vertLine:{color:'#c5cbb9',labelBackgroundColor:'#667d39'},horzLine:{color:'#c5cbb9',labelBackgroundColor:'#667d39'}},
      handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{axisPressedMouseMove:true,mouseWheel:false,pinch:true}
    });
    series=chart.addSeries(lib.AreaSeries,{lineColor:'#496310',topColor:'rgba(87,111,32,.21)',bottomColor:'rgba(87,111,32,0)',lineWidth:2,priceLineColor:'#496310',priceLineStyle:lib.LineStyle.Dotted,crosshairMarkerRadius:3,priceFormat:{type:'custom',formatter:n=>money(n,market?.cap!==null)}});
    chart.subscribeCrosshairMove(param=>{
      const point=param.seriesData?.get(series);
      if(point&&Number.isFinite(point.value))$('chart-value').textContent=money(point.value,market?.cap!==null);
      else metricHeader();
    });
  }
  function chartMessage(text){
    const message=$('chart-message');message.hidden=false;message.replaceChildren();
    message.append(Object.assign(document.createElement('span'),{textContent:text}));
    message.append(Object.assign(document.createElement('a'),{href:LINK,target:'_blank',rel:'noopener noreferrer',textContent:'Open Dexscreener'}));
  }
  async function loadChart(next=range){
    range=next;const token=++request;
    document.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.range===range)));
    $('chart-message').hidden=false;$('chart-message').textContent='Loading BabyT chart…';metricHeader();
    try{
      const cfg=ranges[range],saved=cached(range);
      let data=saved&&Date.now()-saved.at<120000?saved.data:null;
      if(!data){data=await json(GECKO+cfg.timeframe+'?aggregate='+cfg.aggregate+'&limit='+cfg.limit+'&currency=usd&token=base');}
      if(token!==request)return;
      if(data.meta?.base?.address!==MINT||data.meta?.quote?.address!==SOL)throw new Error('Wrong market history');
      const rows=data.data?.attributes?.ohlcv_list;
      if(!Array.isArray(rows))throw new Error('No history');
      if(!saved)saveCache(range,data);
      const now=Date.now()/1000,multiplier=market?.cap!==null&&market?.price>0?market.cap/market.price:1;
      const points=[...new Map(rows.filter(r=>Array.isArray(r)&&Number.isInteger(r[0])&&r[0]<=now+60&&r[0]>=now-cfg.seconds&&Number.isFinite(r[4])&&r[4]>0).map(r=>[r[0],{time:r[0],value:r[4]*multiplier}])).values()].sort((a,b)=>a.time-b.time);
      if(points.length<2){chartMessage('Not enough trades in this period. Try a longer range.');$('market-status').textContent='Chart · GeckoTerminal';return;}
      createChart();series.setData(points);chart.timeScale().fitContent();$('chart-message').hidden=true;
      $('market-status').textContent='Prices · GeckoTerminal';
      if(range==='7d')change('chart-change',(points.at(-1).value/points[0].value-1)*100);
    }catch(error){if(token===request){console.warn('BabyT chart:',error.message);chartMessage('Chart data is temporarily unavailable.');$('market-status').textContent='Try another period or check back shortly';}}
  }
  document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>loadChart(b.dataset.range)));
  loadMarket().then(()=>loadChart());
  setInterval(()=>{if(document.visibilityState==='visible')loadMarket().then(()=>loadChart());},120000);
})();
