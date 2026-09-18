let data,
  view = "overview",
  activePin = "",
  failedAttempts = 0,
  planTaskView = "all",
  adminState = {
    overviewNote: "",
    taskOverrides: {},
    taskNotes: {},
    taskBlockers: {},
    taskWaitingOnAdmin: {},
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
const tag = (s) =>
  `<span class="tag ${statusClass(s)}">${esc(label(s))}</span>`;
const taskStatus = (t) => adminState.taskOverrides[t.id] || t.status;
const gateStatus = (g) => adminState.gateOverrides[g.id] || g.status;
const activeLifecycle = () => adminState.project?.stage || "PRE_LAUNCH";
const lifecycleTitle = (value) =>
  ({
    PRE_LAUNCH: "Pre-launch",
    LAUNCH_READY: "Launch ready",
    LAUNCHED: "Launched",
    GROWTH: "Growth",
  })[value] || value.replaceAll("_", " ");
const dependencyIds = (t) =>
  t.dependencies === "None"
    ? []
    : t.dependencies
        .split(",")
        .map((id) => `WB:${id.trim().replace(/^WB:/, "")}`);
const taskIsAI = (t) => t.category === "AI_TASK";
const taskNeedsAdmin = (t) => t.category === "ADMIN_HELP";
const taskReady = (t) =>
  taskIsAI(t) &&
  !adminState.taskWaitingOnAdmin?.[t.id] &&
  ["IN PROGRESS", "NOT STARTED"].includes(taskStatus(t)) &&
  dependencyIds(t).every((id) => {
    const dependency = data.tasks.find((x) => x.id === id);
    return dependency && taskStatus(dependency) === "COMPLETE";
  });
const nextLifecycleTasks = (lifecycle) =>
  data.tasks
    .filter((t) => t.lifecycle === lifecycle && taskReady(t))
    .sort(
      (a, b) =>
        (taskStatus(a) === "IN PROGRESS" ? -1 : 1) -
          (taskStatus(b) === "IN PROGRESS" ? -1 : 1) ||
        a.sourceRow - b.sourceRow,
    );
const nextPlannedTask = (lifecycle) =>
  data.tasks
    .filter(
      (t) =>
        t.lifecycle === lifecycle &&
        taskIsAI(t) &&
        !adminState.taskWaitingOnAdmin?.[t.id] &&
        ["IN PROGRESS", "NOT STARTED"].includes(taskStatus(t)),
    )
    .sort((a, b) => a.sourceRow - b.sourceRow)[0];
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
  const dependencyStep =
    t.dependencies === "None"
      ? "Confirm you have the account, device, approval, or access needed for this task."
      : `Confirm these dependencies are complete: ${t.dependencies}.`;
  return instructionSteps(
    `${dependencyStep} ${t.title}. Record the result or evidence in the task note; changes save automatically.`,
  );
}
function taskDetail(id, currentNote = "", currentBlocker = "") {
  const t = data.tasks.find((item) => item.id === id);
  if (!t) return;
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
    `<div class="task-detail-summary">${tag(taskStatus(t))}<span>${taskNeedsAdmin(t) ? "Admin help needed" : "AI task"}</span></div><div class="task-detail-grid">${taskStatus(t) === "BLOCKED" ? item("Why blocked", esc(blocker)) : ""}${taskNeedsAdmin(t) ? item("Admin steps", taskAdminSteps(t)) : ""}${item("Note or evidence", `<div class="task-note-expanded">${formatTaskNote(note)}</div>`)}${item("Useful for / why it matters", esc(w.guidance || "No additional guidance recorded."))}${item("Success criteria", esc(t.success))}${item("Dependencies", esc(t.dependencies))}${item("Parallel / next work", esc([w.parallel && `Parallel: ${w.parallel}`, w.nextTasks && `Next: ${w.nextTasks}`].filter(Boolean).join(" · ") || "Not recorded"))}${item("Work context", esc([w.workstream, w.priority && `${w.priority} priority`, w.support && `Support: ${w.support}`].filter(Boolean).join(" · ") || "Not recorded"))}${item("Original target", esc(t.target || "Not recorded"))}${item("Source", source)}</div>`,
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
    readyTasks = nextLifecycleTasks(lifecycle).slice(0, 1),
    plannedTask = nextPlannedTask(lifecycle);
  const owners = data.owners.filter((o) =>
    ["OPEN", "BLOCKED"].includes(o.status),
  );
  $("#main").innerHTML =
    head(
      "A clear view of what’s next.",
      adminState.project?.headline ||
        "From first feedback to lasting subscriber growth.",
    ) +
    `<div class="overview-top"><section class="panel admin-note"><div class="panel-head"><div><div class="eyebrow">SHARED PROJECT NOTE</div><h2>Overview note</h2></div><span id="note-status" class="save-status">${esc(noteSyncStatus)}</span></div><div class="panel-body"><textarea id="admin-note" rows="5" maxlength="3000" placeholder="Add a note everyone using this dashboard can see…">${esc(adminState.overviewNote)}</textarea><div class="note-actions"><small>Changes save automatically for everyone who unlocks this dashboard.</small><div class="note-buttons"><button id="clear-note" class="text-btn">Clear</button></div></div></div></section><section class="panel summary-card" aria-label="Key project numbers"><div class="panel-head"><div><div class="eyebrow">PROJECT SNAPSHOT</div><h2>Key numbers</h2></div><button class="text-btn" data-go="growth">View details ↗</button></div><div class="summary-grid">${stat("Paying subscribers", `${display(subscribers.value)} <span>/ 5</span>`, esc(subscribers.asOf))}${stat("Useful feedback", `${feedback === null ? "—" : feedback} <span>/ 10</span>`, feedback === null ? "Not yet measured" : "3 / 6 / 10 checkpoints")}${stat("Budget remaining", money(data.budget.remaining), `${money(data.budget.spent)} spent`)}${stat("Launch checks passed", `${passed} <span>/ 10</span>`, "Evidence reviewed")}</div></section></div>` +
    `<div class="work-lanes">` +
    `<section class="panel work-lane ai-lane"><div class="lane-number">01</div><div class="lane-content"><div class="panel-head"><div><div class="eyebrow">NEXT UNBLOCKED TASK · ${esc(lifecycleTitle(lifecycle).toUpperCase())}</div><h2>Tell Codex to implement this next</h2><p>The next ready task is selected from the current lifecycle. Blocked tasks and tasks with incomplete dependencies are excluded.</p></div><span class="tag pass">${lifecycleTasks.filter(taskReady).length} ready</span></div><div class="task-list">${
      readyTasks
        .map((t) => {
          const phase = data.phases.find((p) => p.id === t.phaseId);
          return `<div class="next-item"><span class="step-num">${esc(t.id.replace("WB:", ""))}</span><p><strong>${esc(t.title)}</strong><br><small>${esc(t.phaseId)} · ${esc(phase?.title || "")}</small></p></div>`;
        })
        .join("") ||
      (plannedTask
        ? `<div class="next-item waiting"><span class="step-num">${esc(plannedTask.id.replace("WB:", ""))}</span><p><strong>${esc(plannedTask.title)}</strong><br><small>Next planned task · waiting for ${esc(plannedTask.dependencies)}</small></p></div><p class="empty">No AI task is currently unblocked. Complete the listed dependency under Admin help needed first.</p>`
        : `<p class="empty">No detailed, dependency-ready task is registered for ${esc(lifecycleTitle(lifecycle))}. Review Admin help needed or add the next lifecycle task to the project plan.</p>`)
    }<div class="lane-actions"><button class="text-btn" data-plan-scope="ready">View ready AI tasks ↗</button></div></div></div></section>` +
    `<section class="panel work-lane admin-lane"><div class="lane-number">02</div><div class="lane-content"><div class="panel-head"><div><div class="eyebrow">ADMIN HELP NEEDED</div><h2>Work AI cannot complete alone</h2><p>These items come from the open Owner Actions register. Each card gives step-by-step instructions and what they unlock.</p></div><span class="tag ${owners.some((o) => o.status === "BLOCKED") ? "blocked" : "warn"}">${owners.length} dependencies</span></div><div class="panel-body owner-grid">${owners.map((o) => `<article class="action-card"><div class="meta"><small class="subtle">${esc(o.id)}</small><span class="tag ${o.status === "BLOCKED" ? "blocked" : "warn"}">${o.status === "BLOCKED" ? "Blocked" : "Admin action"}</span></div>${o.status === "BLOCKED" ? `<div class="action-detail blocked-reason"><small>WHY BLOCKED</small><p>${esc(o.why)}</p></div>` : ""}<div class="action-detail"><small>STEP-BY-STEP INSTRUCTIONS</small>${instructionSteps(o.action)}</div><div class="action-detail"><small>WHY THIS NEEDS ADMIN</small><p>${esc(o.why)}</p></div><div class="action-facts"><span><small>UNLOCKS</small>${esc(o.blocks)}</span><span><small>WHEN</small>${esc(o.trigger)}</span></div></article>`).join("") || '<p class="subtle">No admin dependencies are open. AI work can continue independently.</p>'}<div class="lane-actions"><button class="text-btn" data-plan-scope="admin">View tasks needing admin help ↗</button></div></div></div></section>` +
    `</div>`;
}
function plan() {
  const feedback = data.registeredFeedback,
    current = activeLifecycle(),
    scope = data.tasks.filter((t) => t.lifecycle === current),
    phaseIds = new Set(scope.map((t) => t.phaseId)),
    phases = data.phases.filter((p) => phaseIds.has(p.id)),
    gateGroup = current === "LAUNCH_READY" ? "Launch" : "Social proof";
  const feedbackPanel =
    current === "PRE_LAUNCH"
      ? `<section class="panel section-gap"><div class="panel-head"><h2>Feedback journey</h2><small>${feedback === null ? "Unknown" : feedback + " recorded"}</small></div><div class="panel-body"><p class="subtle">Learn, fix and retest between each wave of real creator use.</p><div class="feedback-dots" aria-label="${feedback ?? "Unknown"} of 10 feedback participants">${Array.from({ length: 10 }, (_, i) => `<i class="${feedback !== null && i < feedback ? "done" : ""}"></i>`).join("")}</div><div class="feedback-markers"><span>3 · first learning</span><span>6 · retest</span><span>10 · validate</span></div></div></section>`
      : "";
  $("#main").innerHTML =
    head(
      "Work plan",
      `Only tasks and readiness checks for ${lifecycleTitle(current)} are shown.`,
    ) +
    `<section class="panel"><div class="panel-head"><div><div class="eyebrow">${esc(lifecycleTitle(current).toUpperCase())} PHASES</div><h2>${current === "PRE_LAUNCH" ? "The path to launch readiness" : "Final launch decision"}</h2></div><small>Click a phase for its outcome and evidence</small></div><div class="journey">${phases.map((p) => `<button data-phase="${esc(p.id)}" class="${p.status === "IN PROGRESS" ? "current" : p.status === "BLOCKED" ? "blocked" : ""}" aria-label="Open ${esc(p.title)} details"><div class="track"></div><small>${esc(p.id)}</small><h3>${esc(p.title)}</h3><span class="phase-state">${scope.filter((t) => t.phaseId === p.id).length} tasks · ${esc(label(p.status))}</span></button>`).join("")}</div></section><div class="task-toolbar section-gap"><div><h2>Tasks</h2><p>Green is an AI task. Yellow needs admin help.</p></div><div class="toolbar"><select id="task-scope" aria-label="Choose task group"><option value="all" ${planTaskView === "all" ? "selected" : ""}>All tasks</option><option value="ready" ${planTaskView === "ready" ? "selected" : ""}>AI tasks</option><option value="admin" ${planTaskView === "admin" ? "selected" : ""}>Admin help needed</option></select><input id="task-search" type="search" placeholder="Search tasks…" aria-label="Search tasks"><select id="task-filter" aria-label="Filter tasks by status"><option value="ALL">All statuses</option>${["BLOCKED", "IN PROGRESS", "NOT STARTED", "COMPLETE"].map((s) => `<option value="${s}">${label(s)}</option>`).join("")}</select></div></div><div class="status-count" id="task-count"></div><section class="task-board" id="tasks"></section>${feedbackPanel}<section class="section-gap"><div class="page-head compact-head"><div><div class="eyebrow">${esc(gateGroup.toUpperCase())} READINESS</div><h2>Evidence before the next lifecycle step</h2><p>Open a check to review its meaning, evidence, owner and required action.</p></div></div><div class="callout">${gateGroup === "Launch" ? "Official launch requires every launch check plus the final team decision." : "Creator outreach waits for social proof and recruitment readiness."}</div><div id="gate-count" class="status-count"></div><div id="gates" class="gate-list"></div></section>`;
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
            : true,
      ),
      rows = grouped.filter(
        (t) =>
          (s === "ALL" || taskStatus(t) === s) &&
          `${t.id} ${t.title} ${t.dependencies} ${t.phaseId}`
            .toLowerCase()
            .includes(q),
      );
    $("#task-count").textContent =
      `${rows.length} of ${grouped.length} ${group === "ready" ? "AI" : group === "admin" ? "admin-help" : "lifecycle"} tasks`;
    $("#tasks").innerHTML =
      rows
        .map((t) => {
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
          return `<article class="task-row ${kind}" data-task-row="${esc(t.id)}"><header class="task-card-header"><div class="task-card-identity"><div class="task-card-kicker"><span>${esc(t.id)}</span><span>${esc(phase?.title || t.phaseId)}</span><span class="task-kind">${category}</span></div><h3>${esc(t.title)}</h3></div><div class="task-card-controls"><label class="task-row-status"><span>Status</span><select data-task-row-status="${esc(t.id)}">${["COMPLETE", "IN PROGRESS", "NOT STARTED", "BLOCKED"].map((v) => `<option value="${v}" ${status === v ? "selected" : ""}>${esc(label(v))}</option>`).join("")}</select></label><span class="task-save-status">${note || blocker ? "Saved" : "Auto-save on"}</span></div></header><div class="task-card-body"><section class="task-work"><div class="task-brief"><div><small>SUCCESS LOOKS LIKE</small><p>${esc(t.success)}</p></div><div><small>DEPENDS ON</small><p>${esc(t.dependencies)}</p></div></div><label class="blocked-reason task-row-blocker" ${status === "BLOCKED" ? "" : "hidden"}><span>WHY BLOCKED</span><textarea data-task-row-blocker="${esc(t.id)}" rows="2" maxlength="1000" placeholder="Describe the exact blocking dependency…">${esc(blocker)}</textarea></label>${taskNeedsAdmin(t) ? `<div class="task-admin-instructions"><small>ADMIN STEPS</small>${taskAdminSteps(t)}</div>` : ""}</section><section class="task-row-fields"><label><span>Note or evidence</span><textarea data-task-row-note="${esc(t.id)}" rows="5" maxlength="1000" placeholder="Add a short update or evidence…">${esc(note)}</textarea></label><button class="task-detail-button" data-task-detail="${esc(t.id)}">Open full task details →</button></section></div><details class="task-baseline"><summary>Guidance, context and source</summary><div class="task-baseline-grid"><div><small>WHY IT MATTERS</small><p>${esc(w.guidance || "No additional guidance recorded.")}</p></div><div><small>SUCCESS CRITERIA</small><p>${esc(t.success)}</p></div><div><small>WORK CONTEXT</small><p>${esc([w.workstream, w.priority && `${w.priority} priority`, w.support && `Support: ${w.support}`].filter(Boolean).join(" · ") || "—")}</p></div><div><small>PARALLEL / NEXT WORK</small><p>${esc([w.parallel && `Parallel: ${w.parallel}`, w.nextTasks && `Next: ${w.nextTasks}`].filter(Boolean).join(" · ") || "—")}</p></div><div><small>DEPENDENCIES</small><p>${esc(t.dependencies)}</p></div><div><small>SOURCE</small><p>${source}</p></div></div></details></article>`;
        })
        .join("") ||
      `<div class="panel empty">No matching ${esc(lifecycleTitle(current))} tasks.</div>`;
  };
  $("#task-search").addEventListener("input", render);
  $("#task-filter").addEventListener("change", render);
  $("#task-scope").addEventListener("change", render);
  render();
  showGates(gateGroup);
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
function growth() {
  const b = data.budget;
  const names = [
    "Total active subscribers",
    "MRR",
    "Activated users",
    "Successful exports",
  ];
  $("#main").innerHTML =
    head(
      "Growth that means something.",
      "Subscribers first. Unknown measurements stay unknown.",
    ) +
    `<section class="stats">${names
      .map((name) => {
        const m = metric(name);
        return stat(
          name,
          display(m.value),
          m.value === "UNKNOWN" ? "Not yet verified" : esc(m.asOf),
        );
      })
      .join(
        "",
      )}</section><section class="panel"><div class="panel-head"><h2>Make the $${b.total} count</h2><small>One total project budget</small></div><div class="panel-body budget-layout"><div class="donut" style="--used:${Math.min(100, b.total ? (b.spent / b.total) * 100 : 0)}%"><div class="donut-inner"><strong>${money(b.remaining)}</strong><small>remaining unspent</small></div></div><div class="allocations"><p class="subtle">Planned allocations · each expense needs approval</p>${b.allocations
      .filter((a) => a.amount > 0)
      .map(
        (a) =>
          `<div class="allocation"><span>${esc(a.label)}</span><strong>${money(a.amount)}</strong></div>`,
      )
      .join(
        "",
      )}<p class="subtle section-gap">${money(b.spent)} spent · ${money(b.committed)} committed · ${money(b.proposed)} in expense proposals</p></div></div></section><section class="panel section-gap"><div class="panel-head"><h2>Measurement register</h2><button class="text-btn" data-doc="03_ANALYTICS/METRICS.md">Read evidence ↗</button></div><div class="table-wrap"><table><thead><tr><th>Metric</th><th>Recorded value</th><th>As of / period</th><th>Source</th></tr></thead><tbody>${data.metrics.map((m) => `<tr><td>${esc(m.label)}</td><td>${display(m.value)}</td><td>${m.asOf === "UNKNOWN" ? "Not recorded" : esc(m.asOf)}</td><td>${esc(m.source)}</td></tr>`).join("")}</tbody></table></div></section><p class="subtle section-gap">A single snapshot cannot establish a trend. Time-series charts can follow when dated observations exist.</p>`;
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
const validLifecycles = ["PRE_LAUNCH", "LAUNCH_READY"];
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
    if (validLifecycles.includes(shared?.lifecycle))
      adminState.project.stage = shared.lifecycle;
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
    taskWaitingOnAdmin: { ...(base.taskWaitingOnAdmin || {}) },
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
    status = row.querySelector("[data-task-row-status]").value,
    note = row.querySelector("[data-task-row-note]").value.trim(),
    blocker = row.querySelector("[data-task-row-blocker]").value.trim(),
    saveStatus = row.querySelector(".task-save-status");
  saveStatus.textContent = "Saving…";
  try {
    await saveSharedTask(id, status, note, blocker);
    saveStatus.textContent = "Saved";
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
  if (b.dataset.go) location.hash = b.dataset.go;
  if (b.dataset.planScope) {
    planTaskView = b.dataset.planScope;
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
        `<p>${esc(p.outcome)}</p><div class="record-line"><small>Current evidence</small>${esc(p.note)}</div><div class="record-line"><small>Original target</small>${esc(p.target)}</div><p class="subtle">Task dependencies and gate evidence govern advancement.</p>`,
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
