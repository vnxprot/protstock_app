export type Metric = 'eps'|'eps_diluted'|'revenue'|'profit'|'profit_total'|'roe'
export type PeriodRow = { period:string; kind:'quarter'|'year'; year:number; quarter:number; labels?:Record<string,string> } & Partial<Record<Metric,number>>
export type Bar = {date:string;open:number;high:number;low:number;close:number;volume:number}
export type Snapshot = {symbol_id:number;financial:PeriodRow[];prices:Bar[];status:string;fetched_at:string|null;attempted_at:string;error?:string;overview?:import('./vciOverview').VciOverview;overview_error?:string|null}
export type Rule = {id:string;group:'C'|'A';enabled:boolean;metric:Metric;kind:'quarter'|'year'|'ttm';mode:'level'|'yoy'|'qoq'|'lag'|'cagr'|'points'|'turnaround';lag:number;op:'gte'|'gt'|'lte'|'lt'|'between';threshold:number;upper:number;period:string;count:number;required:number;positive:boolean}
export type SConfig = {enabled:boolean;mode:'base'|'breakout'|'either';base:number;depth:number;near:number;tight:number;range:number;contraction:number;dry:number;baseline:number;dryRatio:number;volume:number;volumeRatio:number;extended:number;closePosition:number;liquidity:number;liquidityWindow:number;upDown:boolean;upDownRatio:number;pullback:boolean;pullbackRatio:number}
export type Config = {rules:Rule[];s:SConfig;groupMode:'all'|'k';groupRequired:number;onlyMatches:boolean;view:'overview'|'growth'|'volume'|'valuation';presets:Record<string,{rules:Rule[];s:SConfig}>}
export type Verdict = 'PASS'|'FAIL'|'UNKNOWN'|'STALE'|'OFF'
export const metricLabels:Record<Metric,string>={eps:'EPS cơ bản',eps_diluted:'EPS pha loãng',revenue:'Doanh thu thuần',profit:'LNST cổ đông công ty mẹ',profit_total:'Tổng LNST',roe:'ROE'}
export const modeLabels:Record<Rule['mode'],string>={level:'Giá trị tuyệt đối',yoy:'Cùng kỳ năm trước · YoY',qoq:'Quý liền trước · QoQ',lag:'So với N kỳ trước',cagr:'CAGR · N năm',points:'Thay đổi điểm % · YoY',turnaround:'Chuyển lỗ thành lãi · YoY'}
const rule=(id:string,group:'C'|'A',metric:Metric,kind:Rule['kind'],mode:Rule['mode'],threshold:number,count=1):Rule=>({id,group,metric,kind,mode,threshold,count,required:count,enabled:true,lag:3,op:'gte',upper:100,period:'',positive:metric==='eps'})
export const defaultConfig=():Config=>({rules:[rule('c-eps','C','eps','quarter','yoy',25),rule('c-revenue','C','revenue','quarter','yoy',25),{...rule('c-profit','C','profit','quarter','yoy',25),enabled:false},rule('a-eps','A','eps','year','yoy',25,3),rule('a-roe','A','roe','year','level',17)],s:{enabled:true,mode:'either',base:50,depth:30,near:5,tight:10,range:8,contraction:.7,dry:10,baseline:40,dryRatio:.7,volume:50,volumeRatio:1.5,extended:5,closePosition:70,liquidity:3,liquidityWindow:20,upDown:false,upDownRatio:1.2,pullback:false,pullbackRatio:.8},groupMode:'all',groupRequired:1,onlyMatches:false,view:'overview',presets:{}})
export function validConfig(c:Config):boolean {
 return Boolean(c&&Array.isArray(c.rules)&&c.rules.length<=40&&c.s&&c.rules.every(r=>r.id&&['C','A'].includes(r.group)&&r.metric in metricLabels&&r.mode in modeLabels&&['quarter','year','ttm'].includes(r.kind)&&['gte','gt','lte','lt','between'].includes(r.op)&&[r.threshold,r.upper,r.lag,r.count,r.required].every(Number.isFinite)&&Number.isInteger(r.count)&&r.count>=1&&r.count<=12&&Number.isInteger(r.required)&&r.required>=1&&r.required<=r.count&&Number.isInteger(r.lag)&&r.lag>=1&&r.lag<=12&&(r.op!=='between'||r.threshold<=r.upper)&&(r.mode!=='qoq'||r.kind==='quarter')&&(r.mode!=='cagr'||r.kind==='year')&&(r.mode!=='points'||r.metric==='roe'))&&Object.entries(c.s).every(([k,v])=>typeof v!=='number'||Number.isFinite(v)&&v>=0&&(!['base','tight','dry','baseline','volume','liquidityWindow'].includes(k)||Number.isInteger(v)&&v>=2&&v<=252))&&c.s.base>=c.s.tight*2&&['base','breakout','either'].includes(c.s.mode)&&c.s.closePosition<=100&&c.s.depth<=100&&c.groupRequired>=1&&c.groupRequired<=3)
}
const avg=(a:number[])=>a.reduce((x,y)=>x+y,0)/a.length
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)
const idx=(r:PeriodRow)=>r.kind==='year'?r.year:r.year*4+r.quarter-1
function series(rows:PeriodRow[],metric:Metric,kind:Rule['kind']) {
 const source=rows.filter(r=>r.kind===(kind==='year'?'year':'quarter')).sort((a,b)=>idx(b)-idx(a))
 if(kind!=='ttm')return source.map(r=>({period:r.period,index:idx(r),value:r[metric]}))
 // EPS and ROE TTM require a vendor-provided matching basis; never sum per-share ratios.
 if(['eps','eps_diluted'].includes(metric))return []
 if(metric==='roe')return source.map(r=>({period:r.period+' TTM',index:idx(r),value:r.roe}))
 return source.map(r=>{const window=Array.from({length:4},(_,i)=>source.find(v=>idx(v)===idx(r)-i)?.[metric]);return {period:r.period+' TTM',index:idx(r),value:window.every(finite)?window.reduce((a,b)=>a+b,0):undefined}})
}
export function evaluateRule(rows:PeriodRow[],r:Rule) {
 const values=series(rows,r.metric,r.kind), target=r.period?values.find(v=>v.period.replace(' TTM','')===r.period):values[0]
 const evidence:{period:string;value:number|null;current:number|null;prior:number|null;pass:boolean|null;reason:string}[]=[]
 for(let n=0;n<r.count;n++){
 const current=target&&values.find(v=>v.index===target.index-n), lag=r.mode==='qoq'?1:r.mode==='lag'?r.lag:r.mode==='cagr'?r.lag:r.kind==='year'?1:4
 const prior=current&&values.find(v=>v.index===current.index-lag)
 let value:number|null=null, reason='Thiếu dữ liệu đúng kỳ'
 if(finite(current?.value)){
 if(r.mode==='level'){value=current.value;reason=''}
 else if(finite(prior?.value)){
 if(r.mode==='points'){value=current.value-prior.value;reason=''}
 else if(r.mode==='turnaround'){value=prior.value<=0&&current.value>0?1:0;reason=''}
 else if(prior.value>0&&(r.mode!=='cagr'||current.value>0)){value=r.mode==='cagr'?((current.value/prior.value)**(1/r.lag)-1)*100:(current.value/prior.value-1)*100;reason=''}
 else reason='Mẫu số không dương: không áp dụng tăng trưởng'
 }}
 let pass=value===null?null:r.mode==='turnaround'?value===1:r.op==='gte'?value>=r.threshold:r.op==='gt'?value>r.threshold:r.op==='lte'?value<=r.threshold:r.op==='lt'?value<r.threshold:value>=r.threshold&&value<=r.upper
 if(r.positive&&finite(current?.value)&&current.value<=0){pass=false;reason='Giá trị hiện tại phải dương'}
 evidence.push({period:current?.period??'—',value,current:current?.value??null,prior:prior?.value??null,pass,reason})
 }
 const passes=evidence.filter(e=>e.pass===true).length, unknown=evidence.filter(e=>e.pass===null).length
 const status:Verdict=!r.enabled?'OFF':passes>=r.required?'PASS':passes+unknown<r.required?'FAIL':'UNKNOWN'
 return {rule:r,status,evidence}
}
export function groupVerdict(statuses:Verdict[]):Verdict {
 const active=statuses.filter(s=>s!=='OFF');return !active.length?'OFF':active.includes('FAIL')?'FAIL':active.includes('STALE')?'STALE':active.includes('UNKNOWN')?'UNKNOWN':'PASS'
}
const range=(bars:Bar[])=>{const high=Math.max(...bars.map(b=>b.high));return high>0?(high-Math.min(...bars.map(b=>b.low)))/high*100:NaN}
export function evaluateS(prices:Bar[],c:SConfig) {
 const sorted=[...prices].sort((a,b)=>a.date.localeCompare(b.date)), today=sorted.at(-1)
 function measure(bars:Bar[]){
 const last=bars.at(-1), base=bars.slice(-c.base), recent=bars.slice(-c.tight), earlier=bars.slice(-2*c.tight,-c.tight)
 const peak=Math.max(...base.map(b=>b.high)), vol=avg(bars.slice(-c.dry).map(b=>b.volume)), priorVol=avg(bars.slice(-c.dry-c.baseline,-c.dry).map(b=>b.volume))
 return {depth:range(base),near:last?(peak-last.close)/peak*100:NaN,range:range(recent),contraction:range(earlier)>0?range(recent)/range(earlier):NaN,dryRatio:priorVol>0?vol/priorVol:NaN}
 }
 const baseBars=c.mode==='breakout'||today&&sorted.length>1&&today.close>Math.max(...sorted.slice(-c.base-1,-1).map(b=>b.high))?sorted.slice(0,-1):sorted
 const setup=measure(baseBars), pivot=Math.max(...sorted.slice(-c.base-1,-1).map(b=>b.high)), previousAvg=avg(sorted.slice(-c.volume-1,-1).map(b=>b.volume))
 const volumeRatio=today&&previousAvg>0?today.volume/previousAvg:NaN, distance=today?(today.close/pivot-1)*100:NaN
 const liquidityValues=sorted.slice(-c.liquidityWindow).map(b=>b.close*b.volume).sort((a,b)=>a-b), mid=Math.floor(liquidityValues.length/2), liquidity=liquidityValues.length?(liquidityValues[mid]+liquidityValues[Math.floor((liquidityValues.length-1)/2)])/2/1e9:NaN
 const comparison=sorted.slice(-c.base-1), up:number[]=[], down:number[]=[]
 comparison.forEach((b,i)=>{if(i){if(b.close>comparison[i-1].close)up.push(b.volume);if(b.close<comparison[i-1].close)down.push(b.volume)}})
 const upDown=up.length>=5&&down.length>=5&&avg(down)>0?avg(up)/avg(down):NaN
 const decline=sorted.slice(-20).filter(b=>{const i=sorted.indexOf(b);return i>0&&b.close<sorted[i-1].close}).map(b=>b.volume)
 const pullbackBaseline=avg(sorted.slice(-20-c.volume,-20).map(b=>b.volume)), pullbackRatio=decline.length>=3&&pullbackBaseline>0?avg(decline)/pullbackBaseline:NaN
 const position=today&&today.high>today.low?(today.close-today.low)/(today.high-today.low)*100:NaN
 const rows=[{label:'Độ sâu nền (%)',value:setup.depth,limit:c.depth,pass:setup.depth<=c.depth},{label:'Cách đỉnh nền (%)',value:setup.near,limit:c.near,pass:setup.near>=0&&setup.near<=c.near},{label:'Biên độ gần đây (%)',value:setup.range,limit:c.range,pass:setup.range<=c.range},{label:'Co hẹp biên độ (lần)',value:setup.contraction,limit:c.contraction,pass:setup.contraction<=c.contraction},{label:'Co khối lượng (lần)',value:setup.dryRatio,limit:c.dryRatio,pass:setup.dryRatio<=c.dryRatio}]
 const basePass=rows.every(r=>r.pass), breakout=distance>0&&distance<=c.extended&&volumeRatio>=c.volumeRatio&&position>=c.closePosition&&basePass
 const extra=liquidity>=c.liquidity&&(!c.upDown||upDown>=c.upDownRatio)&&(!c.pullback||pullbackRatio<=c.pullbackRatio)
 const enough=sorted.length>=Math.max(c.base+1,2*c.tight+1,c.dry+c.baseline+1,c.volume+21,c.liquidityWindow)&&rows.every(r=>finite(r.value))&&(!c.upDown||finite(upDown))&&(!c.pullback||finite(pullbackRatio))
 const status:Verdict=!c.enabled?'OFF':!enough?'UNKNOWN':extra&&(c.mode==='base'?basePass&&distance<=0:c.mode==='breakout'?breakout:basePass&&distance<=0||breakout)?'PASS':'FAIL'
 return {status,rows,volumeRatio,distance,liquidity,upDown,pullbackRatio,date:today?.date,setup:breakout?'Vượt nền có volume':basePass&&distance<=0?'Đang tạo nền':'Quan sát'}
}
export function evaluate(snapshot:Snapshot|undefined,c:Config,expectedPriceDate?:string){
 const rules=c.rules.map(r=>evaluateRule(snapshot?.financial??[],r)), s=evaluateS(snapshot?.prices??[],c.s)
 const stale=snapshot?.status==='ERROR'||Boolean(snapshot?.fetched_at&&Date.now()-Date.parse(snapshot.fetched_at)>7*86400000)
 const C=groupVerdict(rules.filter(r=>r.rule.group==='C').map(r=>r.status)), A=groupVerdict(rules.filter(r=>r.rule.group==='A').map(r=>r.status))
 const checks={C:stale&&C!=='OFF'?'STALE' as const:C,A:stale&&A!=='OFF'?'STALE' as const:A,S:(stale||Boolean(expectedPriceDate&&s.date&&s.date<expectedPriceDate))&&s.status!=='OFF'?'STALE' as const:s.status}
 const active=Object.values(checks).filter(v=>v!=='OFF'), required=c.groupMode==='all'?active.length:c.groupRequired
 return {rules,s,checks,match:active.length>0&&active.filter(v=>v==='PASS').length>=required}
}
