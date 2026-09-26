// Shared by private import/export and the browser. No task override is an outcome.
const day = 86400000;
const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0,10) === value;
const textOK = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
const onlyKeys = (value,keys) => {if(Object.keys(value).some(k=>!keys.includes(k))) throw new Error('Unrecognized field; observations contain sanitized aggregates only');};
export function validateObservations(ledger) {
  if (ledger?.version !== 1 || !Array.isArray(ledger.metrics) || !Array.isArray(ledger.observations)) throw new Error('Invalid metric ledger');
  const definitions = new Map();
  onlyKeys(ledger,['version','metrics','observations']);
  for (const m of ledger.metrics) {
    onlyKeys(m,['id','label','title','unit','definition','freshDays','freshnessReason']);
    if (!/^[a-z][a-z0-9-]{1,60}$/.test(m.id) || definitions.has(m.id) || !textOK(m.label) || !textOK(m.title) || !textOK(m.definition) || !['count','USD','percent'].includes(m.unit) || !Number.isInteger(m.freshDays) || m.freshDays < 1 || !textOK(m.freshnessReason)) throw new Error('Invalid metric definition');
    definitions.set(m.id,m);
  }
  const ids = new Set();
  for (const o of ledger.observations) {
    onlyKeys(o,['id','metricId','value','observedAt','recordedAt','period','population','quality','completeness','source','sourcePath','note','numerator','denominator','supersedes','correctionReason']);
    const m = definitions.get(o.metricId);
    if (!m || !/^[A-Za-z0-9-]{1,100}$/.test(o.id) || ids.has(o.id) || !dateOK(o.recordedAt) || !['VERIFIED','REPORTED','UNKNOWN'].includes(o.quality) || !['COMPLETE','INCOMPLETE','UNKNOWN'].includes(o.completeness) || !textOK(o.population) || !textOK(o.source) || !textOK(o.note)) throw new Error(`Invalid observation: ${o.id}`);
    if (!/^(00_ADMIN|01_STRATEGY|03_ANALYTICS|09_BUDGET)\/[A-Za-z0-9_-]+\.md$/.test(o.sourcePath)) throw new Error('Use a sanitized project evidence document');
    if (o.observedAt !== null && !dateOK(o.observedAt)) throw new Error('Invalid observation date');
    if (o.observedAt && o.observedAt > o.recordedAt) throw new Error('Observation cannot postdate its recording');
    if (!['point','range','unknown'].includes(o.period?.kind)) throw new Error('Invalid period');
    onlyKeys(o.period,['kind','start','end']);
    if (o.period.kind !== 'unknown' && (!dateOK(o.period.start) || !dateOK(o.period.end) || o.period.start > o.period.end || o.period.kind === 'point' && o.period.start !== o.period.end)) throw new Error('Invalid period dates');
    if (o.value !== null && (typeof o.value !== 'number' || !Number.isFinite(o.value) || o.value < 0 || m.unit === 'count' && !Number.isInteger(o.value) || m.unit === 'percent' && o.value > 100)) throw new Error('Invalid metric value');
    if (o.quality === 'UNKNOWN' && o.value !== null || o.value !== null && (!o.observedAt || o.period.kind === 'unknown') || o.completeness === 'COMPLETE' && (o.value === null || o.quality === 'UNKNOWN')) throw new Error('Measured values need dated evidence; unknown is not zero');
    if (m.unit === 'percent' && o.value !== null) {
      if (!Number.isInteger(o.numerator) || !Number.isInteger(o.denominator) || o.denominator <= 0 || o.numerator < 0 || o.numerator > o.denominator || Math.abs(o.value - o.numerator / o.denominator * 100) > 0.051) throw new Error('Rate needs matching numerator and denominator');
    }
    if (o.supersedes) {
      const prior=ledger.observations.find(x=>x.id===o.supersedes);
      if (!ids.has(o.supersedes) || prior.metricId !== o.metricId || !textOK(o.correctionReason)) throw new Error('Correction must reference an earlier observation of this metric');
      if (ledger.observations.some(x=>x!==o && x.supersedes===o.supersedes)) throw new Error('Observation already superseded');
    }
    ids.add(o.id);
  }
  return ledger;
}
export function observationHistory(ledger,id) {
  return ledger.observations.filter(o=>o.metricId===id).map((o,index)=>({...o,_index:index})).sort((a,b)=>(b.observedAt || b.recordedAt).localeCompare(a.observedAt || a.recordedAt) || b.recordedAt.localeCompare(a.recordedAt) || b._index-a._index);
}
export function metricState(ledger,id,today=new Date().toISOString().slice(0,10)) {
  const definition=ledger.metrics.find(m=>m.id===id);
  if (!definition) throw new Error(`Unknown metric ${id}`);
  const history=observationHistory(ledger,id), superseded=new Set(history.map(o=>o.supersedes).filter(Boolean));
  const observation=history.find(o=>!superseded.has(o.id));
  const stale=!!observation?.observedAt && (Date.parse(today)-Date.parse(observation.observedAt))/day > definition.freshDays;
  const status=!observation || observation.value===null ? 'Unknown' : observation.completeness!=='COMPLETE' || observation.quality!=='VERIFIED' ? 'Incomplete' : stale ? 'Outdated' : observation.value===0 ? 'Measured zero' : 'Measured';
  const previous=history.find(o=>o.id!==observation?.id && !superseded.has(o.id));
  const comparable=observation && previous && ['Measured','Measured zero'].includes(status) && previous.completeness==='COMPLETE' && previous.quality==='VERIFIED' && previous.value!==null && observation.population===previous.population && observation.source===previous.source && observation.period.kind===previous.period.kind && (observation.period.kind==='point' ? observation.period.end>previous.period.end : observation.period.start>previous.period.end && Date.parse(observation.period.end)-Date.parse(observation.period.start)===Date.parse(previous.period.end)-Date.parse(previous.period.start));
  return {definition,observation,history,status,stale,delta:comparable?observation.value-previous.value:null,usable:['Measured','Measured zero'].includes(status)};
}
export function periodLabel(period) {
  return !period || period.kind==='unknown' ? 'Period unknown' : period.kind==='point' ? `As of ${period.end}` : `${period.start} to ${period.end}`;
}
export function validateDecisionView(system,ledger) {
  const v=system.decisionView;
  if (!v || !dateOK(v.reviewedAt) || !textOK(v.blocker?.title) || !textOK(v.blocker?.detail) || !v.blocker.sourcePath || !Array.isArray(v.nextActions) || !v.nextActions.length) throw new Error('Decision view needs reviewed blocker and actions');
  const ids=new Set();
  for(const a of v.nextActions) {
    if(ids.has(a.taskId) || !system.tasks[a.taskId]?.executionContract.stages.some(s=>s.id===a.stageId) || !textOK(a.title) || !textOK(a.reason)) throw new Error('Invalid next action');
    ids.add(a.taskId);
  }
  for(const m of system.milestones) {
    if(!m.evidenceChecks?.length) throw new Error('Milestone needs evidence checks');
    for(const c of m.evidenceChecks) {
      if(!textOK(c.id) || !textOK(c.title) || !textOK(c.note) || !c.sourcePath || !Array.isArray(c.taskIds) || c.taskIds.some(id=>!system.tasks[id])) throw new Error('Invalid milestone evidence');
      if(c.kind==='metric') {if(!ledger.metrics.some(x=>x.id===c.metricId) || !Number.isFinite(c.minimum) || c.minimum<0) throw new Error('Invalid metric check');}
      else if(c.kind==='review') {if(!['UNKNOWN','MET','NOT_MET'].includes(c.status) || !dateOK(c.reviewedAt) || !dateOK(c.reviewBy) || c.reviewBy<c.reviewedAt) throw new Error('Invalid review check');}
      else throw new Error('Invalid evidence check type');
    }
  }
}
export function milestoneState(milestone,ledger,today) {
  const checks=milestone.evidenceChecks.map(c=>{
    if(c.kind==='metric') {
      const m=metricState(ledger,c.metricId,today);
      return {...c,status:!m.usable?'Awaiting evidence':m.observation.value>=c.minimum?'Met':'Below target',actual:m.observation?.value,metricStatus:m.status};
    }
    return {...c,status:c.status==='UNKNOWN'?'Awaiting evidence':today>c.reviewBy?'Review overdue':c.status==='MET'?'Met':'Not met'};
  });
  const paid=metricState(ledger,'paying-subscribers',today);
  return {checks,targetReached:paid.usable ? paid.observation.value>=milestone.target : null,ready:checks.every(c=>c.status==='Met')};
}
export function nextActions(system,sourceTasks,sourceState={}) {
  return system.decisionView.nextActions.map(a=>{
    const task=sourceTasks.find(t=>t.id===a.taskId);
    const status=sourceState.tasks?.[a.taskId]?.status || task?.status;
    const stage=system.tasks[a.taskId].executionContract.stages.find(s=>s.id===a.stageId);
    const missing=stage.requires.filter(p=>p.state!=='SATISFIED');
    return {...a,status,available:missing.length===0 && status!=='BLOCKED',missing:missing.map(p=>p.artifact)};
  }).filter(a=>a.status!=='COMPLETE').sort((a,b)=>Number(b.available)-Number(a.available)).slice(0,3);
}
