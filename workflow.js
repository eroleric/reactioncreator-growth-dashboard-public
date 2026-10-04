// Workflow inclusion is separate from authority to send, publish, change products or spend.
const aiUseRules = ['selectionRule','simpleFirstRule','evidenceRule','measurementRule','expansionRule','recordRule','scopeRule'];
const hasText = value => typeof value === 'string' && Boolean(value.trim());

// Validate the declared working rules and task routing, not claimed usefulness or customer outcomes.
export function validateAiUsePolicy(system) {
  const policy = system.executionPolicy?.aiUse;
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(policy?.adoptedAt || '') &&
    Number.isFinite(Date.parse(`${policy.adoptedAt}T00:00:00Z`)) &&
    new Date(`${policy.adoptedAt}T00:00:00Z`).toISOString().slice(0,10) === policy.adoptedAt;
  if (!policy || policy.version !== 1 || !validDate || !hasText(policy.sourcePath) ||
      !/^[A-Za-z0-9_./-]+\.md$/.test(policy.sourcePath) || policy.sourcePath.startsWith('/') ||
      policy.sourcePath.split('/').includes('..') || aiUseRules.some(key => !hasText(policy[key]))) {
    throw new Error('AI use policy needs current rules, version, date and a retained source path');
  }
  if (!Array.isArray(policy.applications) || !policy.applications.length) throw new Error('AI use policy needs task applications');
  const applicationIds = new Set(), taskIds = new Set();
  for (const application of policy.applications) {
    if (!application || !hasText(application.id) || applicationIds.has(application.id) ||
        ['purpose','simpleAlternative','efficiencyMeasure','customerMeasure','expandWhen'].some(key => !hasText(application[key]))) {
      throw new Error('AI use application needs a unique ID, purpose, alternative and separate measures');
    }
    if (application.efficiencyMeasure.trim() === application.customerMeasure.trim()) throw new Error('AI use efficiency and customer measures must remain separate');
    applicationIds.add(application.id);
    if (!Array.isArray(application.taskIds) || !application.taskIds.length) throw new Error('AI use application needs active task references');
    for (const taskId of application.taskIds) {
      if (!hasText(taskId) || !Object.hasOwn(system.tasks || {},taskId) || system.removedTasks?.[taskId] || taskIds.has(taskId)) {
        throw new Error(`AI use application has an unknown, archived or duplicate task: ${taskId}`);
      }
      taskIds.add(taskId);
    }
  }
  return system;
}

// All task/routine briefs share the rules once; selected tasks also receive their mapped purpose and measures.
export function aiUseBrief(system, taskId = null) {
  const policy = system.executionPolicy?.aiUse;
  if (!Object.hasOwn(system.executionPolicy || {},'aiUse')) return ''; // Older snapshots remain readable; source validation requires the adopted policy.
  validateAiUsePolicy(system);
  const application = policy.applications.find(item => item.taskIds.includes(taskId));
  const shared = `AI use: follow executionPolicy.aiUse (${policy.adoptedAt}; source ${policy.sourcePath}). ${aiUseRules.map(key => policy[key].trim()).join(' ')}`;
  if (!application) return shared;
  return `${shared} Selected AI application (${application.id}): Purpose: ${application.purpose.trim()} Simple alternative: ${application.simpleAlternative.trim()} Efficiency measure: ${application.efficiencyMeasure.trim()} Customer measure: ${application.customerMeasure.trim()} Repeat or expand when: ${application.expandWhen.trim()}`;
}

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

// Eligibility only; task triggers and exact external-action authority still apply.
export function canSelectStageAutomatically(system, taskId, stageId, routineId = null) {
  const stage = system.tasks?.[taskId]?.executionContract?.stages.find(item => item.id === stageId);
  if (!stage || !canSelectAutomatically(system, taskId, routineId)) return false;
  if (!stage.optionalAdditionId) return true;
  return (system.executionPolicy.goalFirst.optionalApprovals || []).some(approval =>
    approval.taskId === taskId && approval.stepId === stage.optionalAdditionId &&
    approval.status === 'APPROVED' && approval.scope === 'RECURRING' &&
    approval.source?.trim() && approval.approvedAt &&
    (!routineId || approval.routineIds.includes(routineId)));
}

export function validateGoalFirst(system) {
  const workflow = system.executionPolicy?.goalFirst;
  if (!workflow || workflow.version !== 1 || workflow.optionalTitle !== 'Optional / Admin Approval') throw new Error('Missing goal-first workflow');
  const all = [...workflow.requiredTaskIds, ...workflow.optionalTaskIds];
  if (!workflow.requiredTaskIds.length || new Set(all).size !== all.length || all.length !== Object.keys(system.tasks).length || all.some(id => !system.tasks[id])) throw new Error('Workflow must classify every task exactly once');
  if (!Array.isArray(workflow.optionalApprovals)) throw new Error('Missing optional approval records');
  const additionKeys = new Set();
  for (const addition of workflow.optionalAdditions) {
    const key = `${addition.taskId}/${addition.id}`;
    if (additionKeys.has(key) || !system.tasks[addition.taskId] || !addition.id || !addition.detail?.trim()) throw new Error('Invalid optional addition');
    additionKeys.add(key);
    if (!system.tasks[addition.taskId].executionContract.stages.some(stage => stage.optionalAdditionId === addition.id)) throw new Error('Optional addition needs a separately gated stage');
  }
  for (const [id, task] of Object.entries(system.tasks)) for (const stage of task.executionContract.stages) {
    if (stage.optionalAdditionId && !additionKeys.has(`${id}/${stage.optionalAdditionId}`)) throw new Error('Unregistered optional stage');
  }
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
