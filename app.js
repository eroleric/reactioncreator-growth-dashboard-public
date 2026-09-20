let data,
  view = "overview",
  activePin = "",
  failedAttempts = 0,
  planTaskView = "all",
  growthTab = "home",
  prelaunchTab = "home",
  adminActionIndex = 0,
  adminState = {
    overviewNote: "",
    taskOverrides: {},
    taskNotes: {},
    taskBlockers: {},
    gateOverrides: {},
    gateNotes: {},
    project: {},
    updates: [],
  },
  noteSyncStatus = "Loading shared note…";
const saveTimers = new Map();
const debounceSave = (key, work, delay = 700) => {
  clearTimeout(saveTimers.get(key));
  saveTimers.set(
    key,
    setTimeout(async () => {
      saveTimers.delete(key);
      await work();
    }, delay),
  );
};
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
const titles = {
  overview: "Overview",
  plan: "Work plan",
  growth: "Growth & budget",
  records: "Project records",
};
const statusClass = (s) =>
  ({
    BLOCKED: "blocked",
    "IN PROGRESS": "progress",
    "NOT STARTED": "neutral",
    COMPLETE: "complete",
    PASS: "pass",
    FAIL: "fail",
    WAIT: "warn",
    "ON HOLD": "warn",
  })[s] || "neutral";
const label = (s) =>
  ({
    "IN PROGRESS": "In progress",
    "NOT STARTED": "Not started",
    COMPLETE: "Complete",
    BLOCKED: "Blocked",
    WAIT: "Awaiting evidence",
    PASS: "Passed",
    FAIL: "Needs work",
    "ON HOLD": "On hold",
  })[s] || s;
const taskCountLabel = (count) => `${count} ${count === 1 ? "task" : "tasks"}`;
const tag = (s) =>
  `<span class="tag ${statusClass(s)}">${esc(label(s))}</span>`;
const taskStatus = (t) => adminState.taskOverrides[t.id] || t.status;
function taskStatusSummary(tasks) {
  const counts = { complete: 0, inProgress: 0, waiting: 0, blocked: 0 };
  tasks.forEach((task) => {
    const status = taskStatus(task);
    if (status === "COMPLETE") counts.complete += 1;
    else if (status === "IN PROGRESS") counts.inProgress += 1;
    else if (status === "BLOCKED") counts.blocked += 1;
    else counts.waiting += 1;
  });
  const total = tasks.length;
  const percent = (count) => (total ? Math.round((count / total) * 100) : 0);
  return {
    total,
    counts,
    percentages: {
      complete: percent(counts.complete),
      inProgress: percent(counts.inProgress),
      waiting: percent(counts.waiting),
      blocked: percent(counts.blocked),
    },
    remaining: total - counts.complete,
    remainingPercent: total ? Math.round(((total - counts.complete) / total) * 100) : 0,
  };
}
const gateStatus = (g) => adminState.gateOverrides[g.id] || g.status;
const activeLifecycle = () => adminState.project?.stage || "PRE_LAUNCH";
const lifecycleTitle = (value) =>
  ({
    PRE_LAUNCH: "Pre-launch",
    GROWTH: "Growth",
  })[value] || value.replaceAll("_", " ");
const taskIsAI = (t) => t.category === "AI_TASK";
const taskNeedsAdmin = (t) => t.category === "ADMIN_HELP" || Boolean(data?.growthSystem?.approvals.some(p => p.status === "READY" && p.taskIds.includes(t.id)));
const taskAvailable = (t) =>
  taskIsAI(t) &&
  ["IN PROGRESS", "NOT STARTED"].includes(taskStatus(t));
const nextLifecycleTask = (lifecycle) =>
  data.tasks
    .filter((t) => t.lifecycle === lifecycle && taskAvailable(t))
    .sort(
      (a, b) =>
        (taskStatus(a) === "IN PROGRESS" ? -1 : 1) -
          (taskStatus(b) === "IN PROGRESS" ? -1 : 1) ||
        a.sourceRow - b.sourceRow,
    )[0];
const metric = (name) =>
  data.metrics.find((m) => m.label === name) || {
    value: "UNKNOWN",
    asOf: "UNKNOWN",
    source: "Unknown",
  };
const display = (v) => (v === "UNKNOWN" ? "—" : esc(v));
const lifecycleSwitcher = () =>
  `<label class="lifecycle-switch" title="Change the project lifecycle for every device"><span class="sr-only">Project lifecycle</span><select data-lifecycle-switch aria-label="Project lifecycle">${validLifecycles.map((v) => `<option value="${v}" ${activeLifecycle() === v ? "selected" : ""}>${lifecycleTitle(v)}</option>`).join("")}</select></label>`;
const head = (title, sub, extra = "") =>
  `<div class="page-head"><div><div class="eyebrow">PROJECT PULSE</div><h1>${title}</h1><p>${sub}</p></div>${extra || lifecycleSwitcher()}</div>`;
function stat(title, value, note) {
  return `<article class="stat"><div class="label">${title}</div><div class="number">${value}</div><div class="note">${note}</div></article>`;
}
function openDetail(kicker, title, body) {
  $("#detail-kicker").textContent = kicker;
  $("#detail-body").innerHTML = `<h2>${esc(title)}</h2>${body}`;
  $("#detail").showModal();
}
function doc(path) {
  const d = data.docs.find((x) => x.path === path);
  if (d)
    openDetail(
      d.area,
      d.title,
      `<p class="subtle">${esc(d.path)}</p><pre class="document">${esc(d.body)}</pre>`,
    );
}
function formatTaskNote(note) {
  return String(note || "No note recorded.")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const match = line.match(/^([^:]{2,28}):\s*(.*)$/);
      return match
        ? `<div class="task-note-section"><strong>${esc(match[1])}</strong><span>${esc(match[2])}</span></div>`
        : `<p>${esc(line)}</p>`;
    })
    .join("");
}
const blockedReason = (t) =>
  adminState.taskBlockers?.[t.id] ||
  t.blockedReason ||
  "The blocking reason has not been recorded.";
function unpackTaskText(value) {
  const text = typeof value === "string" ? value : "";
  if (!text.startsWith('{"dashboardTaskText":1,'))
    return { note: text, blockedReason: "" };
  try {
    const parsed = JSON.parse(text);
    return {
      note: typeof parsed.note === "string" ? parsed.note : "",
      blockedReason:
        typeof parsed.blockedReason === "string" ? parsed.blockedReason : "",
    };
  } catch {
    return { note: text, blockedReason: "" };
  }
}
const packTaskText = (note, blocker) =>
  JSON.stringify({ dashboardTaskText: 1, note, blockedReason: blocker });
function instructionSteps(action) {
  const steps = String(action || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((step) => step.trim())
    .filter(Boolean);
  return `<ol class="admin-steps">${steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol>`;
}
function taskAdminSteps(t) {
  const packet = data?.growthSystem?.approvals.find(p => p.status === "READY" && p.taskIds.includes(t.id));
  if (packet) return `<p>${esc(packet.trigger)}</p><ol class="admin-steps">${packet.adminSteps.map(step => `<li>${esc(step)}</li>`).join("")}</ol>`;
  if (t.execution) return t.execution.release === "INTERNAL" ? "<p>None. AI completes this internal work.</p>" : "<p>None now. When the deliverable is ready, AI prepares the exact final decision or access packet; the admin does not produce the work.</p>";
  return instructionSteps(
    `Confirm you have the account, device, approval, or access needed for this task. ${t.title}. Record the result or evidence in the task note; changes save automatically.`,
  );
}
function adminActionCard(o) {
  return `<article class="action-card"><div class="meta"><small class="subtle">${esc(o.id)}</small><span class="tag ${o.status === "BLOCKED" ? "blocked" : "warn"}">${o.status === "BLOCKED" ? "Blocked" : "Admin action"}</span></div>${o.status === "BLOCKED" ? `<div class="action-detail blocked-reason"><small>WHY BLOCKED</small><p>${esc(o.why)}</p></div>` : ""}<div class="action-detail"><small>STEP-BY-STEP INSTRUCTIONS</small>${instructionSteps(o.action)}</div><div class="action-detail"><small>WHY THIS NEEDS ADMIN</small><p>${esc(o.why)}</p></div><div class="action-facts"><span><small>ENABLES</small>${esc(o.blocks)}</span><span><small>WHEN</small>${esc(o.trigger)}</span></div></article>`;
}
function taskDetail(id, currentNote = "", currentBlocker = "") {
  const t = data.tasks.find((item) => item.id === id);
  if (!t) return;
  if (t.lifecycle === "PRE_LAUNCH") return prelaunchTaskEditor(t, currentNote, currentBlocker);
  if (t.execution) return growthTaskDetail(t, currentNote, currentBlocker);
  const phase = data.phases.find((item) => item.id === t.phaseId),
    w = t.workbook || {},
    note = currentNote || adminState.taskNotes?.[t.id] || "No note recorded.",
    blocker = currentBlocker || blockedReason(t),
    source = w.sourceUrl
      ? `<a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">Open source ↗</a>`
      : esc(t.source || "Not recorded"),
    item = (name, value) =>
      `<div class="task-detail-item"><small>${esc(name)}</small><p>${value || "—"}</p></div>`;
  openDetail(
    `${t.id} · ${phase?.title || t.phaseId}`,
    t.title,
    `<div class="task-detail-summary">${tag(taskStatus(t))}<span>${taskNeedsAdmin(t) ? "Admin help needed" : "AI task"}</span></div><div class="task-detail-grid">${taskStatus(t) === "BLOCKED" ? item("Why blocked", esc(blocker)) : ""}${taskNeedsAdmin(t) ? item("Admin steps", taskAdminSteps(t)) : ""}${t.execution ? item("AI execution recipe", growthRecipe(t)) : ""}${item("Note or evidence", `<div class="task-note-expanded">${formatTaskNote(note)}</div>`)}${item("Useful for / why it matters", esc(w.guidance || "No additional guidance recorded."))}${item("Success criteria", esc(t.success))}${item("Work context", esc([w.workstream, w.priority && `${w.priority} priority`, w.support && `Support: ${w.support}`].filter(Boolean).join(" · ") || "Not recorded"))}${item("Original target", esc(t.target || "Not recorded"))}${item("Source", source)}</div>`,
  );
}
function overview() {
  const subscribers = metric("Total active subscribers");
  const feedback = data.registeredFeedback,
    passed = data.gates.filter(
      (g) => g.group === "Launch" && gateStatus(g) === "PASS",
    ).length;
  const lifecycle = activeLifecycle(),
    lifecycleTasks = data.tasks.filter((t) => t.lifecycle === lifecycle),
    nextTask = nextLifecycleTask(lifecycle);
  const lifecycleSummary = taskStatusSummary(lifecycleTasks);
  const owners = data.owners.filter((o) =>
    ["OPEN", "BLOCKED"].includes(o.status) && (lifecycle !== "GROWTH" || /GR:/.test(o.blocks)),
  );
  adminActionIndex = owners.length
    ? Math.min(adminActionIndex, owners.length - 1)
    : 0;
  const adminTask = owners[adminActionIndex],
    adminTaskView = owners.length
      ? `<div class="admin-task-carousel"><button class="admin-task-chevron" type="button" data-admin-task-nav="-1" aria-label="Previous admin task" ${owners.length > 1 ? "" : "hidden"}>‹</button><div class="admin-task-viewport">${adminActionCard(adminTask)}</div><button class="admin-task-chevron" type="button" data-admin-task-nav="1" aria-label="Next admin task" ${owners.length > 1 ? "" : "hidden"}>›</button></div><div class="admin-task-position" aria-live="polite">Admin task ${adminActionIndex + 1} of ${owners.length}</div>`
      : '<p class="subtle admin-task-empty">No admin actions are open.</p>';
  $("#main").innerHTML =
    head(
      "A clear view of what’s next.",
      adminState.project?.headline ||
        "From first feedback to lasting subscriber growth.",
    ) +
    `<div class="overview-top"><section class="panel admin-note"><div class="panel-head"><div><div class="eyebrow">SHARED PROJECT NOTE</div><h2>Overview note</h2></div><span id="note-status" class="save-status">${esc(noteSyncStatus)}</span></div><div class="panel-body"><textarea id="admin-note" rows="5" maxlength="3000" placeholder="Add a note everyone using this dashboard can see…">${esc(adminState.overviewNote)}</textarea><div class="note-actions"><small>Changes save automatically for everyone who unlocks this dashboard.</small><div class="note-buttons"><button id="clear-note" class="text-btn">Clear</button></div></div></div></section><section class="panel summary-card" aria-label="Key project numbers"><div class="panel-head"><div><div class="eyebrow">PROJECT SNAPSHOT</div><h2>Key numbers</h2></div><button class="text-btn" data-go="growth">View details ↗</button></div><div class="summary-grid">${stat("Paying subscribers", `${display(subscribers.value)} <span>/ 5</span>`, esc(subscribers.asOf))}${lifecycle === "GROWTH" ? stat("Repeat export · 7 days", display(metric("Repeat export within 7 days").value), "Mature genuine cohorts only") : stat("Useful feedback", `${feedback === null ? "—" : feedback} <span>/ 10</span>`, feedback === null ? "Not yet measured" : "3 / 6 / 10 checkpoints")}${stat("Budget remaining", money(data.budget.remaining), `${money(data.budget.spent)} spent`)}${lifecycle === "GROWTH" ? stat("Growth tasks complete", `${lifecycleSummary.counts.complete} <span>/ ${lifecycleSummary.total}</span>`, "Post-launch register") : stat("Launch checks passed", `${passed} <span>/ 10</span>`, "Evidence reviewed")}</div></section></div>` +
    `<div class="work-lanes">` +
    `<section class="panel work-lane ai-lane"><div class="lane-number">01</div><div class="lane-content"><div class="panel-head"><div><div class="eyebrow">NEXT AI TASK · ${esc(lifecycleTitle(lifecycle).toUpperCase())}</div><h2>Tell Codex to implement this next</h2><p>${lifecycle === "GROWTH" ? "Suggested preparation; Codex checks launch evidence, inputs and authorization before execution." : "The next active AI task is selected from the current lifecycle."}</p></div><span class="tag pass">${lifecycleTasks.filter(taskAvailable).length} ${lifecycle === "GROWTH" ? "unfinished recipes" : "available"}</span></div><div class="task-list">${nextTask ? (() => { const phase = data.phases.find((p) => p.id === nextTask.phaseId); return `<div class="next-item"><span class="step-num">${esc(nextTask.id.replace("WB:", ""))}</span><p><strong>${esc(nextTask.title)}</strong><br><small>${esc(nextTask.phaseId)} · ${esc(phase?.title || "")}</small></p></div>`; })() : `<p class="empty">No active AI task is registered for ${esc(lifecycleTitle(lifecycle))}.</p>`}<div class="lane-actions"><button class="text-btn" data-plan-scope="ready">View AI tasks ↗</button></div></div></div></section>` +
    `<section class="panel work-lane admin-lane"><div class="lane-number">02</div><div class="lane-content"><div class="panel-head"><div><div class="eyebrow">ADMIN HELP NEEDED</div><h2>Work AI cannot complete alone</h2><p>One action is shown at a time. Use the arrows to move through the open Owner Actions.</p></div><span class="tag ${owners.some((o) => o.status === "BLOCKED") ? "blocked" : "warn"}">${owners.length} actions</span></div><div class="panel-body">${adminTaskView}<div class="lane-actions"><button class="text-btn" data-plan-scope="admin">View tasks needing admin help ↗</button></div></div></div></section>` +
    `</div>`;
}
function plan(growthLibrary = false) {
  if (activeLifecycle() === "GROWTH" && !growthLibrary) return growth();
  if (!growthLibrary && prelaunchTab !== "records") return prelaunch();
  const feedback = data.registeredFeedback,
    current = growthLibrary ? "GROWTH" : activeLifecycle(),
    scope = data.tasks.filter((t) => t.lifecycle === current),
    taskSummary = taskStatusSummary(scope),
    phaseIds = new Set(scope.map((t) => t.phaseId)),
    phases = data.phases.filter((p) => phaseIds.has(p.id)),
    gateGroup = current === "PRE_LAUNCH" ? "Social proof" : "";
  const phasePath = `<div class="task-status-phase-path"><div class="task-status-phase-head"><div><div class="eyebrow">${current === "PRE_LAUNCH" ? "PRE-LAUNCH PATH" : "GROWTH PATH"}</div><h3>${current === "PRE_LAUNCH" ? "The path to launch readiness" : "The post-launch growth operating loop"}</h3></div></div><div class="phase-path">${phases.map((p) => `<button data-phase="${esc(p.id)}" class="${p.status === "IN PROGRESS" ? "current" : p.status === "BLOCKED" ? "blocked" : ""}" aria-label="Open ${esc(p.title)} details"><div class="track"></div><small>${esc(p.id)}</small><span class="phase-path-title" title="${esc(p.title)}">${esc(p.title)}</span><span class="phase-state">${taskCountLabel(scope.filter((t) => t.phaseId === p.id).length)} · ${esc(label(p.status))}</span></button>`).join("")}</div></div>`;
  const taskStatusPanel = `<section class="panel task-status-panel" aria-labelledby="task-status-title"><div class="panel-head"><div><div class="eyebrow">TASK STATUS</div><h2 id="task-status-title">How the work is moving</h2></div><small>${esc(lifecycleTitle(current))} · ${taskCountLabel(taskSummary.total)}</small></div><div class="task-status-layout"><div class="task-donut" role="img" aria-label="${taskSummary.percentages.complete}% complete, ${taskSummary.remainingPercent}% left, across ${taskSummary.total} tasks" style="--complete:${taskSummary.percentages.complete}%;--progress:${taskSummary.percentages.inProgress}%;--waiting:${taskSummary.percentages.waiting}%;--blocked:${taskSummary.percentages.blocked}%;"><div class="task-donut-center"><strong>${taskSummary.total ? `${taskSummary.percentages.complete}%` : "—"}</strong><span>complete</span><small>${taskSummary.total ? `${taskSummary.remainingPercent}% left` : "No tasks"}</small></div></div><div class="task-status-copy"><div class="task-status-legend"><div class="task-status-item"><i class="status-dot complete"></i><span><strong>${taskCountLabel(taskSummary.counts.complete)}</strong><small>Completed · ${taskSummary.percentages.complete}%</small></span></div><div class="task-status-item"><i class="status-dot progress"></i><span><strong>${taskCountLabel(taskSummary.counts.inProgress)}</strong><small>In progress · ${taskSummary.percentages.inProgress}%</small></span></div><div class="task-status-item"><i class="status-dot waiting"></i><span><strong>${taskCountLabel(taskSummary.counts.waiting)}</strong><small>Waiting · ${taskSummary.percentages.waiting}%</small></span></div><div class="task-status-item"><i class="status-dot blocked"></i><span><strong>${taskCountLabel(taskSummary.counts.blocked)}</strong><small>Blocked · ${taskSummary.percentages.blocked}%</small></span></div></div></div>${phasePath}</div></section>`;
  const feedbackPanel =
    current === "PRE_LAUNCH"
      ? `<section class="panel section-gap"><div class="panel-head"><h2>Feedback journey</h2><small>${feedback === null ? "Unknown" : feedback + " recorded"}</small></div><div class="panel-body"><p class="subtle">Learn, fix and retest between each wave of real creator use.</p><div class="feedback-dots" aria-label="${feedback ?? "Unknown"} of 10 feedback participants">${Array.from({ length: 10 }, (_, i) => `<i class="${feedback !== null && i < feedback ? "done" : ""}"></i>`).join("")}</div><div class="feedback-markers"><span>3 · first learning</span><span>6 · retest</span><span>10 · validate</span></div></div></section>`
      : "";
  const growthPanel =
    current === "GROWTH"
      ? `<section class="panel section-gap growth-boundary"><div class="panel-head"><div><div class="eyebrow">POST-LAUNCH ONLY</div><h2>Growth operating loop</h2></div><small>Pre-launch work stays separate</small></div><div class="panel-body"><p class="subtle">Measure → Acquire → Activate → Retain → Monetize → Learn. This view contains only the post-launch Growth register; it does not pass launch gates, authorize spend or replace pre-launch evidence.</p><div class="feedback-markers"><span>Subscribers first</span><span>Activation by successful export</span><span>Evidence before scale</span></div></div></section>`
      : "";
  $("#main").innerHTML =
    head(
      growthLibrary ? "Growth · detailed task records" : "Work plan",
      current === "GROWTH"
        ? "Only post-launch Growth tasks are shown. Pre-launch work remains separate."
        : `Only tasks and readiness checks for ${lifecycleTitle(current)} are shown.`,
      growthLibrary ? '<span class="tag neutral">Post-launch strategy</span>' : "",
    ) +
    (growthLibrary ? growthNavigation() : prelaunchNavigation()) +
    taskStatusPanel +
    `<div class="task-toolbar section-gap"><div><h2>Tasks</h2><p>Green is an AI task. Yellow needs admin help. Critical marks recurring daily, weekly or monthly work.</p></div><div class="toolbar"><select id="task-scope" aria-label="Choose task group"><option value="all" ${planTaskView === "all" ? "selected" : ""}>All tasks</option><option value="critical" ${planTaskView === "critical" ? "selected" : ""}>Critical recurring</option><option value="ready" ${planTaskView === "ready" ? "selected" : ""}>AI tasks</option><option value="admin" ${planTaskView === "admin" ? "selected" : ""}>Admin help needed</option></select><input id="task-search" type="search" placeholder="Search tasks…" aria-label="Search tasks"><select id="task-filter" aria-label="Filter tasks by status"><option value="ALL">All statuses</option>${["BLOCKED", "IN PROGRESS", "NOT STARTED", "COMPLETE"].map((s) => `<option value="${s}">${label(s)}</option>`).join("")}</select></div></div><div class="status-count" id="task-count"></div><section class="task-board" id="tasks"></section>${feedbackPanel}<section class="section-gap"><div class="page-head compact-head"><div><div class="eyebrow">${esc(gateGroup.toUpperCase())} READINESS</div><h2>Evidence before the next lifecycle step</h2><p>Open a check to review its meaning, evidence, owner and required action.</p></div></div><div class="callout">${gateGroup === "Launch" ? "Official launch requires every launch check plus the final team decision." : "Creator outreach waits for social proof and recruitment readiness."}</div><div id="gate-count" class="status-count"></div><div id="gates" class="gate-list"></div></section>`;
  const taskHelper = document.querySelector(".task-toolbar p");
  if (current === "GROWTH") {
    const recurringOption = $("#task-scope option[value='critical']");
    if (recurringOption) {
      recurringOption.value = "recurring";
      recurringOption.textContent = "Recurring";
      recurringOption.insertAdjacentHTML("afterend", `<option value="one-time" ${planTaskView === "one-time" ? "selected" : ""}>One Time</option>`);
    }
    if (taskHelper) taskHelper.textContent = "Recurring tasks repeat on a schedule. One Time tasks happen when their individual trigger applies.";
  } else {
    $("#task-scope option[value='critical']")?.remove();
    if (taskHelper) taskHelper.textContent = "Green is an AI task. Yellow needs admin help.";
  }
  const render = () => {
    const q = $("#task-search").value.toLowerCase(),
      s = $("#task-filter").value,
      group = $("#task-scope").value;
    planTaskView = group;
    const grouped = scope.filter((t) =>
        group === "ready"
          ? taskIsAI(t)
          : group === "admin"
            ? taskNeedsAdmin(t)
            : current === "GROWTH" && group === "recurring"
              ? Boolean(growthTaskCadence(t))
              : current === "GROWTH" && group === "one-time"
                ? !growthTaskCadence(t)
            : true,
      ),
      rows = grouped.filter(
        (t) =>
          (s === "ALL" || taskStatus(t) === s) &&
          `${t.id} ${t.title} ${t.phaseId}`
            .toLowerCase()
            .includes(q),
      ).sort((a, b) => Number(Boolean(growthTaskCadence(b))) - Number(Boolean(growthTaskCadence(a))) || a.sourceRow - b.sourceRow);
    $("#task-count").textContent =
      `${rows.length} of ${grouped.length} ${group === "ready" ? "AI" : group === "admin" ? "admin-help" : group === "recurring" ? "recurring" : group === "one-time" ? "one-time" : "lifecycle"} tasks`;
    const taskCard = (t) => {
          const phase = data.phases.find((p) => p.id === t.phaseId),
            status = taskStatus(t),
            note = adminState.taskNotes?.[t.id] || "",
            blocker = adminState.taskBlockers?.[t.id] || t.blockedReason || "",
            kind = taskNeedsAdmin(t) ? "admin-help" : "ai-task",
            category = taskNeedsAdmin(t) ? "Admin help needed" : "AI task",
            w = t.workbook || {},
            source = w.sourceUrl
              ? `<a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">Open source ↗</a>`
              : "—";
          return `<article class="task-row ${kind}${growthTaskCadence(t) ? " critical-task-row" : ""}" data-task-row="${esc(t.id)}"><header class="task-card-header"><div class="task-card-identity"><div class="task-card-kicker"><span>${esc(t.id)}</span><span>${esc(phase?.title || t.phaseId)}</span><span class="task-kind">${category}</span>${criticalBadge(t)}</div><h3>${esc(t.title)}</h3></div><div class="task-card-controls"><label class="task-row-status"><span>Status</span><select data-task-row-status="${esc(t.id)}">${["COMPLETE", "IN PROGRESS", "NOT STARTED", "BLOCKED"].map((v) => `<option value="${v}" ${status === v ? "selected" : ""}>${esc(label(v))}</option>`).join("")}</select></label><span class="task-save-status">${note || blocker ? "Saved" : "Auto-save on"}</span></div></header><div class="task-card-body"><section class="task-work"><div class="task-brief"><div><small>SUCCESS LOOKS LIKE</small><p>${esc(t.success)}</p></div></div><label class="blocked-reason task-row-blocker" ${status === "BLOCKED" ? "" : "hidden"}><span>WHY BLOCKED</span><textarea data-task-row-blocker="${esc(t.id)}" rows="2" maxlength="1000" placeholder="Describe why this task is blocked…">${esc(blocker)}</textarea></label>${t.execution ? `<div class="growth-task-context"><small>WHEN AI ACTS</small><p>${esc(t.execution.trigger)}</p><small>AI DELIVERABLE</small><p>${esc(t.execution.output)}</p><small>ADMIN STEPS</small>${taskAdminSteps(t)}</div>` : ""}${taskNeedsAdmin(t) ? `<div class="task-admin-instructions"><small>ADMIN STEPS</small>${taskAdminSteps(t)}</div>` : ""}</section><section class="task-row-fields"><label><span>Note or evidence</span><textarea data-task-row-note="${esc(t.id)}" rows="5" maxlength="1000" placeholder="Add a short update or evidence…">${esc(note)}</textarea></label><button class="task-detail-button" data-task-detail="${esc(t.id)}">Open full task details →</button></section></div><details class="task-baseline"><summary>Guidance, context and source</summary><div class="task-baseline-grid"><div><small>WHY IT MATTERS</small><p>${esc(w.guidance || "No additional guidance recorded.")}</p></div><div><small>SUCCESS CRITERIA</small><p>${esc(t.success)}</p></div><div><small>WORK CONTEXT</small><p>${esc([w.workstream, w.priority && `${w.priority} priority`, w.support && `Support: ${w.support}`].filter(Boolean).join(" · ") || "—")}</p></div><div><small>SOURCE</small><p>${source}</p></div></div></details></article>`;
        },
      activeRows = rows.filter((t) => taskStatus(t) !== "COMPLETE"),
      completedRows = rows.filter((t) => taskStatus(t) === "COMPLETE"),
      activeMarkup = activeRows.map(taskCard).join(""),
      completedMarkup = completedRows.length
        ? `<details class="completed-tasks"><summary><span>Completed</span><small>${completedRows.length} ${completedRows.length === 1 ? "task" : "tasks"}</small><span class="completed-chevron" aria-hidden="true">⌄</span></summary><div class="completed-task-list">${completedRows.map(taskCard).join("")}</div></details>`
        : "";
    $("#tasks").innerHTML =
      activeMarkup || completedMarkup
        ? `${activeMarkup}${completedMarkup}`
        : `<div class="panel empty">No matching ${esc(lifecycleTitle(current))} tasks.</div>`;
  };
  $("#task-search").addEventListener("input", render);
  $("#task-filter").addEventListener("change", render);
  $("#task-scope").addEventListener("change", render);
  render();
  if (!gateGroup) $("#gates")?.closest("section")?.remove();
  if (gateGroup) showGates(gateGroup);
}
const prelaunchDrafts = new Map();
let prelaunchSearch = "", prelaunchFilter = "active";
const prelaunchStatuses = ["NOT STARTED", "IN PROGRESS", "BLOCKED", "COMPLETE"];
const prelaunchNote = t => adminState.taskNotes?.[t.id] ?? t.evidence ?? "";
function prelaunchTaskEditor(t, currentNote = "", currentBlocker = "") {
  const recordedNote = currentNote || prelaunchNote(t);
  const recordedBlocker = currentBlocker || adminState.taskBlockers?.[t.id] || t.blockedReason || "";
  const longRecord = packTaskText(recordedNote, recordedBlocker).length > 1000;
  const draft = prelaunchDrafts.get(t.id) || {
    status: taskStatus(t), note: longRecord ? "" : recordedNote,
    blocker: recordedBlocker,
  };
  const phase = data.phases.find(p => p.id === t.phaseId);
  openDetail("PRE-LAUNCH · NOTES & UPDATE", t.title, `<form class="prelaunch-editor" data-prelaunch-editor="${esc(t.id)}">
    <p class="subtle">${esc(phase?.title || t.phaseId)} · ${esc(t.id)}</p>
    <p>${esc(t.success)}</p>
    <label>Task status<select name="status" required>${!prelaunchStatuses.includes(draft.status) ? '<option value="">Choose a status to save an update</option>' : ""}${prelaunchStatuses.map(s => `<option value="${s}" ${draft.status === s ? "selected" : ""}>${label(s)}</option>`).join("")}</select></label>
    <label class="prelaunch-blocker" ${draft.status === "BLOCKED" ? "" : "hidden"}>What is holding this up?<textarea name="blocker" rows="2" maxlength="900" placeholder="What do you need to continue?">${esc(draft.blocker)}</textarea></label>
    ${longRecord ? '<p class="subtle">The earlier detailed note is preserved below. Write a short new update here.</p>' : ""}
    <label>Admin notes & evidence<textarea name="note" rows="7" maxlength="1000" placeholder="What happened? Add observations, decisions, links, or the next step.">${esc(draft.note)}</textarea></label>
    <div class="prelaunch-note-help"><span>Completion needs evidence. Blocked tasks need a reason.</span><span data-note-capacity></span></div>
    <div class="prelaunch-editor-actions"><button type="submit">Save update</button><span role="status" aria-live="polite" data-editor-status>${prelaunchDrafts.has(t.id) ? "Unsaved draft — kept while you browse" : "Updates are shared across devices"}</span></div>
    ${growthMore("Recorded evidence", `<div class="task-note-expanded">${formatTaskNote(data.adminState?.taskNotes?.[t.id] || t.evidence || recordedNote)}</div>`)}
    ${taskNeedsAdmin(t) ? growthMore("Admin steps", taskAdminSteps(t)) : ""}
    ${growthMore("Guidance & source record", `<p>${esc(t.workbook?.guidance || "No additional guidance recorded.")}</p><p><strong>Source status:</strong> ${esc(t.status)}</p><p><strong>Original target:</strong> ${esc(t.target || "Not recorded")}</p><p>${esc(t.source || "")}</p><p>Saved updates do not by themselves approve outreach, spending or launch.</p>`)}
  </form>`);
  updatePrelaunchCapacity($("[data-prelaunch-editor]"));
}
function readPrelaunchDraft(form) {
  return { status: form.elements.status.value, note: form.elements.note.value, blocker: form.elements.blocker.value };
}
function updatePrelaunchCapacity(form) {
  const draft = readPrelaunchDraft(form);
  const remaining = 1000 - packTaskText(draft.note.trim(), draft.blocker.trim()).length;
  form.querySelector("[data-note-capacity]").textContent = remaining < 0 ? `${-remaining} characters over the limit` : `${remaining} characters available`;
}
document.addEventListener("input", event => {
  const form = event.target.closest("[data-prelaunch-editor]");
  if (!form) return;
  prelaunchDrafts.set(form.dataset.prelaunchEditor, readPrelaunchDraft(form));
  form.querySelector(".prelaunch-blocker").hidden = form.elements.status.value !== "BLOCKED";
  form.querySelector("[data-editor-status]").textContent = "Unsaved draft — kept while you browse";
  updatePrelaunchCapacity(form);
});
document.addEventListener("submit", async event => {
  const form = event.target.closest("[data-prelaunch-editor]");
  if (!form) return;
  event.preventDefault();
  const id = form.dataset.prelaunchEditor, draft = readPrelaunchDraft(form);
  prelaunchDrafts.set(id, draft);
  const message = form.querySelector("[data-editor-status]");
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  message.textContent = "Saving…";
  try {
    await saveSharedTask(id, draft.status, draft.note.trim(), draft.blocker.trim());
    if (JSON.stringify(prelaunchDrafts.get(id)) === JSON.stringify(draft)) {
      prelaunchDrafts.delete(id);
      message.textContent = "Saved for everyone";
    } else message.textContent = "Earlier update saved. Save your latest changes when ready.";
    if (view === "plan" && activeLifecycle() === "PRE_LAUNCH") plan();
  } catch (error) {
    message.textContent = `${error.message} Your draft is still here; try saving again.`;
  } finally { button.disabled = false; }
});
window.addEventListener("beforeunload", event => {
  if (!prelaunchDrafts.size) return;
  event.preventDefault();
  event.returnValue = "";
});
function prelaunchNavigation() {
  const selected = prelaunchTab === "records" ? "work" : prelaunchTab;
  return `<nav class="growth-tabs" aria-label="Pre-launch sections">${[["home", "Summary"], ["roadmap", "Roadmap"], ["work", "Tasks"], ["readiness", "Readiness"]].map(([id, title]) => `<button data-prelaunch-tab="${id}" class="${selected === id ? "selected" : ""}" aria-current="${selected === id ? "page" : "false"}">${title}</button>`).join("")}</nav>`;
}
function prelaunch() {
  const tasks = data.tasks.filter(t => t.lifecycle === "PRE_LAUNCH");
  const summary = taskStatusSummary(tasks);
  const next = nextLifecycleTask("PRE_LAUNCH");
  const owners = data.owners.filter(o => ["OPEN", "BLOCKED"].includes(o.status) && !/GR:/.test(o.blocks));
  const feedback = data.registeredFeedback;
  const links = items => `<div class="prelaunch-task-list">${items.map(t => `<article class="prelaunch-task-card"><div class="prelaunch-task-heading"><h3>${esc(t.title)}</h3>${tag(prelaunchStatuses.includes(taskStatus(t)) ? taskStatus(t) : "Review task update")}</div><p class="prelaunch-note-preview">${esc(prelaunchDrafts.get(t.id)?.note || prelaunchNote(t) || "No notes yet. Add an update, decision or evidence.")}</p><div class="prelaunch-task-footer"><small>${esc(t.id)} · ${taskNeedsAdmin(t) ? "Admin help needed" : "AI task"}${prelaunchDrafts.has(t.id) ? " · Unsaved draft" : ""}</small><button class="quiet" data-task-detail="${esc(t.id)}">Notes & update status →</button></div></article>`).join("")}</div>`;
  let body = "";
  if (prelaunchTab === "home") {
    body = `<section class="growth-goal"><div><small>OUR NEXT GOAL</small><h2>Learn from 10 creators. Get ready to launch.</h2><p>Prepare the product and public presence, collect useful feedback, then fix and retest.</p></div><span class="tag neutral">Pre-launch only</span></section>`;
    body += `<section class="stats growth-summary-stats">${stat("Tasks complete", `${summary.counts.complete} <span>/ ${summary.total}</span>`, "Across the pre-launch plan")}${stat("Useful feedback", `${feedback == null ? "—" : feedback} <span>/ 10</span>`, feedback == null ? "Not measured yet" : "Learn at 3, 6 and 10 creators")}${stat("Open admin actions", owners.length, "Decisions, access or hands-on help")}</section>`;
    body += `<div class="growth-grid">${growthPanel("AI’s next task", next ? `<h3>${esc(next.title)}</h3><p>${esc(next.success)}</p><button class="quiet" data-task-detail="${esc(next.id)}">Notes & update status</button><p class="subtle">Codex checks this task’s dependencies before starting.</p>` : '<p>No unfinished AI task is available.</p>')}${growthPanel(owners.length ? "Your action needed" : "Your actions", owners.length ? `<p>${owners.length} open ${owners.length === 1 ? "action" : "actions"}. Open an item for the exact steps.</p>${owners.map(o => growthMore(esc(o.trigger), `<h3>Admin steps</h3>${instructionSteps(o.action)}<p><strong>When:</strong> ${esc(o.trigger)}</p><p><strong>Unlocks:</strong> ${esc(o.blocks)}</p><div class="prelaunch-action-links">${tasks.filter(t => (o.blocks.match(/(?:WB:)?[A-Z]\d{2}[A-Z]?/g) || []).some(id => t.id === (id.startsWith("WB:") ? id : `WB:${id}`))).map(t => `<button type="button" class="quiet" data-task-detail="${esc(t.id)}">Update ${esc(t.id.replace("WB:", ""))} & notes</button>`).join("")}<button type="button" class="text-btn" data-project-notepad>Add a project note</button></div>`)).join("")}` : '<p class="growth-none">Nothing needed from you.</p>')}</div>`;
    body += `<section class="panel prelaunch-notepad"><div class="panel-head"><div><h2>Project notepad</h2><p>Quick reminders, decisions and questions. This is the same shared note shown on Overview.</p></div><span id="note-status" class="save-status" role="status">${esc(noteSyncStatus)}</span></div><div class="panel-body"><label for="admin-note">Admin notes</label><textarea id="admin-note" rows="4" maxlength="3000" placeholder="Jot down what to follow up on…">${esc(adminState.overviewNote)}</textarea><small>Saved automatically. Use a task’s notes for task-specific evidence.</small></div></section>`;
    body += `<div class="growth-simple-footer"><p>Independent work can move forward together. Each task keeps its own dependencies.</p><button class="text-btn" data-prelaunch-tab="work">Browse pre-launch tasks →</button></div>`;
  } else if (prelaunchTab === "roadmap") {
    const phases = data.phases.filter(p => tasks.some(t => t.phaseId === p.id));
    body = `<div class="growth-intro"><h2>The path to launch</h2><p>Seven areas of work, with fixes and retests between feedback waves.</p></div>`;
    body += growthPanel("The pre-launch plan", `<p class="subtle">Open an area to see its tasks. These areas can move forward together when their dependencies allow.</p><div class="growth-simple-phases">${phases.map(p => { const items = tasks.filter(t => t.phaseId === p.id); const done = items.filter(t => taskStatus(t) === "COMPLETE").length; return growthMore(`<span class="growth-phase-name">${esc(p.title)}</span><span class="growth-phase-description">${done} of ${items.length} tasks complete</span>`, `${links(items)}<button class="text-btn" data-phase="${esc(p.id)}">Phase details →</button>`); }).join("")}</div>`);
  } else if (prelaunchTab === "work") {
    body = `<div class="growth-intro"><h2>Find the work you need</h2><p>Open any task to add notes, change its status, or explain a blocker.</p></div><div class="toolbar"><input id="prelaunch-search" type="search" aria-label="Search pre-launch tasks" placeholder="Search tasks or notes…" value="${esc(prelaunchSearch)}"><select id="prelaunch-filter" aria-label="Filter pre-launch tasks"><option value="active">Unfinished tasks</option><option value="ai">AI tasks</option><option value="admin">Admin help needed</option><option value="complete">Completed tasks</option><option value="notes">With notes</option><option value="all">All tasks</option></select></div><p id="prelaunch-count" class="status-count" aria-live="polite"></p><div id="prelaunch-tasks"></div><div class="growth-simple-footer"><p>Prefer to edit several tasks on one page?</p><button class="text-btn" data-prelaunch-tab="records">Edit detailed task records →</button></div>`;
  } else {
    body = `<div class="growth-intro"><h2>Evidence before the next step</h2><p>Review social proof before outreach, and launch checks before the final launch decision.</p></div>`;
    body += growthPanel("Feedback progress", `<p><strong>${feedback == null ? "Not measured yet" : `${feedback} of 10 useful feedback completions`}</strong></p><div class="feedback-dots" aria-label="${feedback ?? "Unknown"} of 10 feedback participants">${Array.from({ length: 10 }, (_, i) => `<i class="${feedback != null && i < feedback ? "done" : ""}"></i>`).join("")}</div><div class="feedback-markers"><span>3 · learn</span><span>6 · fix and retest</span><span>10 · validate</span></div>`);
    body += `<section class="section-gap"><div class="growth-tabs" aria-label="Readiness groups"><button data-gate-group="Social proof">Social proof & outreach</button><button data-gate-group="Launch">Launch checks</button></div><p class="subtle">A saved review does not itself approve outreach, spending or launch.</p><div id="gate-count" class="status-count"></div><div id="gates" class="gate-list"></div></section>`;
  }
  $("#main").innerHTML = head("Pre-Launch", "See what’s next, where help is needed, and how launch preparation is progressing.") + prelaunchNavigation() + `<div class="growth-workspace growth-simple prelaunch-workspace">${body}</div>`;
  if (prelaunchTab === "readiness") showGates("Social proof");
  if (prelaunchTab === "work") {
    $("#prelaunch-filter").value = prelaunchFilter;
    const render = () => {
      const query = $("#prelaunch-search").value.trim().toLowerCase();
      const filter = $("#prelaunch-filter").value;
      prelaunchSearch = $("#prelaunch-search").value; prelaunchFilter = filter;
      const shown = tasks.filter(t => `${t.id} ${t.title} ${t.phaseId} ${prelaunchNote(t)}`.toLowerCase().includes(query) && (filter === "all" || (filter === "notes" ? Boolean(prelaunchNote(t) || prelaunchDrafts.has(t.id)) : filter === "complete" ? taskStatus(t) === "COMPLETE" : taskStatus(t) !== "COMPLETE" && (filter === "ai" ? taskIsAI(t) : filter === "admin" ? taskNeedsAdmin(t) : true))));
      $("#prelaunch-count").textContent = `${shown.length} of ${tasks.length} pre-launch tasks`;
      $("#prelaunch-tasks").innerHTML = shown.length ? links(shown) : '<p class="empty">No matching tasks.</p>';
    };
    $("#prelaunch-search").addEventListener("input", render);
    $("#prelaunch-filter").addEventListener("change", render);
    render();
  }
}
function showGates(group, openId = "") {
  const gates = data.gates.filter((g) => g.group === group);
  document.querySelectorAll("[data-gate-group]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.gateGroup === group);
    b.setAttribute("aria-pressed", String(b.dataset.gateGroup === group));
  });
  $("#gate-count").textContent =
    `${gates.filter((g) => gateStatus(g) === "PASS").length} of ${gates.length} passed · reviewed evidence required`;
  const detail = (name, value) =>
    value && value !== "—"
      ? `<div class="gate-detail"><small>${esc(name)}</small><p>${esc(value)}</p></div>`
      : "";
  $("#gates").innerHTML = gates
    .map((g) => {
      const status = gateStatus(g),
        reviewed = Boolean(adminState.gateOverrides[g.id]);
      return `<details class="gate" data-gate-id="${esc(g.id)}" ${openId === g.id ? "open" : ""}><summary><div class="gate-copy"><small>${esc(g.id)} · ${esc(g.type)}${reviewed ? " · DASHBOARD REVIEWED" : ""}</small><h3>${esc(g.title)}</h3></div><div class="gate-state">${tag(status)}<span class="gate-chevron" aria-hidden="true">⌄</span></div></summary><div class="gate-details">${detail("Why it matters", g.clarification)}${detail("Related task", g.task)}${detail("Evidence / source", g.source)}${detail("Target", g.target)}${detail("Owner", g.owner)}${detail("Action if not passed", g.action)}${detail("Current source evidence", g.evidence)}<div class="gate-review"><div class="gate-review-head"><div><small>YOUR REVIEW</small><h4>Evidence or decision input</h4></div><span class="save-status" id="gate-save-${esc(g.id)}">Auto-save on</span></div><div class="gate-review-fields"><label>Status<select data-gate-status="${esc(g.id)}">${["WAIT", "PASS", "FAIL"].map((v) => `<option value="${v}" ${status === v ? "selected" : ""}>${esc(label(v))}</option>`).join("")}</select></label><label class="gate-note-field">Your evidence or clarification<textarea data-gate-note="${esc(g.id)}" rows="4" maxlength="2000" placeholder="What did you review? Add evidence, decision details, links, reviewer and date.">${esc(adminState.gateNotes?.[g.id] || "")}</textarea></label></div><div class="gate-review-actions"><small>Changes save automatically. Passed or Needs work still requires evidence or a decision note.</small></div></div></div></details>`;
    })
    .join("");
}
function growthNavigation() {
  const selected = ["tasks", "rhythm"].includes(growthTab) ? "work" : growthTab;
  return `<nav class="growth-tabs" aria-label="Growth sections">${[["home","Summary"],["roadmap","Roadmap"],["work","AI work"],["strategy","Growth plan"],["evidence","Results"]].map(([id,title]) => `<button data-growth-tab="${id}" class="${selected === id ? "selected" : ""}" aria-current="${selected === id ? "page" : "false"}">${title}</button>`).join("")}</nav>`;
}
const growthTaskTitle = t => t.execution?.adminTitle || t.title;
const growthTaskSummary = t => t.execution?.adminSummary || t.success;
const recurringCadences = new Set(["DAILY", "WEEKLY", "MONTHLY"]);
const growthTaskCadence = t => recurringCadences.has(t.execution?.cadence) ? t.execution.cadence : "";
const cadenceLabel = cadence => cadence ? cadence[0] + cadence.slice(1).toLowerCase() : "";
const growthTaskType = t => growthTaskCadence(t) ? "RECURRING" : "ONE_TIME";
const taskTypeBadge = (t, compact = false) => {
  const cadence = growthTaskCadence(t);
  return cadence
    ? `<span class="task-type-badge recurring${compact ? " compact" : ""}" title="Repeats on a ${cadenceLabel(cadence).toLowerCase()} schedule">Recurring · ${cadenceLabel(cadence)}</span>`
    : `<span class="task-type-badge one-time${compact ? " compact" : ""}" title="Complete when its individual trigger applies">One Time</span>`;
};
const criticalBadge = (t, compact = false) => t.lifecycle === "GROWTH" ? taskTypeBadge(t, compact) : "";
function taskTypeSummary(tasks) {
  const recurring = tasks.filter(t => growthTaskType(t) === "RECURRING");
  const oneTime = tasks.filter(t => growthTaskType(t) === "ONE_TIME");
  const cadenceCounts = ["DAILY", "WEEKLY", "MONTHLY"].map(cadence => `${recurring.filter(t => growthTaskCadence(t) === cadence).length} ${cadenceLabel(cadence).toLowerCase()}`).join(" · ");
  return `<section class="growth-task-types"><article class="task-type-summary recurring"><span class="task-type-badge recurring">Recurring</span><h2>${recurring.length} repeating tasks</h2><p>Run these on their daily, weekly or monthly schedule.</p><small>${esc(cadenceCounts)}</small></article><article class="task-type-summary one-time"><span class="task-type-badge one-time">One Time</span><h2>${oneTime.length} event-triggered tasks</h2><p>Use these when the task’s individual condition is met.</p><small>They do not repeat on a fixed schedule.</small></article></section>`;
}
function oneTimeTaskList(tasks) {
  const button = t => `<button class="growth-simple-task ${growthTaskType(t) === "RECURRING" ? "recurring-simple-task" : "one-time-simple-task"}" data-task-detail="${esc(t.id)}" data-growth-searchable="${esc(`${t.id} ${growthTaskTitle(t)} ${growthTaskSummary(t)}`.toLowerCase())}"><span class="growth-simple-task-copy">${taskTypeBadge(t, true)}${esc(growthTaskTitle(t))}</span><small>${esc(label(taskStatus(t)))}</small></button>`;
  const matching = tasks.filter(t => growthTaskType(t) === "ONE_TIME").sort((a, b) => a.sourceRow - b.sourceRow);
  return `<section class="growth-task-type-list one-time"><header><span class="task-type-badge one-time">One Time</span><strong>${matching.length} tasks</strong><p>Use these when the listed condition or opportunity occurs.</p></header><div class="growth-simple-tasks">${matching.map(button).join("")}</div></section>`;
}
function routineTaskList(tasks, routineId) {
  const cadence = routineId.toUpperCase();
  const matching = tasks.filter(t => growthTaskCadence(t) === cadence).sort((a, b) => a.sourceRow - b.sourceRow);
  return `<div class="routine-task-list"><div class="routine-task-list-head"><span class="task-type-badge recurring">Recurring</span><strong>${matching.length} ${matching.length === 1 ? "task" : "tasks"}</strong></div><ul>${matching.map(t => `<li><button class="text-btn" data-task-detail="${esc(t.id)}">${esc(growthTaskTitle(t))}</button></li>`).join("")}</ul></div>`;
}
const growthMore = (title, body, extra = "") => `<details class="growth-more ${extra}"><summary>${title}</summary><div class="growth-more-body">${body}</div></details>`;
function growthTaskDetail(t, currentNote = "", currentBlocker = "") {
  const packet = data.growthSystem.approvals.find(p => p.status === "READY" && p.taskIds.includes(t.id));
  const note = currentNote || adminState.taskNotes?.[t.id] || t.evidence;
  openDetail("AI TASK", growthTaskTitle(t), `<div class="growth-simple-detail">${tag(taskStatus(t))}${taskTypeBadge(t)}<p class="growth-lead">${esc(growthTaskSummary(t))}</p>${taskStatus(t) === "BLOCKED" ? `<p><strong>What is holding this up:</strong> ${esc(currentBlocker || blockedReason(t))}</p>` : ""}<h3>Your part</h3>${packet ? `<h4>Admin steps</h4>${taskAdminSteps(t)}` : '<p>None now. AI handles the preparation and asks when a decision is ready.</p>'}<button class="quiet" data-growth-brief="${esc(t.id)}">Copy instructions for Codex</button><p class="subtle">Paste into Codex to request this task. Copying does not start it.</p>${growthMore("Latest task note", `<div class="task-note-expanded">${formatTaskNote(note)}</div>`)}${growthMore("Full AI instructions", `<p class="subtle">${esc(t.id)}</p>${growthRecipe(t)}<h3>Success looks like</h3><p>${esc(t.success)}</p>`)}</div>`);
}
function growthRecipe(t) {
  const r = t.execution;
  if (!r) return "";
  return `<p><strong>When:</strong> ${esc(r.trigger)}</p><p><strong>Read first:</strong> ${r.inputs.map(path => `<button class="text-btn" data-doc="${esc(path)}">${esc(path.split("/").pop())}</button>`).join(" · ")}</p><ol>${r.steps.map(step => `<li>${esc(step)}</li>`).join("")}</ol><p><strong>Produce:</strong> ${esc(r.output)}</p><p><strong>Record in:</strong> ${esc(r.recordIn)}</p><p><strong>Release boundary:</strong> ${esc(r.release === "INTERNAL" ? "AI can complete internal work under existing authority." : "AI prepares and verifies the whole deliverable. The final public, message, product or financial action requires its applicable existing authorization.")}</p><p><strong>Admin steps:</strong></p>${taskAdminSteps(t)}<p><strong>Stop:</strong> ${esc(r.stop)}</p><p><strong>Afterward:</strong> ${esc(r.after)}</p><button class="quiet" data-growth-brief="${esc(t.id)}">Copy task brief for Codex</button>`;
}
function growthBrief(id) {
  const t = data.tasks.find(t => t.id === id);
  const r = data.growthSystem?.routines.find(r => r.id === id);
  const taskText = t?.execution ? `${t.id}: ${t.title}. Trigger: ${t.execution.trigger}. Inputs: ${t.execution.inputs.join(", ")}. Steps: ${t.execution.steps.join("; ")}. Output: ${t.execution.output}. Verify: ${t.execution.verify}. Record in: ${t.execution.recordIn}. Release boundary: ${t.execution.release}. Stop: ${t.execution.stop}` : `${r?.title || "Daily Growth run"}: ${(r?.steps || []).join("; ")}`;
  return `Work only in the Reaction Creator post-launch Growth system. Read 00_ADMIN/PROJECT_INSTRUCTIONS.md, 01_STRATEGY/GROWTH_EXECUTION.md and 01_STRATEGY/GROWTH_OPERATING_SYSTEM.json, plus current Growth task evidence, metrics, budget and lessons. ${taskText} Check the authoritative launch decision; before GO only prepare explicitly requested safe internal work. Check the task-specific inputs and exact existing authorization before acting. Do not send messages, publish, change product/pricing or commit money without the required explicit authorization. Reuse a completed period receipt and inspect uncertain prior outcomes before retrying. Finish all safe independent work; create a concrete final admin packet only when necessary. Record actual outputs, evidence, lesson and next review date; do not call drafts published or a recurring routine scheduled. Refresh and validate the encrypted dashboard after material updates.`;
}
function growthPanel(title, body, extra = "") {
  return `<section class="panel growth-panel"><div class="panel-head"><h2>${title}</h2>${extra}</div><div class="panel-body">${body}</div></section>`;
}
function growthMetricCard(key, title, explanation = "") {
  const m = metric(key), unknown = m.value === "UNKNOWN";
  return `<article class="stat"><div class="label">${esc(title)}</div><div class="number ${unknown ? "growth-unknown" : ""}">${unknown ? "Not measured yet" : display(m.value)}</div><div class="note">${esc(unknown ? explanation : m.asOf)}</div></article>`;
}
function growthScorecard() {
  return `<section class="stats growth-stats">${growthMetricCard("Total active subscribers","Paying subscribers")}${growthMetricCard("MRR","Monthly recurring revenue")}${growthMetricCard("Activated users","Users who finished a first video","A successful saved export.")}${growthMetricCard("Repeat export within 7 days","Users who created again","Another video on a later day within a week.")}</section>`;
}
function growth() {
  const g = data.growthSystem;
  if (!g) { $("#main").innerHTML = head("Growth", "Refresh to load the growth plan."); return; }
  if (growthTab === "tasks") return plan(true);
  if (growthTab === "rhythm") growthTab = "work";
  const simple = g.adminView;
  if (!simple) { $("#main").innerHTML = head("Growth", "Refresh to load the simplified growth plan."); return; }
  const tasks = data.tasks.filter(t => t.lifecycle === "GROWTH");
  const launch = data.growthLaunchAuthorized === true;
  const pending = g.approvals.filter(p => p.status === "READY");
  const next = tasks.find(t => t.id === g.focus.nextTask && taskAvailable(t)) || tasks.find(taskAvailable);
  const docButton = (path, title) => `<button class="text-btn" data-doc="${esc(path)}">${esc(title)} ↗</button>`;
  const adminContent = pending.length ? pending.map(p => `<article class="growth-decision"><h3>${esc(p.decision)}</h3><p>${esc(p.trigger)}</p>${docButton(p.deliverable,"Review prepared work")}<h4>Admin steps</h4><ol>${p.adminSteps.map(step=>`<li>${esc(step)}</li>`).join("")}</ol></article>`).join("") : '<p class="growth-none">Nothing needed from you.</p><p>AI will ask when a decision or access is needed.</p>';
  const nextContent = next ? `<h3>${esc(growthTaskTitle(next))}</h3><p>${esc(growthTaskSummary(next))}</p><button class="quiet" data-task-detail="${esc(next.id)}">View task</button>` : '<p>No unfinished AI task is available.</p>';
  const automation = g.scheduler.status === "NOT_SCHEDULED" ? "Automatic runs are not set up yet." : `Automatic runs: ${g.scheduler.status}.`;
  const receipts = g.runs.length ? `<ul>${g.runs.slice(-5).reverse().map(r => `<li><strong>${esc(growthTaskTitle(tasks.find(t=>t.id===r.taskId) || {title:r.taskId}))}</strong> · ${esc(r.status)}<p>${esc(r.evidence || r.output || "No result recorded")}</p></li>`).join("")}</ul>` : '<p>No growth runs recorded yet.</p>';
  let body = "";
  if (growthTab === "home") {
    const count = Number(metric("Total active subscribers").value);
    const target = g.milestones.find(m => !Number.isFinite(count) || m.target > count)?.target;
    body = `<section class="growth-goal"><div><small>OUR NEXT GOAL</small><h2>${target ? `${target} paying subscribers` : "Choose the next subscriber goal"}</h2><p>${esc(simple.planSummary)}</p></div><span class="tag neutral">${launch ? "Launch approved" : "Growth starts after launch"}</span></section>`;
    body += `<section class="stats growth-stats growth-summary-stats">${growthMetricCard("Total active subscribers","Paying subscribers")}${growthMetricCard("MRR","Monthly recurring revenue")}<article class="stat"><div class="label">Budget left</div><div class="number">${money(data.budget.remaining)}</div><div class="note">${money(data.budget.spent)} spent of ${money(data.budget.total)}</div></article></section>`;
    body += `<div class="growth-grid">${growthPanel("AI’s next task", nextContent)}${growthPanel(pending.length ? "Your action needed" : "Your actions",adminContent)}</div>`;
    body += `<div class="growth-simple-footer"><p>${esc(automation)} AI’s daily and weekly routines are ready to use.</p><button class="text-btn" data-growth-tab="work">See what AI will do →</button></div>`;
  } else if (growthTab === "work") {
    body = `<div class="growth-intro"><h2>AI handles the ongoing work</h2><p>Research, prepare, carry out approved work, and record the results.</p><p class="subtle">${esc(automation)}</p></div>${taskTypeSummary(tasks)}<div class="growth-routines">${simple.routines.map(r => growthPanel(esc(r.title), `<p>${esc(r.summary)}</p>${routineTaskList(tasks, r.id)}${growthMore("See the steps",`<ol>${r.steps.map(step=>`<li>${esc(step)}</li>`).join("")}</ol><button class="quiet" data-growth-brief="${esc(r.id)}">Copy ${esc(r.id)} instructions</button><p class="subtle">Paste into Codex to request this routine. Copying does not start it.</p>${growthMore("Detailed run instructions", `<ol>${g.routines.find(full=>full.id===r.id).steps.map(step=>`<li>${esc(step)}</li>`).join("")}</ol>${docButton("01_STRATEGY/GROWTH_EXECUTION.md","Full operating guide")}`)}`)}`)).join("")}</div>`;
    const oneTimeCount = tasks.filter(t => growthTaskType(t) === "ONE_TIME").length;
    body += growthMore(`Browse ${oneTimeCount} One Time AI tasks`, `<p class="subtle">Recurring tasks are listed above in Every day, Every week and Every month.</p><label class="growth-search-label">Find a one-time task<input id="growth-task-search" type="search" placeholder="Try website, partners or ads"></label>${oneTimeTaskList(tasks)}<p id="growth-search-empty" hidden>No matching tasks.</p><button class="text-btn" data-growth-tab="tasks">Edit detailed task records →</button>`);
    body += growthMore("Recent AI activity", receipts);
    if (pending.length) body = growthPanel("Your action needed",adminContent) + body;
  } else if (growthTab === "strategy") {
    body = `<div class="growth-intro"><h2>How we’ll grow</h2><p>${esc(simple.planSummary)} AI adjusts the plan as results come in.</p></div>`;
    body += growthPanel("The growth plan", `<p class="subtle">These areas can move forward together. Open any area to see its tasks.</p><div class="growth-simple-phases">${simple.phases.map(w=>growthMore(`<span class="growth-phase-name">${esc(w.title)}</span><span class="growth-phase-description">${esc(w.summary)}</span>`, `<ul class="growth-task-links">${tasks.filter(t=>t.phaseId===w.id).map(t=>`<li><button class="text-btn" data-task-detail="${esc(t.id)}">${criticalBadge(t, true)}${esc(growthTaskTitle(t))}</button></li>`).join("")}</ul>`)).join("")}</div>`);
    body += growthMore("Our goals: 5 → 10 → 25 → 50 → 100 subscribers", `<div class="growth-simple-milestones">${simple.milestones.map(m=>`<article><strong>${m.target}</strong><span>${esc(m.summary)}</span><button class="text-btn" data-growth-milestone="${m.target}">Details</button></article>`).join("")}</div><p class="subtle">These are goals, not forecasts. AI checks customer results before expanding.</p>`);
    body += growthMore("Where we’ll find customers", `<div class="growth-channel-list">${g.channels.map(c=>`<article><h3>${esc(c.name)}</h3><p>${esc(c.strategy)}</p>${growthMore("How AI checks results",`<p>${esc(c.measure)}</p>${docButton(c.record,"Open results")}`)}</article>`).join("")}</div>`);
    body += growthMore("What we’ve learned", `<ul class="growth-plain-lessons"><li>Count real paying customers. Views and clicks alone do not show growth.</li><li>Give new users time to try the app before judging results.</li><li>AI prepares the work; you only step in for decisions or access.</li><li>Automatic publishing must use a supported, authorized account.</li></ul>${docButton("02_RESEARCH/GROWTH_DASHBOARD_RESEARCH.md","Research and sources")}${docButton("08_EXPERIMENTS/LEARNINGS.md","All recorded lessons")}`);
  } else if (growthTab === "roadmap") {
    const subscribers = Number(metric("Total active subscribers").value);
    const hasCount = Number.isFinite(subscribers);
    const currentTarget = hasCount ? simple.milestones.find(m => subscribers < m.target)?.target : simple.milestones[0].target;
    const requestedTarget = Number(growth.roadmapTarget);
    const selectedTarget = g.milestones.some(m => m.target === requestedTarget) ? requestedTarget : currentTarget || g.milestones.at(-1).target;
    const selected = g.milestones.find(m => m.target === selectedTarget);
    const selectedIndex = g.milestones.findIndex(m => m.target === selectedTarget);
    const progressLabel = hasCount ? `${subscribers} of ${simple.milestones[simple.milestones.length - 1].target} paying subscribers` : "Subscriber count not measured yet";
    const stageState = (target) => hasCount && subscribers >= target ? "complete" : target === currentTarget ? "current" : "upcoming";
    const roadmapStages = g.milestones.map((m, index) => {
      const state = stageState(m.target);
      const isSelected = m.target === selectedTarget;
      return `<button class="roadmap-step ${state}${isSelected ? " selected" : ""}" data-roadmap-target="${m.target}" aria-label="Stage ${index + 1}: ${m.target} subscribers, ${esc(m.name || m.focus)}" aria-pressed="${isSelected}"><span class="roadmap-step-marker">${state === "complete" ? "✓" : index + 1}</span><span class="roadmap-step-copy"><small>${state === "complete" ? "Reached" : state === "current" ? "Now" : "Later"}</small><strong>${m.target}<span> subscribers</span></strong><em>${esc(m.name || m.focus)}</em></span></button>`;
    }).join("");
    const selectedState = stageState(selected.target);
    const selectedStatus = selectedState === "complete" ? "Milestone reached" : selectedState === "current" ? "Current focus" : "Future stage";
    body = `<section class="roadmap-intro"><div><small>STRATEGIC ROADMAP</small><h2>Prove value before scaling reach</h2><p>AI advances only when real customer behavior supports the next move.</p></div><div class="roadmap-progress"><strong>${esc(progressLabel)}</strong><span>${hasCount ? `Next milestone: ${currentTarget || "set the next goal"}` : "Waiting for a verified baseline"}</span></div></section><section class="roadmap-track" aria-label="Choose a growth milestone">${roadmapStages}</section><article class="roadmap-detail ${selectedState}"><header class="roadmap-detail-head"><div><small>STAGE ${selectedIndex + 1} OF ${g.milestones.length} · ${selected.target} PAYING SUBSCRIBERS</small><h2>${esc(selected.name || selected.focus)}</h2><p>${esc(selected.outcome || selected.focus)}</p></div><span class="roadmap-status">${selectedStatus}</span></header><div class="roadmap-detail-grid"><section><div class="roadmap-section-label"><span>1</span><strong>What AI concentrates on</strong></div><ul>${(selected.priorities || [selected.actions]).map(item => `<li>${esc(item)}</li>`).join("")}</ul></section><section><div class="roadmap-section-label"><span>2</span><strong>Evidence that unlocks the next stage</strong></div><p>${esc(selected.evidence)}</p><div class="roadmap-next"><small>THEN</small><span>${esc(selected.next)}</span></div></section></div><section class="roadmap-watch"><strong>Watch these signals</strong><div>${(selected.watch || []).map(item => `<span>${esc(item)}</span>`).join("")}</div></section><p class="roadmap-avoid"><strong>Protect the strategy:</strong> ${esc(selected.avoid || "Do not expand without real subscriber evidence.")}</p><footer><span>AI prepares and executes within existing authority.</span><span>Admin only reviews a ready public, pricing, partnership or spending decision.</span></footer></article>`;
  } else {
    const b = data.budget;
    body = `<div class="growth-intro"><h2>Are we making progress?</h2><p>We track paying customers and whether people finish videos and return.</p></div>` + growthScorecard();
    body += `<div class="growth-grid">${growthPanel("Budget",`<div class="growth-budget"><strong>${money(b.remaining)}</strong><span>left from the ${money(b.total)} total budget</span></div><p>${money(b.spent)} spent · ${money(b.committed)} committed</p><p>Spending still needs your approval.</p><p><button class="text-btn" data-growth-tab="work">See Recurring and One Time tasks →</button></p>${growthMore("Planned budget and rules",`${b.allocations.filter(a=>a.amount>0).map(a=>`<div class="allocation"><span>${esc(a.label)}</span><strong>${money(a.amount)}</strong></div>`).join("")}<p>These amounts are plans, not permission to spend.</p>${docButton("09_BUDGET/BUDGET.md","Budget record")}`)}`)}${growthPanel("What’s working?", `<p>${g.experiments.length ? `${g.experiments.length} growth tests recorded.` : "No growth tests have started yet."}</p><p>AI will use results to decide what to keep, improve or stop.</p>${growthMore("Tests and campaign records", `${docButton("08_EXPERIMENTS/EXPERIMENT_BACKLOG.md","Planned tests")}${docButton("08_EXPERIMENTS/EXPERIMENT_LOG.md","Test results")}${docButton("07_CONTENT/CONTENT_RESULTS.csv","Content results")}${docButton("06_OUTREACH/OUTREACH_LOG.csv","Creator conversations")}`)}`)}</div>`;
    body += growthMore("Where the numbers come from", `<p>A click on Install is different from an actual install. Tests and free access do not count as paying customers.</p><div class="growth-funnel">${[["Store visitors","Store visitors"],["Install clicks","Store install clicks"],["Completed acquisitions","Completed acquisitions"],["First video finished","Activated users"],["Created again","Repeat export within 7 days"],["Paying subscribers","Total active subscribers"]].map(([title,key])=>{const m=metric(key);return `<article><small>${esc(title)}</small><strong>${display(m.value)}</strong><span>${m.value==='UNKNOWN' ? 'Not measured yet' : esc(m.asOf)}</span></article>`}).join("")}</div><p>AI checks repeat use after a full week and paid conversion after two weeks. Unfinished observation periods stay pending.</p>${docButton("03_ANALYTICS/METRICS.md","Full measurement record")}`);
    body += growthMore("Automatic runs and connected tools", `<p>${esc(automation)}</p><p>Last run: ${esc(g.scheduler.lastRun || "None recorded")} · Next run: ${esc(g.scheduler.nextRun || "Not scheduled")}</p><div class="growth-connections">${g.integrations.map(i=>`<article><h3>${esc(i.name)}</h3><p>${esc(i.status)}</p>${growthMore("Technical details",`<p>${esc(i.route)}</p>${docButton(i.source,"Source record")}`)}</article>`).join("")}</div>`);
    body += growthMore("Recent AI activity", receipts);
  }
  $("#main").innerHTML = head("Growth", "AI does the work. You see the progress and key decisions.",'<span class="tag neutral">Growth only</span>') + growthNavigation() + `<div class="growth-workspace growth-simple">${body}</div>`;
  const search = $("#growth-task-search");
  if (search) search.addEventListener("input", () => {
    const q=search.value.trim().toLowerCase();
    let visible=0;
    document.querySelectorAll("[data-growth-searchable]").forEach(item=>{item.hidden=!item.dataset.growthSearchable.includes(q);if(!item.hidden)visible++;});
    $("#growth-search-empty").hidden=visible>0;
  });
  $("#main").querySelectorAll("[data-roadmap-target]").forEach(button => button.addEventListener("click", () => {
    growth.roadmapTarget = Number(button.dataset.roadmapTarget);
    growth();
  }));
}

function baselineCard(record, titleKey) {
  const title =
      record[titleKey] ||
      Object.values(record).find(Boolean) ||
      "Baseline record",
    fields = Object.entries(record).filter(
      ([key, value]) =>
        key !== titleKey &&
        value !== null &&
        value !== "" &&
        !String(value).startsWith("="),
    );
  return `<article class="baseline-card"><h3>${esc(title)}</h3><dl>${fields.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${/^https?:\/\//.test(String(value)) ? `<a href="${esc(value)}" target="_blank" rel="noopener">Open source ↗</a>` : esc(value)}</dd></div>`).join("")}</dl></article>`;
}
function records() {
  let section = "updates";
  $("#main").innerHTML =
    head(
      "Project records.",
      "Updates, working documents and the complete migrated workbook baseline.",
    ) +
    `<div class="tabs" role="group" aria-label="Project record type"><button class="selected" data-record-section="updates" aria-pressed="true">Updates</button><button data-record-section="documents" aria-pressed="false">Documents</button><button data-record-section="baseline" aria-pressed="false">Baseline</button></div><div id="record-content"></div>`;
  const render = () => {
    document.querySelectorAll("[data-record-section]").forEach((b) => {
      const selected = b.dataset.recordSection === section;
      b.classList.toggle("selected", selected);
      b.setAttribute("aria-pressed", String(selected));
    });
    const content = $("#record-content");
    if (section === "updates") {
      content.innerHTML = `<div class="toolbar"><input id="record-search" type="search" placeholder="Search updates…" aria-label="Search project updates"></div><section class="panel"><div class="panel-body" id="record-results"></div></section>`;
      const draw = () => {
        const q = $("#record-search").value.toLowerCase(),
          items = data.updates.filter((u) =>
            `${u.title} ${u.body}`.toLowerCase().includes(q),
          );
        $("#record-results").innerHTML =
          items
            .map(
              (u) =>
                `<article class="timeline-entry"><time>${esc(u.date || "Date not recorded")}</time><h3>${esc(u.title.replace(/^\d{4}-\d{2}-\d{2}\s*[—–-]?\s*/, "")) || "Project update"}</h3><p>${esc(u.body.replace(/[*`#]/g, "").slice(0, 230))}${u.body.length > 230 ? "…" : ""}</p><button class="text-btn section-gap" data-update="${data.updates.indexOf(u)}">Read full update ↗</button></article>`,
            )
            .join("") || '<p class="empty">No matching updates.</p>';
      };
      $("#record-search").addEventListener("input", draw);
      draw();
    } else if (section === "documents") {
      content.innerHTML = `<div class="toolbar"><input id="record-search" type="search" placeholder="Search every project document…" aria-label="Search project documents"><select id="record-area" aria-label="Filter document area"><option value="ALL">All areas</option>${[...new Set(data.docs.map((d) => d.area))].map((a) => `<option>${esc(a)}</option>`).join("")}</select></div><div id="record-count" class="status-count"></div><div id="record-results" class="doc-grid"></div>`;
      const draw = () => {
        const q = $("#record-search").value.toLowerCase(),
          a = $("#record-area").value,
          docs = data.docs.filter(
            (d) =>
              (a === "ALL" || d.area === a) &&
              `${d.title} ${d.body}`.toLowerCase().includes(q),
          );
        $("#record-count").textContent = `${docs.length} project documents`;
        $("#record-results").innerHTML =
          docs
            .map(
              (d) =>
                `<button class="doc-card" data-doc="${esc(d.path)}"><small>${esc(d.area)}</small><h3>${esc(d.title)}</h3><p>Open project record ↗</p></button>`,
            )
            .join("") || '<p class="empty">No matching documents.</p>';
      };
      $("#record-search").addEventListener("input", draw);
      $("#record-area").addEventListener("change", draw);
      draw();
    } else {
      const groups = [
        ["brand", "Brand standards", data.baseline.brandStandards, "Area"],
        ["assets", "Proof assets", data.baseline.proofAssets, "Asset / Hook"],
        ["research", "Research sources", data.baseline.research, "Source"],
        ["guide", "Operating guide", data.baseline.systemGuide, "Topic"],
        [
          "budget",
          "Budget baseline",
          data.baseline.budgetRows,
          "Budget Setting",
        ],
      ];
      content.innerHTML = `<section class="baseline-intro"><div><div class="eyebrow">MIGRATED WORKBOOK</div><h2>Pre-launch baseline</h2><p>All 12 workbook sheets, formulas and validation lists are preserved here. Live task and gate decisions remain in Work plan.</p></div><span>${esc(data.baseline.sourceSha256.slice(0, 12))}…</span></section><div class="toolbar"><select id="baseline-group" aria-label="Choose baseline area">${groups.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}<option value="templates">Feedback templates</option><option value="archive">Full workbook archive</option></select><input id="baseline-search" type="search" placeholder="Search baseline…" aria-label="Search baseline"></div><div id="baseline-results"></div>`;
      const draw = () => {
        const group = $("#baseline-group").value,
          q = $("#baseline-search").value.toLowerCase(),
          target = $("#baseline-results");
        if (group === "templates") {
          const templates = [
            ["Feedback users", data.baseline.feedbackUsers],
            ["Feedback and issues", data.baseline.feedbackIssues],
          ];
          target.innerHTML = `<div class="baseline-grid">${templates.map(([name, item]) => `<article class="baseline-card"><h3>${name}</h3><p>${item.records.length} preserved template rows</p><dl>${item.headers.map((header) => `<div><dt>Field</dt><dd>${esc(header)}</dd></div>`).join("")}</dl></article>`).join("")}</div>`;
          return;
        }
        if (group === "archive") {
          const sheets = data.baseline.rawSheets;
          target.innerHTML = `<div class="toolbar"><select id="baseline-sheet" aria-label="Choose original workbook sheet">${sheets.map((sheet) => `<option>${esc(sheet.name)}</option>`).join("")}</select></div><div id="baseline-sheet-table"></div>`;
          const drawSheet = () => {
            const sheet = sheets.find(
                (item) => item.name === $("#baseline-sheet").value,
              ),
              rows = sheet.rows.filter((row) =>
                row.some((value) => value !== null && value !== ""),
              ),
              width = Math.max(
                ...rows.map((row) =>
                  row.reduce(
                    (last, value, index) =>
                      value !== null && value !== "" ? index + 1 : last,
                    0,
                  ),
                ),
              ),
              visible = rows.map((row) => row.slice(0, width));
            $("#baseline-sheet-table").innerHTML =
              `<div class="status-count">${esc(sheet.name)} · ${esc(sheet.range)} · ${sheet.validations.length} validation rules</div><div class="panel table-wrap baseline-archive"><table><tbody>${visible.map((row) => `<tr>${row.map((value) => `<td>${esc(value ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
          };
          $("#baseline-sheet").addEventListener("change", drawSheet);
          drawSheet();
          return;
        }
        const selected = groups.find((item) => item[0] === group),
          records = selected[2].filter((record) =>
            JSON.stringify(record).toLowerCase().includes(q),
          );
        target.innerHTML = `<div class="status-count">${records.length} records</div><div class="baseline-grid">${records.map((record) => baselineCard(record, selected[3])).join("") || '<p class="empty">No matching baseline records.</p>'}</div>`;
      };
      $("#baseline-group").addEventListener("change", draw);
      $("#baseline-search").addEventListener("input", draw);
      draw();
    }
  };
  document.querySelectorAll("[data-record-section]").forEach((b) =>
    b.addEventListener("click", () => {
      section = b.dataset.recordSection;
      render();
    }),
  );
  render();
}
const sharedDashboardApi =
  "https://reaction-creator-default-rtdb.firebaseio.com/dashboard.json";
const validLifecycles = ["PRE_LAUNCH", "GROWTH"];
const normalizeLifecycle = (value) =>
  validLifecycles.includes(value) ? value : "PRE_LAUNCH";
async function patchSharedDashboard(values) {
  const response = await fetch(sharedDashboardApi, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...values, updatedAt: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Save failed (${response.status})`);
}
async function loadSharedDashboardState() {
  try {
    const response = await fetch(`${sharedDashboardApi}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error();
    const shared = await response.json();
    if (shared && typeof shared.overviewNote === "string")
      adminState.overviewNote = shared.overviewNote;
    if (typeof shared?.lifecycle === "string") {
      const lifecycle = normalizeLifecycle(shared.lifecycle);
      adminState.project.stage = lifecycle;
      if (shared.lifecycle !== lifecycle)
        await patchSharedDashboard({ lifecycle });
    }
    for (const [id, item] of Object.entries(shared?.tasks || {})) {
      if (
        data.tasks.some((t) => t.id === id) &&
        ["COMPLETE", "IN PROGRESS", "NOT STARTED", "BLOCKED"].includes(
          item?.status,
        )
      ) {
        adminState.taskOverrides[id] = item.status;
        const taskText = unpackTaskText(item.note);
        adminState.taskNotes[id] = taskText.note;
        adminState.taskBlockers[id] = taskText.blockedReason;
      }
    }
    for (const [id, item] of Object.entries(shared?.gates || {})) {
      if (
        data.gates.some((g) => g.id === id) &&
        ["WAIT", "PASS", "FAIL"].includes(item?.status)
      ) {
        adminState.gateOverrides[id] = item.status;
        adminState.gateNotes[id] =
          typeof item.note === "string" ? item.note : "";
      }
    }
    noteSyncStatus = "Shared across devices";
    await saveAdminState();
  } catch {
    noteSyncStatus = "Shared dashboard state temporarily unavailable";
  }
}
async function saveSharedOverviewNote(value) {
  await patchSharedDashboard({ overviewNote: value });
  adminState.overviewNote = value;
  noteSyncStatus = "Saved for everyone";
  await saveAdminState();
}
async function saveSharedLifecycle(value) {
  if (!validLifecycles.includes(value)) throw new Error("Invalid lifecycle");
  await patchSharedDashboard({ lifecycle: value });
  adminState.project.stage = value;
  await saveAdminState();
}
async function saveSharedTask(id, status, note, blocker) {
  if (
    !data.tasks.some((t) => t.id === id) ||
    !["COMPLETE", "IN PROGRESS", "NOT STARTED", "BLOCKED"].includes(status)
  )
    throw new Error("Invalid task update");
  if (status === "COMPLETE" && !note)
    throw new Error(
      "Add completion evidence before marking this task complete.",
    );
  if (status === "BLOCKED" && !blocker)
    throw new Error("Add the blocking reason before saving this task.");
  const packedText = packTaskText(note, blocker);
  if (packedText.length > 1000)
    throw new Error("Why blocked and Note or evidence must total 1000 characters or fewer.");
  await patchSharedDashboard({
    [`tasks/${id}`]: {
      status,
      note: packedText,
      updatedAt: new Date().toISOString(),
    },
  });
  adminState.taskOverrides[id] = status;
  adminState.taskNotes[id] = note;
  adminState.taskBlockers[id] = blocker;
  await saveAdminState();
}
async function saveSharedGate(id, status, note) {
  if (
    !data.gates.some((g) => g.id === id) ||
    !["WAIT", "PASS", "FAIL"].includes(status)
  )
    throw new Error("Invalid readiness update");
  if (["PASS", "FAIL"].includes(status) && !note)
    throw new Error("Add an evidence or decision note first.");
  await patchSharedDashboard({
    [`gates/${id}`]: { status, note, updatedAt: new Date().toISOString() },
  });
  adminState.gateOverrides[id] = status;
  adminState.gateNotes[id] = note;
  await saveAdminState();
}
function navigate() {
  if (!data) return;
  const requested = location.hash.slice(1) || "overview",
    redirects = {
      readiness: "plan",
      admin: "plan",
      updates: "records",
      library: "records",
    };
  view = redirects[requested] || requested;
  if (!titles[view]) view = "overview";
  if (requested !== view) history.replaceState(null, "", `#${view}`);
  $("#crumb").textContent = titles[view];
  document.querySelectorAll("[data-view]").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === view);
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  ({ overview, plan, growth, records })[view]();
  window.scrollTo(0, 0);
}
const bytesFromB64 = (value) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const b64FromBytes = (value) =>
  btoa(String.fromCharCode(...new Uint8Array(value)));
const localKey = "reactioncreator-admin-state-v1";
async function pinKey(pin, salt, iterations = 120000) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function loadAdminState() {
  const base = data.adminState || {};
  adminState = {
    overviewNote: base.overviewNote || "",
    taskOverrides: { ...(base.taskOverrides || {}) },
    taskNotes: { ...(base.taskNotes || {}) },
    taskBlockers: { ...(base.taskBlockers || {}) },
    gateOverrides: { ...(base.gateOverrides || {}) },
    gateNotes: { ...(base.gateNotes || {}) },
    project: { ...(base.project || {}) },
    updates: [...(base.updates || [])],
  };
  const saved = localStorage.getItem(localKey);
  if (!saved) return;
  try {
    const payload = JSON.parse(saved),
      key = await pinKey(
        activePin,
        bytesFromB64(payload.salt),
        payload.iterations,
      ),
      clear = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytesFromB64(payload.iv) },
        key,
        bytesFromB64(payload.ciphertext),
      ),
      local = JSON.parse(new TextDecoder().decode(clear));
    if (typeof local.overviewNote === "string")
      adminState.overviewNote = local.overviewNote;
    if (local.taskOverrides && typeof local.taskOverrides === "object")
      Object.assign(adminState.taskOverrides, local.taskOverrides);
    if (local.taskNotes && typeof local.taskNotes === "object")
      Object.assign(adminState.taskNotes, local.taskNotes);
    if (local.taskBlockers && typeof local.taskBlockers === "object")
      Object.assign(adminState.taskBlockers, local.taskBlockers);
    if (local.gateOverrides && typeof local.gateOverrides === "object")
      Object.assign(adminState.gateOverrides, local.gateOverrides);
    if (local.gateNotes && typeof local.gateNotes === "object")
      Object.assign(adminState.gateNotes, local.gateNotes);
    if (local.project && typeof local.project === "object")
      Object.assign(adminState.project, local.project);
    if (Array.isArray(local.updates) && local.updates.length)
      adminState.updates = local.updates;
  } catch {
    localStorage.removeItem(localKey);
  }
  adminState.project.stage = normalizeLifecycle(adminState.project?.stage);
}
async function saveAdminState() {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    iterations = 120000,
    key = await pinKey(activePin, salt, iterations),
    clear = new TextEncoder().encode(JSON.stringify(adminState)),
    ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      clear,
    );
  localStorage.setItem(
    localKey,
    JSON.stringify({
      iterations,
      salt: b64FromBytes(salt),
      iv: b64FromBytes(iv),
      ciphertext: b64FromBytes(ciphertext),
    }),
  );
}
async function decryptSnapshot(pin) {
  const r = await fetch(`encrypted-data.json?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Snapshot unavailable");
  const payload = await r.json();
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: bytesFromB64(payload.salt),
      iterations: payload.iterations,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromB64(payload.iv) },
    key,
    bytesFromB64(payload.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(clear));
}
function reveal() {
  document.querySelectorAll(".app-shell").forEach((el) => (el.hidden = false));
  $("#lock").hidden = true;
  navigate();
  $("#footer").innerHTML =
    `<span>Project records: ${esc(data.projectDate || "date unknown")} · individual metrics carry their own dates</span><span>Snapshot generated ${esc(new Date(data.generatedAt).toLocaleString())}</span>`;
}
async function unlock(pin) {
  const help = $("#pin-help"),
    button = $("#unlock-form button");
  button.disabled = true;
  help.className = "pin-help";
  help.textContent = "Unlocking…";
  try {
    const next = await decryptSnapshot(pin);
    if (!Array.isArray(next.tasks) || !next.budget)
      throw new Error("Invalid snapshot");
    data = next;
    activePin = pin;
    await loadAdminState();
    await loadSharedDashboardState();
    failedAttempts = 0;
    reveal();
  } catch {
    failedAttempts++;
    help.className = "pin-help error";
    help.textContent = "Incorrect PIN. Try again.";
    $("#pin").value = "";
    $("#pin").focus();
    if (failedAttempts >= 3)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, failedAttempts * 750)),
      );
  } finally {
    button.disabled = false;
  }
}
async function load() {
  const b = $("#refresh");
  b.disabled = true;
  b.textContent = "Refreshing…";
  try {
    const next = await decryptSnapshot(activePin);
    if (!Array.isArray(next.tasks) || !next.budget)
      throw new Error("Invalid snapshot");
    data = next;
    await loadSharedDashboardState();
    navigate();
    $("#footer").innerHTML =
      `<span>Project records: ${esc(data.projectDate || "date unknown")} · individual metrics carry their own dates</span><span>Snapshot generated ${esc(new Date(data.generatedAt).toLocaleString())}</span>`;
  } catch {
    $("#main").innerHTML =
      '<div class="panel empty"><h2>Couldn’t load the project snapshot.</h2><p>Reload the page and unlock it again. No metrics have been substituted.</p></div>';
  } finally {
    b.disabled = false;
    b.textContent = "↻ Refresh snapshot";
  }
}
async function autoSaveTask(row) {
  const id = row.dataset.taskRow,
    previousStatus = taskStatus(data.tasks.find((task) => task.id === id)),
    status = row.querySelector("[data-task-row-status]").value,
    note = row.querySelector("[data-task-row-note]").value.trim(),
    blocker = row.querySelector("[data-task-row-blocker]").value.trim(),
    saveStatus = row.querySelector(".task-save-status");
  saveStatus.textContent = "Saving…";
  try {
    await saveSharedTask(id, status, note, blocker);
    saveStatus.textContent = "Saved";
    if (
      (view === "plan" || (view === "growth" && growthTab === "tasks")) &&
      (previousStatus === "COMPLETE" || status === "COMPLETE") &&
      previousStatus !== status
    )
      plan(growthTab === "tasks" && view === "growth");
  } catch (error) {
    saveStatus.textContent = error.message;
  }
}
async function autoSaveGate(container) {
  const id = container.dataset.gateId,
    status = container.querySelector("[data-gate-status]").value,
    note = container.querySelector("[data-gate-note]").value.trim(),
    saveStatus = container.querySelector(".save-status");
  saveStatus.textContent = "Saving…";
  try {
    await saveSharedGate(id, status, note);
    saveStatus.textContent = "Saved";
  } catch (error) {
    saveStatus.textContent = error.message;
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.hasAttribute("data-project-notepad")) { $("#admin-note")?.focus(); $("#admin-note")?.scrollIntoView({block:"center", behavior:"smooth"}); return; }
  if (b.dataset.prelaunchTab) {
    prelaunchTab = b.dataset.prelaunchTab;
    if (prelaunchTab === "records") planTaskView = "all";
    plan();
    return;
  }
  if (b.dataset.adminTaskNav) {
    const count = data.owners.filter((o) => ["OPEN", "BLOCKED"].includes(o.status)).length;
    if (count > 1) {
      adminActionIndex =
        (adminActionIndex + Number(b.dataset.adminTaskNav) + count) % count;
      overview();
    }
    return;
  }
  if (b.dataset.go) location.hash = b.dataset.go;
  if (b.dataset.planScope) {
    planTaskView = b.dataset.planScope;
    prelaunchTab = "records";
    if (activeLifecycle() === "GROWTH") growthTab = "tasks";
    if (view === "plan") plan();
    else location.hash = "plan";
  }
  if (b.dataset.doc) doc(b.dataset.doc);
  if (b.dataset.taskDetail) {
    const row = b.closest("[data-task-row]"),
      note = row?.querySelector("[data-task-row-note]")?.value.trim() || "",
      blocker = row?.querySelector("[data-task-row-blocker]")?.value.trim() || "";
    taskDetail(b.dataset.taskDetail, note, blocker);
  }
  if (b.id === "clear-note") {
    const status = $("#note-status"),
      field = $("#admin-note"),
      value = "";
    status.textContent = "Clearing…";
    clearTimeout(saveTimers.get("overview-note"));
    saveTimers.delete("overview-note");
    try {
      await saveSharedOverviewNote(value);
      field.value = value;
      status.textContent = value
        ? "Saved for everyone"
        : "Cleared for everyone";
    } catch (error) {
      status.textContent = error.message;
    }
  }
  if (b.dataset.gateGroup) showGates(b.dataset.gateGroup);
  if (b.dataset.phase) {
    const p = data.phases.find((p) => p.id === b.dataset.phase);
    openDetail(
      p.id,
      p.title,
      tag(p.status) +
        `<p>${esc(p.outcome)}</p><div class="record-line"><small>Current evidence</small>${esc(p.note)}</div><div class="record-line"><small>Original target</small>${esc(p.target)}</div>`,
    );
  }
  if (b.dataset.update !== undefined) {
    const u = data.updates[Number(b.dataset.update)];
    openDetail(u.date, u.title, `<pre class="document">${esc(u.body)}</pre>`);
  }
});
document.addEventListener("change", (e) => {
  const statusField = e.target.closest("[data-task-row-status]");
  if (!statusField) return;
  const row = statusField.closest("[data-task-row]"),
    blocker = row?.querySelector(".task-row-blocker");
  if (blocker) blocker.hidden = statusField.value !== "BLOCKED";
  debounceSave(`task:${row.dataset.taskRow}`, () => autoSaveTask(row), 0);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "admin-note") {
    const status = $("#note-status"),
      value = e.target.value.trim();
    status.textContent = "Saving…";
    debounceSave("overview-note", async () => {
      try {
        await saveSharedOverviewNote(value);
        status.textContent = "Saved for everyone";
      } catch (error) {
        status.textContent = error.message;
      }
    });
    return;
  }
  const row = e.target.closest("[data-task-row]");
  if (row && e.target.matches("[data-task-row-note], [data-task-row-blocker]")) {
    row.querySelector(".task-save-status").textContent = "Saving…";
    debounceSave(`task:${row.dataset.taskRow}`, () => autoSaveTask(row));
    return;
  }
  const gate = e.target.closest("[data-gate-id]");
  if (gate && e.target.matches("[data-gate-note]")) {
    gate.querySelector(".save-status").textContent = "Saving…";
    debounceSave(`gate:${gate.dataset.gateId}`, () => autoSaveGate(gate));
  }
});
document.addEventListener("change", (e) => {
  const gate = e.target.closest("[data-gate-id]");
  if (gate && e.target.matches("[data-gate-status]"))
    debounceSave(`gate:${gate.dataset.gateId}`, () => autoSaveGate(gate), 0);
});
document.addEventListener("change", async (e) => {
  const field = e.target.closest("[data-lifecycle-switch]");
  if (!field) return;
  const previous = activeLifecycle(),
    value = field.value;
  field.disabled = true;
  try {
    await saveSharedLifecycle(value);
    navigate();
  } catch (error) {
    field.value = previous;
    field.disabled = false;
    window.alert(`Lifecycle could not be saved: ${error.message}`);
  }
});
$("#unlock-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const pin = $("#pin").value;
  if (/^\d{4}$/.test(pin)) unlock(pin);
});
$("#pin").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
});
$("#refresh").addEventListener("click", load);
$("#close-detail").addEventListener("click", () => $("#detail").close());
$("#detail").addEventListener("click", (e) => {
  if (e.target === $("#detail")) {
    const r = $("#detail").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("#detail").close();
  }
});
window.addEventListener("hashchange", navigate);
$("#pin").focus();

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-growth-tab]");
  if (tab) { growthTab = tab.dataset.growthTab; growth(); return; }
  const milestone = event.target.closest("[data-growth-milestone]");
  if (milestone) {
    const m = data.growthSystem.milestones.find(m => String(m.target) === milestone.dataset.growthMilestone);
    if (m) openDetail("GROWTH MILESTONE", `${m.target} paying subscribers · ${m.focus}`, `<p>${esc(m.actions)}</p><h3>Evidence to expand</h3><p>${esc(m.evidence)}</p><h3>Then</h3><p>${esc(m.next)}</p>`);
  }
  const brief = event.target.closest("[data-growth-brief]");
  if (brief) {
    const text = growthBrief(brief.dataset.growthBrief);
    try { await navigator.clipboard.writeText(text); brief.textContent = "Copied · paste into Codex"; }
    catch { openDetail("GROWTH EXECUTION BRIEF", "Copy this brief into Codex", `<textarea class="growth-copy" rows="12" readonly>${esc(text)}</textarea>`); }
  }
});
