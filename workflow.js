// Workflow inclusion is separate from authority to send, publish, change products or spend.
export function workflowMode(system, taskId) {
  const workflow = system.executionPolicy?.goalFirst;
  if (workflow?.requiredTaskIds.includes(taskId)) return 'REQUIRED';
  if (workflow?.optionalTaskIds.includes(taskId)) return 'OPTIONAL';
  return 'UNKNOWN';
}

export function canSelectAutomatically(system, taskId, routineId = null) {
  if (!system.tasks?.[taskId]) return false;
  if (workflowMode(system, taskId) === 'REQUIRED') return true;
  return (system.executionPolicy?.goalFirst?.optionalApprovals || []).some(approval =>
    approval.taskId === taskId && !approval.stepId && approval.status === 'APPROVED' &&
    approval.scope === 'RECURRING' && approval.source?.trim() && approval.approvedAt &&
    (!routineId || approval.routineIds.includes(routineId)));
}

export function validateGoalFirst(system) {
  const workflow = system.executionPolicy?.goalFirst;
  if (!workflow || workflow.version !== 1 || workflow.optionalTitle !== 'Optional / Admin Approval') throw new Error('Missing goal-first workflow');
  const all = [...workflow.requiredTaskIds, ...workflow.optionalTaskIds];
  if (!workflow.requiredTaskIds.length || new Set(all).size !== all.length || all.length !== Object.keys(system.tasks).length || all.some(id => !system.tasks[id])) throw new Error('Workflow must classify every task exactly once');
  if (!Array.isArray(workflow.optionalApprovals)) throw new Error('Missing optional approval records');
  for (const approval of workflow.optionalApprovals) {
    const knownTarget = approval.stepId
      ? workflow.optionalAdditions.some(item => item.taskId === approval.taskId && item.id === approval.stepId)
      : workflow.optionalTaskIds.includes(approval.taskId);
    if (!knownTarget || !['APPROVED','REVOKED'].includes(approval.status) || !['ONE_RUN','RECURRING'].includes(approval.scope) || !approval.source?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(approval.approvedAt || '') || !Array.isArray(approval.routineIds) || approval.routineIds.some(id => !system.routines.some(r => r.id === id)) || (approval.scope === 'RECURRING' && !approval.routineIds.length)) throw new Error('Invalid explicit optional approval');
  }
  for (const routine of system.routines) {
    if (routine.tasks.some(id => !canSelectAutomatically(system, id, routine.id))) throw new Error('Optional task in routine without explicit recurring approval');
  }
  const planIds = [...system.growthTimeline.stages.flatMap(stage => stage.taskIds), ...system.aiPriorities.items.map(item => item.taskId), system.focus.nextTask];
  if (planIds.some(id => !canSelectAutomatically(system, id))) throw new Error('Unapproved optional task in default plan');
  return system;
}
