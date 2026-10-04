// Saved dashboard updates belong to the exact source scope and evidence they reviewed.
export const taskStatuses = ['COMPLETE', 'IN PROGRESS', 'NOT STARTED', 'BLOCKED'];

export function reconcileTaskState(tasks, base = {}, ...savedStates) {
  const state = structuredClone(base);
  for (const key of ['taskOverrides', 'taskNotes', 'taskBlockers']) state[key] ||= {};
  state.taskUpdates = {};
  state.taskReviewUpdates = {};
  const byId = new Map(tasks.map(task => [task.id, task]));
  function apply(id, update) {
    const task = byId.get(id);
    if (!task || !taskStatuses.includes(update?.status)) return;
    if (task.sourceRevision && update.sourceRevision === task.sourceRevision) {
      state.taskUpdates[id] = structuredClone(update);
      state.taskOverrides[id] = update.status;
      state.taskNotes[id] = update.note || '';
      state.taskBlockers[id] = update.blockedReason || '';
    } else if (update.status !== (base.taskOverrides?.[id] || task.status) ||
      (update.note || '') !== (base.taskNotes?.[id] || '')) {
      const history = state.taskReviewUpdates[id] ||= [];
      if (!history.some(item => JSON.stringify(item) === JSON.stringify(update))) history.push(structuredClone(update));
    }
  }
  for (const saved of savedStates) {
    for (const [id, history] of Object.entries(saved?.taskReviewUpdates || {})) {
      if (!byId.has(id) || !Array.isArray(history)) continue;
      for (const update of history) {
        const existing = state.taskReviewUpdates[id] ||= [];
        if (!existing.some(item => JSON.stringify(item) === JSON.stringify(update))) existing.push(structuredClone(update));
      }
    }
    for (const [id, update] of Object.entries(saved?.taskUpdates || {})) apply(id, update);
    for (const [id, status] of Object.entries(saved?.taskOverrides || {})) {
      if (!saved.taskUpdates?.[id]) apply(id, {status, note: saved.taskNotes?.[id] || '', blockedReason: saved.taskBlockers?.[id] || ''});
    }
  }
  return state;
}

export function completedScopeWork(task, system) {
  const receipts = (system.runs || []).filter(run => run.taskId === task.id && run.status === 'COMPLETE')
    .map(run => ({label: run.output, source: run.evidence, key: run.periodKey}));
  const selections = (task.execution?.ownerRequestedSelections || []).filter(item => item.status === 'COMPLETE' && !item.supersededBy)
    .map(item => ({label: item.scopeLabel || item.source, source: item.record, key: item.periodKey}));
  return [...receipts, ...selections].filter(item => item.label);
}
