// Pure, shared forecast logic. Completion is an input, never evidence of customer impact.
const requiredDays = [1, 3, 7, 14, 30];
const hasText = value => typeof value === 'string' && Boolean(value.trim());
const isDay = value => Number.isInteger(value) && value >= 0 && value <= 3650;

function validateRange(range) {
  if (!range) return;
  if (!hasText(range.metric) || !hasText(range.unit) || !hasText(range.basis) || !isDay(range.periodDays) ||
      !Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low > range.high) {
    throw new Error('Expected impact range needs ordered numbers, units, period and an evidence basis');
  }
}
export function validateForecast(forecast, requireOutcome = true) {
  if (!forecast || (requireOutcome && !hasText(forecast.expectedResult)) ||
      !hasText(forecast.basis) || !hasText(forecast.confidenceReason) ||
      !['Low','Medium','High'].includes(forecast.confidence) ||
      !Array.isArray(forecast.assumptions) || !forecast.assumptions.length || !forecast.assumptions.every(hasText)) {
    throw new Error('Expected result needs an outcome, confidence, assumptions and basis');
  }
  const first = forecast.firstResult;
  if (!first || !isDay(first.minDays) || !isDay(first.maxDays) || first.minDays > first.maxDays || !hasText(first.anchor)) {
    throw new Error('Expected result needs a valid first-result window and timing anchor');
  }
  if (!hasText(forecast.expectedImpact?.metric) || !hasText(forecast.expectedImpact?.estimate)) throw new Error('Expected result needs an impact estimate');
  validateRange(forecast.expectedImpact.range);
  if (!Array.isArray(forecast.timeline) || requiredDays.some(day => !forecast.timeline.some(row => row.day === day))) throw new Error('Expected result must cover Day 1, 3, 7, 14 and 30');
  let previous = 0;
  for (const row of forecast.timeline) {
    if (!isDay(row.day) || row.day <= previous || !hasText(row.expectedResult) || !hasText(row.expectedImpact)) throw new Error('Expected result timeline must be ordered and complete');
    validateRange(row.impactRange);
    previous = row.day;
  }
  return forecast;
}

export function validateExpectedResults(system, tasks) {
  const config = system.expectedTaskResults;
  if (!config || config.version !== 1 || !config.profiles || !Array.isArray(config.reviewed)) throw new Error('Missing expected task results policy');
  for (const profile of Object.values(config.profiles)) validateForecast(profile, false);
  const ids = new Set(tasks.map(task => task.id));
  for (const task of tasks) {
    const expectation = system.tasks[task.id]?.resultExpectation;
    if (!expectation || !hasText(expectation.expectedResult) || !config.profiles[expectation.profile]) throw new Error(`Missing expected result recipe for ${task.id}`);
  }
  const keys = new Set();
  for (const record of config.reviewed) {
    if (!ids.has(record.taskId) || !hasText(record.completionEvidence) || !hasText(record.reviewedAt) || !Number.isFinite(Date.parse(record.reviewedAt))) throw new Error('Reviewed expected result needs a task, completion evidence and review date');
    const taskKey = `task:${record.taskId}`;
    const receipt = (system.runs || []).find(run => run.status === 'COMPLETE' && `run:${run.taskId}:${run.periodKey}` === record.completionKey);
    if (record.completionKey !== taskKey && (!receipt || receipt.taskId !== record.taskId)) throw new Error('Reviewed expected result has an invalid completion key');
    const key = JSON.stringify([record.completionKey, record.completionEvidence]);
    if (keys.has(key)) throw new Error('Duplicate reviewed expected result');
    keys.add(key);
    validateForecast(record.forecast);
  }
  return config;
}

export function expectedResultForTask(task, system, completion) {
  const config = system.expectedTaskResults;
  const expectation = task.execution?.resultExpectation || system.tasks?.[task.id]?.resultExpectation;
  const profile = config?.profiles?.[expectation?.profile];
  if (!profile) return null;
  const record = (config.reviewed || []).find(record => record.taskId === task.id && record.completionKey === completion.key && record.completionEvidence.trim() === completion.evidence.trim());
  const automatic = { ...structuredClone(profile), expectedResult: expectation.expectedResult };
  const forecast = record ? structuredClone(record.forecast) : automatic;
  if (!hasText(completion.evidence) || /^(NOT STARTED|IN PROGRESS|BLOCKED)\b/i.test(completion.evidence)) {
    forecast.confidence = 'Low';
    forecast.confidenceReason = 'The completion record lacks usable completion evidence. Verify the deliverable before relying on this conditional estimate.';
  }
  return {
    ...forecast, taskId: task.id, completionKey: completion.key,
    taskTitle: task.execution?.adminTitle || task.title,
    completionEvidence: completion.evidence,
    completionKind: completion.kind,
    completedAt: completion.completedAt || null,
    periodKey: completion.periodKey || null,
    method: record ? 'AI-reviewed estimate' : 'Automatic planning estimate',
    reviewedAt: record?.reviewedAt || null,
    needsReview: !record,
  };
}

export function completedTaskResults(data, adminState = data.adminState || {}) {
  const system = data.growthSystem;
  if (!system?.expectedTaskResults) return [];
  const results = [];
  for (const task of data.tasks.filter(task => task.lifecycle === 'GROWTH')) {
    const runs = (system.runs || []).filter(run => run.taskId === task.id && run.status === 'COMPLETE');
    // Each completed recurring cycle remains visible even while the standing task is open.
    for (const run of runs) {
      const result = expectedResultForTask(task, system, {key:`run:${task.id}:${run.periodKey}`,evidence:run.evidence || '',kind:'Completed cycle',completedAt:run.finishedAt,periodKey:run.periodKey});
      if (result) results.push(result);
    }
    const status = adminState.taskOverrides?.[task.id] || task.status;
    // The standing completion summarizes these cycles; do not count it again.
    if (status === 'COMPLETE' && !runs.length) {
      const result = expectedResultForTask(task, system, {key:`task:${task.id}`,evidence:adminState.taskNotes?.[task.id] || task.evidence || '',kind:'Completed task'});
      if (result) results.push(result);
    }
  }
  return results.sort((a,b) => (b.completedAt || '').localeCompare(a.completedAt || '') || a.taskTitle.localeCompare(b.taskTitle) || a.completionKey.localeCompare(b.completionKey));
}

export function firstResultLabel(first) {
  if (first.minDays === 0 && first.maxDays <= 1) return 'Same day–1 day';
  return first.minDays === first.maxDays ? `${first.minDays} ${first.minDays === 1 ? 'day' : 'days'}` : `${first.minDays}–${first.maxDays} days`;
}

export function impactRangeLabel(range) {
  return range ? `${range.low}–${range.high} ${range.unit} · ${range.metric} · ${range.periodDays} days` : '';
}
