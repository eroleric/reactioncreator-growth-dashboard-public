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

// These are customer priorities, independent of task phases and display overrides.
export const growthPriorityAxes = [
  {id:'needs', short:'Needs', title:'Understand creators’ needs and choices'},
  {id:'reach', short:'Reach', title:'Reach suitable creators'},
  {id:'try', short:'First try', title:'Turn interest into a first try'},
  {id:'video', short:'Useful video', title:'Finish useful videos', metricId:'activated'},
  {id:'return', short:'Return', title:'Return to make another video', metricId:'repeat-7d'},
  {id:'paid', short:'Paying', title:'Turn value into paying customers', metricId:'paying-subscribers'},
];
const evidenceLevels = {REPORTED:1, OBSERVED:2, REVIEWED:3};
export function validateGrowthPriorityEvidence(system) {
  const evidence=system.growthPriorityEvidence;
  if(evidence?.version!==1 || !Array.isArray(evidence.reviews)) throw new Error('Missing growth priority evidence');
  const required=growthPriorityAxes.filter(a=>!a.metricId).map(a=>a.id), ids=new Set();
  for(const r of evidence.reviews) {
    if(!required.includes(r.axisId) || ids.has(r.axisId) || !['UNKNOWN',...Object.keys(evidenceLevels)].includes(r.state) || !textOK(r.summary) || !/^(01_STRATEGY|02_RESEARCH|03_ANALYTICS|08_EXPERIMENTS)\/[A-Za-z0-9_-]+\.md$/.test(r.sourcePath)) throw new Error('Invalid growth priority review');
    if(r.state==='UNKNOWN' ? r.observedAt!==null || r.reviewBy!==null : !dateOK(r.observedAt) || !dateOK(r.reviewBy) || r.reviewBy<r.observedAt) throw new Error('Growth evidence needs its actual observation date and review date');
    ids.add(r.axisId);
  }
  if(ids.size!==required.length) throw new Error('Incomplete growth priority reviews');
  return evidence;
}
export function growthPriorityScores(system,ledger,today) {
  const evidence=validateGrowthPriorityEvidence(system);
  return growthPriorityAxes.map(axis=>{
    if(axis.metricId) {
      const m=metricState(ledger,axis.metricId,today), o=m.observation;
      const state=m.stale?'OUTDATED':m.usable?'OBSERVED':o?.quality==='REPORTED' && o.completeness==='COMPLETE' && o.value!==null?'REPORTED':'UNKNOWN';
      const value=o?.value==null?null:`${o.value}${m.definition.unit==='percent'?'%':''}`;
      const summary=value===null?'No classified customer result is recorded yet.':`${m.stale?'Last recorded':'Recorded'} result: ${value}. ${periodLabel(o.period)}. ${o.note}`;
      return {...axis,state,score:evidenceLevels[state] ?? null,summary,observedAt:o?.observedAt || null,sourcePath:o?.sourcePath || '03_ANALYTICS/METRICS.md'};
    }
    const review=evidence.reviews.find(r=>r.axisId===axis.id);
    const state=review.state!=='UNKNOWN' && today>review.reviewBy?'OUTDATED':review.state;
    return {...axis,...review,state,score:evidenceLevels[state] ?? null};
  });
}

// Work and retained knowledge are distinct from the customer outcomes above.
const priorityTaskIds = {
  needs:['AI01','AI08','R03','F06'],
  reach:['AI01','AI03','O02','M02','M03','M04','C01','C02','C03','C05','O04','O05','MON05','F04','E02','E03','E04','E05','E06'],
  try:['AI03','F03','O03','O06','S01','S02','S03','S04','S05'],
  video:['F01','F02','AI02','A01','A02','A03','A04'],
  return:['A05','A06'],
  paid:['MON01','MON02','MON03','MON04','AI12','R02','R05','F05'],
};
export function validateGrowthKnowledge(system) {
  const rows=system.growthPriorityKnowledge;
  if(!Array.isArray(rows) || rows.length!==growthPriorityAxes.length) throw new Error('Six retained knowledge summaries are required');
  const seen=new Set();
  for(const r of rows) {
    if(!growthPriorityAxes.some(a=>a.id===r.axisId) || seen.has(r.axisId) || !textOK(r.summary) || !textOK(r.brief) || !textOK(r.gap) || r.brief.length>300 || r.gap.length>300 || !dateOK(r.reviewedAt) || !Array.isArray(r.sourcePaths) || !r.sourcePaths.length || r.sourcePaths.some(p=>!/^\d{2}_[A-Z_]+\/[A-Za-z0-9_-]+\.md$/.test(p))) throw new Error('Invalid retained growth knowledge');
    seen.add(r.axisId);
  }
  const mapped=new Set(Object.values(priorityTaskIds).flat().map(id=>'GR:'+id));
  if(Object.keys(system.tasks).some(id=>!mapped.has(id))) throw new Error('Growth task has no priority mapping');
  return rows;
}
const workWeight=status=>({COMPLETE:1,IN_PROGRESS:.45,'IN PROGRESS':.45,BLOCKED:.15,FAILED:.1})[status] || 0;
export function growthWorkScores(system,tasks,displayState={}) {
  const knowledge=validateGrowthKnowledge(system), required=new Set(system.executionPolicy.goalFirst.requiredTaskIds);
  return growthPriorityAxes.map(axis=>{
    const taskIds=new Set(priorityTaskIds[axis.id].map(id=>'GR:'+id));
    const records=tasks.filter(t=>taskIds.has(t.id)).map(t=>{
      const archives=Object.values(system.removedTasks || {}).filter(a=>a.mergedInto===t.id);
      const receipts=[...(system.runs || []).filter(r=>r.taskId===t.id),...archives.flatMap(a=>a.runs || [])];
      const progress=Math.max(workWeight(displayState.taskOverrides?.[t.id] || t.status),...receipts.map(r=>workWeight(r.status)));
      const sourceEvidence=String(t.evidence || '').trim();
      const evidence=Boolean(displayState.taskNotes?.[t.id]?.trim() || (sourceEvidence && !/^(NOT STARTED|UNKNOWN|NO POST-LAUNCH|NO PAID|NO GROWTH)/i.test(sourceEvidence)) || receipts.some(r=>r.evidence?.trim() || r.output?.trim()));
      return {id:t.id,progress,evidence,receipts:receipts.length};
    }).filter(r=>required.has(r.id) || r.progress>0 || r.evidence);
    const retained=knowledge.find(r=>r.axisId===axis.id), total=records.length;
    // Optional work that has not been selected is not an unfinished-work quota.
    const score=Number((1+(total?4*records.reduce((sum,r)=>sum+r.progress,0)/total:0)).toFixed(1));
    return {...axis,score,knowledge:retained,total,evidence:records.filter(r=>r.evidence).length,receipts:records.reduce((sum,r)=>sum+r.receipts,0),taskIds:records.map(r=>r.id)};
  });
}
export function growthRadarScores(system,tasks,displayState,ledger,today) {
  const outcomes=growthPriorityScores(system,ledger,today);
  return growthWorkScores(system,tasks,displayState).map(work=>{
    const outcome=outcomes.find(o=>o.id===work.id);
    const ceiling=({UNKNOWN:3,OUTDATED:3,REPORTED:3.5,OBSERVED:4,REVIEWED:5})[outcome.state];
    return {...work,workScore:work.score,score:Math.min(work.score,ceiling),ceiling,outcome};
  });
}
export function validateDecisionView(system,ledger) {
  const v=system.decisionView;
  if (!v || !dateOK(v.reviewedAt) || !textOK(v.blocker?.title) || !textOK(v.blocker?.detail) || !v.blocker.sourcePath || !system.aiPriorities?.items?.length) throw new Error('Decision view needs reviewed blocker and ranked priorities');
  const ids=new Set();
  for(const a of system.aiPriorities.items) {
    if(ids.has(a.taskId) || !system.tasks[a.taskId]?.executionContract.stages.some(s=>s.id===(a.executionStageId || 'prepare')) || !textOK(a.reason)) throw new Error('Invalid ranked next task');
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
export function rankedGrowthTasks(system,sourceTasks,sourceState={}) {
  return [...system.aiPriorities.items].sort((a,b)=>a.rank-b.rank).map(a=>{
    const task=sourceTasks.find(t=>t.id===a.taskId);
    if(!task)return null;
    const status=sourceState.taskOverrides?.[a.taskId] || sourceState.tasks?.[a.taskId]?.status || task.status;
    const stageId=a.executionStageId || 'prepare';
    const stage=system.tasks[a.taskId].executionContract.stages.find(s=>s.id===stageId);
    const missing=stage.requires.filter(p=>p.state!=='SATISFIED');
    const available=missing.length===0 && ['NOT STARTED','IN PROGRESS'].includes(status);
    return {...a,stageId,title:task.execution?.adminTitle || task.adminTitle || task.title,status,available,missing:missing.map(p=>p.artifact)};
  }).filter(Boolean);
}
export function nextActions(system,sourceTasks,sourceState={}) {
  return rankedGrowthTasks(system,sourceTasks,sourceState).filter(a=>a.status!=='COMPLETE');
}
