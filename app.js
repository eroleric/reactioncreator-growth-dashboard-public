import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { GoogleAuthProvider, getAuth, getIdTokenResult, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { collection, collectionGroup, doc as firestoreDoc, getDoc, getDocs, getFirestore, limit, orderBy, query, startAfter, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { getDownloadURL, getStorage, ref as storageRef } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

const supportFirebaseApp = initializeApp({
  projectId: "reaction-creator",
  appId: "1:684463937847:web:9a72580ac5f743994f22b2",
  databaseURL: "https://reaction-creator-default-rtdb.firebaseio.com",
  storageBucket: "reaction-creator.firebasestorage.app",
  apiKey: "AIzaSyBH8HPv3-voIzAAyJZrm6I1sCUM6wQSZeI",
  authDomain: "reaction-creator.firebaseapp.com",
  messagingSenderId: "684463937847",
});
initializeAppCheck(supportFirebaseApp, {
  provider: new ReCaptchaEnterpriseProvider("6LeGEcYtAAAAAO6RI1COe4hz6OOpzyhDvAtBJMiY"),
  isTokenAutoRefreshEnabled: true,
});
const supportAuth = getAuth(supportFirebaseApp);
const supportDb = getFirestore(supportFirebaseApp);
const supportFunctions = getFunctions(supportFirebaseApp, "us-central1");
const supportStorage = getStorage(supportFirebaseApp);
const supportProvider = new GoogleAuthProvider();
supportProvider.setCustomParameters({ prompt: "select_account" });

let supportSession = {
  user: null,
  admin: false,
  authReady: false,
  loading: false,
  loaded: false,
  tickets: [],
  status: "open",
  selected: null,
  messages: [],
  diagnostics: null,
  cursor: null,
  hasMore: false,
  messageOldest: null,
  messageHasMore: false,
  error: "",
};

let data,
  view = "overview",
  activePin = "",
  failedAttempts = 0,
  planTaskView = "all",
  growthTab = "home",
  adminState = {
    overviewNote: "",
    taskOverrides: {},
    taskNotes: {},
    taskBlockers: {},
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
  growth: "Growth & budget",
  records: "Project records",
  support: "Customer support",
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
const taskStatus = t => adminState.taskOverrides[t.id] || t.status;
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
const lifecycleTitle = (value) =>
  ({
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
const head = (title, sub, extra = "") =>
  `<div class="page-head"><div><div class="eyebrow">PROJECT PULSE</div><h1>${title}</h1><p>${sub}</p></div>${extra}</div>`;
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
function taskDetail(id, currentNote = "", currentBlocker = "") {
  const t = data.tasks.find((item) => item.id === id);
  if (!t) return;
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
  const owners = data.owners.filter(o => ["OPEN", "BLOCKED"].includes(o.status) && !/GR:/.test(o.blocks));
  const approvals = (data.growthSystem?.approvals || []).filter(item => item.status === "READY");
  const attentionCount = owners.length + approvals.length;
  const workspace = (lifecycle, name, description, status, destination, tone) => {
    const summary = taskStatusSummary(data.tasks.filter(t => t.lifecycle === lifecycle));
    const next = nextLifecycleTask(lifecycle);
    return `<article class="panel overview-workspace-card ${tone}">
      <div class="overview-workspace-head"><div><span class="overview-symbol" aria-hidden="true">${"↗"}</span><h2>${name}</h2><p>${description}</p></div><span class="tag neutral">${status}</span></div>
      <div class="overview-progress"><div><span>${summary.counts.complete} of ${summary.total} tasks complete</span><strong>${summary.percentages.complete}%</strong></div><div class="overview-progress-track" role="progressbar" aria-label="${name} tasks complete" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${summary.percentages.complete}"><i style="--progress:${summary.percentages.complete}%"></i></div></div>
      ${next ? `<button class="overview-next-task" type="button" data-task-detail="${esc(next.id)}"><span>Next AI task</span><strong>${esc(next.title)}</strong></button>` : '<div class="overview-next-task empty"><strong>No unfinished AI tasks</strong></div>'}
      <div class="overview-workspace-footer"><button class="text-btn" type="button" data-go="${destination}">Open ${name} <span aria-hidden="true">→</span></button></div>
    </article>`;
  };
  const attentionItems = [
    ...owners.map(item => `<article><span>Growth</span><strong>${esc(item.trigger)}</strong></article>`),
    ...approvals.map(item => `<article><span>Growth decision</span><strong>${esc(item.decision)}</strong></article>`),
  ].join("");
  $("#main").innerHTML = `<div class="overview-calm">
    <header class="overview-heading"><div><div class="eyebrow">YOUR PROJECT AT A GLANCE</div><h1>Overview</h1><p>Small steps toward your first 5 paying subscribers.</p></div><span class="overview-season">Growth</span></header>
    <section class="overview-kpis" aria-label="Project at a glance">${stat("Paying subscribers", `${display(subscribers.value)} <span>/ 5</span>`, esc(subscribers.asOf))}${stat("Monthly recurring revenue", display(metric("MRR").value), esc(metric("MRR").asOf))}${stat("Budget left", money(data.budget.remaining), `${money(data.budget.spent)} spent · ${money(data.budget.total)} total`)}</section>
    <section class="overview-workspaces" aria-label="Growth workspace">${workspace("GROWTH", "Growth & budget", "Turn real usage into paying subscribers.", "Current scope", "growth", "growth")}</section>
    <section class="overview-attention ${attentionCount ? "has-actions" : "clear"}" aria-label="Admin attention">
      ${attentionCount ? `<details><summary><span class="overview-attention-icon" aria-hidden="true">!</span><span><strong>${attentionCount} ${attentionCount === 1 ? "item needs" : "items need"} your attention</strong><small>Decisions, access, or hands-on help</small></span><span class="overview-expand">View items <span aria-hidden="true">⌄</span></span></summary><div class="overview-attention-list">${attentionItems}</div><div class="overview-attention-footer">${owners.length ? '<button class="text-btn" type="button" data-go="growth">Open admin tasks →</button>' : ""}${approvals.length ? '<button class="text-btn" type="button" data-go="growth">Open Growth decisions →</button>' : ""}</div></details>` : '<strong>Nothing needs your attention right now.</strong>'}
    </section>
  </div>`;
}

function plan() {
  const current = "GROWTH",
    scope = data.tasks.filter((t) => t.lifecycle === current),
    taskSummary = taskStatusSummary(scope),
    phaseIds = new Set(scope.map((t) => t.phaseId)),
    phases = data.phases.filter((p) => phaseIds.has(p.id));
  const phasePath = `<div class="task-status-phase-path"><div class="task-status-phase-head"><div><div class="eyebrow">GROWTH PATH</div><h3>The Growth operating loop</h3></div></div><div class="phase-path">${phases.map((p) => `<button data-phase="${esc(p.id)}" class="${p.status === "IN PROGRESS" ? "current" : p.status === "BLOCKED" ? "blocked" : ""}" aria-label="Open ${esc(p.title)} details"><div class="track"></div><small>${esc(p.id)}</small><span class="phase-path-title" title="${esc(p.title)}">${esc(p.title)}</span><span class="phase-state">${taskCountLabel(scope.filter((t) => t.phaseId === p.id).length)} · ${esc(label(p.status))}</span></button>`).join("")}</div></div>`;
  const statusLegend = [
    `<div class="task-status-item"><i class="status-dot complete"></i><span><strong>${taskCountLabel(taskSummary.counts.complete)}</strong><small>Completed · ${taskSummary.percentages.complete}%</small></span></div>`,
    `<div class="task-status-item"><i class="status-dot progress"></i><span><strong>${taskCountLabel(taskSummary.counts.inProgress)}</strong><small>In progress · ${taskSummary.percentages.inProgress}%</small></span></div>`,
    `<div class="task-status-item"><i class="status-dot waiting"></i><span><strong>${taskCountLabel(taskSummary.counts.waiting)}</strong><small>Not started · ${taskSummary.percentages.waiting}%</small></span></div>`,
    `<div class="task-status-item"><i class="status-dot blocked"></i><span><strong>${taskCountLabel(taskSummary.counts.blocked)}</strong><small>Blocked · ${taskSummary.percentages.blocked}%</small></span></div>`,
  ].join("");
  const taskStatusPanel = `<section class="panel task-status-panel" data-lifecycle="${esc(current)}" aria-labelledby="task-status-title"><div class="panel-head"><div><div class="eyebrow">TASK STATUS</div><h2 id="task-status-title">How the work is moving</h2></div><small>${esc(lifecycleTitle(current))} · ${taskCountLabel(taskSummary.total)}</small></div><div class="task-status-layout"><div class="task-donut" role="img" aria-label="${taskSummary.percentages.complete}% complete, ${taskSummary.remainingPercent}% left, across ${taskSummary.total} tasks" style="--complete:${taskSummary.percentages.complete}%;--progress:${taskSummary.percentages.inProgress}%;--waiting:${taskSummary.percentages.waiting}%;--blocked:${taskSummary.percentages.blocked}%;"><div class="task-donut-center"><strong>${taskSummary.total ? `${taskSummary.percentages.complete}%` : "—"}</strong><span>complete</span><small>${taskSummary.total ? `${taskSummary.remainingPercent}% left` : "No tasks"}</small></div></div><div class="task-status-copy"><div class="task-status-legend">${statusLegend}</div></div>${phasePath}</div></section>`;
  $("#main").innerHTML =
    head("Growth · detailed task records", "Tasks, evidence and execution context.") + growthNavigation() +
    taskStatusPanel +
    `<div class="task-toolbar section-gap"><div><h2>Tasks</h2><p>Green is an AI task. Yellow needs admin help. Critical marks recurring daily, weekly or monthly work.</p></div><div class="toolbar"><select id="task-scope" aria-label="Choose task group"><option value="all" ${planTaskView === "all" ? "selected" : ""}>All tasks</option><option value="critical" ${planTaskView === "critical" ? "selected" : ""}>Critical recurring</option><option value="ready" ${planTaskView === "ready" ? "selected" : ""}>AI tasks</option><option value="admin" ${planTaskView === "admin" ? "selected" : ""}>Admin help needed</option></select><input id="task-search" type="search" placeholder="Search tasks…" aria-label="Search tasks"><select id="task-filter" aria-label="Filter tasks by status"><option value="ALL">All statuses</option>${["BLOCKED", "IN PROGRESS", "NOT STARTED", "COMPLETE"].map((s) => `<option value="${s}">${label(s)}</option>`).join("")}</select></div></div><div class="status-count" id="task-count"></div><section class="task-board" id="tasks"></section>`;
  const taskHelper = document.querySelector(".task-toolbar p");
  if (current === "GROWTH") {
    const recurringOption = $("#task-scope option[value='critical']");
    if (recurringOption) {
      recurringOption.value = "recurring";
      recurringOption.textContent = "Recurring";
      recurringOption.insertAdjacentHTML("afterend", `<option value="one-time" ${planTaskView === "one-time" ? "selected" : ""}>One Time</option>`);
    }
    if (taskHelper) taskHelper.textContent = "Recurring tasks repeat on a schedule. One Time tasks happen when their individual trigger applies.";
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
            editableStatuses = ["COMPLETE", "IN PROGRESS", "NOT STARTED", "BLOCKED"],
            kind = taskNeedsAdmin(t) ? "admin-help" : "ai-task",
            category = taskNeedsAdmin(t) ? "Admin help needed" : "AI task",
            w = t.workbook || {},
            source = w.sourceUrl
              ? `<a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener">Open source ↗</a>`
              : "—";
          return `<article class="task-row ${kind}${growthTaskCadence(t) ? " critical-task-row" : ""}" data-task-row="${esc(t.id)}"><header class="task-card-header"><div class="task-card-identity"><div class="task-card-kicker"><span>${esc(t.id)}</span><span>${esc(phase?.title || t.phaseId)}</span><span class="task-kind">${category}</span>${criticalBadge(t)}</div><h3>${esc(t.title)}</h3></div><div class="task-card-controls"><label class="task-row-status"><span>Status</span><select data-task-row-status="${esc(t.id)}">${editableStatuses.map((v) => `<option value="${v}" ${status === v ? "selected" : ""}>${esc(label(v))}</option>`).join("")}</select></label><span class="task-save-status">${note || blocker ? "Saved" : "Auto-save on"}</span></div></header><div class="task-card-body"><section class="task-work"><div class="task-brief"><div><small>SUCCESS LOOKS LIKE</small><p>${esc(t.success)}</p></div></div>${status === "BLOCKED" ? `<label class="blocked-reason task-row-blocker"><span>WHY BLOCKED</span><textarea data-task-row-blocker="${esc(t.id)}" rows="2" maxlength="1000" placeholder="Describe why this task is blocked…">${esc(blocker)}</textarea></label>` : ""}${t.execution ? `<div class="growth-task-context"><small>WHEN AI ACTS</small><p>${esc(t.execution.trigger)}</p><small>AI DELIVERABLE</small><p>${esc(t.execution.output)}</p><small>ADMIN STEPS</small>${taskAdminSteps(t)}</div>` : ""}${taskNeedsAdmin(t) ? `<div class="task-admin-instructions"><small>ADMIN STEPS</small>${taskAdminSteps(t)}</div>` : ""}</section><section class="task-row-fields"><label><span>Note or evidence</span><textarea data-task-row-note="${esc(t.id)}" rows="5" maxlength="1000" placeholder="Add a short update or evidence…">${esc(note)}</textarea></label><button class="task-detail-button" data-task-detail="${esc(t.id)}">Open full task details →</button></section></div><details class="task-baseline"><summary>Guidance, context and source</summary><div class="task-baseline-grid"><div><small>WHY IT MATTERS</small><p>${esc(w.guidance || "No additional guidance recorded.")}</p></div><div><small>SUCCESS CRITERIA</small><p>${esc(t.success)}</p></div><div><small>WORK CONTEXT</small><p>${esc([w.workstream, w.priority && `${w.priority} priority`, w.support && `Support: ${w.support}`].filter(Boolean).join(" · ") || "—")}</p></div><div><small>SOURCE</small><p>${source}</p></div></div></details></article>`;
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
}
function sharedProjectNotepad(scope) {
  return `<section class="panel project-notepad" aria-labelledby="project-notepad-title"><div class="panel-head"><div><div class="eyebrow">SHARED NOTE</div><h2 id="project-notepad-title">Project notepad</h2><p>Keep a reminder or decision handy for ${esc(scope)}.</p></div><span id="note-status" class="save-status" role="status" aria-live="polite">${esc(noteSyncStatus)}</span></div><div class="panel-body"><label for="admin-note">Note for everyone with dashboard access</label><textarea id="admin-note" rows="5" maxlength="3000" placeholder="Write a reminder, decision, or question…">${esc(adminState.overviewNote)}</textarea><div class="note-actions"><small>Saved automatically across devices. Put task evidence in the task’s own notes.</small><button id="clear-note" class="text-btn" type="button">Clear note</button></div></div></section>`;
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
const taskTypeSummary = () => "";
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
  return `Work only in the Reaction Creator Growth system. Read 00_ADMIN/PROJECT_INSTRUCTIONS.md, 01_STRATEGY/GROWTH_EXECUTION.md and 01_STRATEGY/GROWTH_OPERATING_SYSTEM.json, plus current Growth task evidence, metrics, budget and lessons. ${taskText} Select useful Growth work within existing authority. Check the task-specific inputs and exact existing authorization before acting. Do not send messages, publish, change product/pricing or commit money without the required explicit authorization. Reuse a completed period receipt and inspect uncertain prior outcomes before retrying. Finish all safe independent work; create a concrete final admin packet only when necessary. Record actual outputs, evidence, lesson and next review date; do not call drafts published or a recurring routine scheduled. Refresh and validate the encrypted dashboard after material updates.`;
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
const growthStrengthAxes = [
  { phaseId: "G-01", short: "Demand", title: "Demand generation" },
  { phaseId: "G-02", short: "Conversion", title: "Store & website conversion" },
  { phaseId: "G-03", short: "Content", title: "Content engine" },
  { phaseId: "G-04", short: "Partners", title: "Creator partnerships & community" },
  { phaseId: "G-05", short: "Activation", title: "Activation & retention" },
  { phaseId: "G-06", short: "Revenue", title: "Revenue & referrals" },
  { phaseId: "G-07", short: "Paid growth", title: "Scalable acquisition & budget" },
  { phaseId: "G-08", short: "Learning", title: "Measurement & learning" },
];
const growthReceiptWeight = (status) => ({ COMPLETE: 1, IN_PROGRESS: .45, BLOCKED: .15, FAILED: .1 })[status] || 0;
function hasGrowthEvidence(task, receipts) {
  const sharedNote = adminState.taskNotes?.[task.id]?.trim(),
    sourceEvidence = String(task.evidence || "").trim(),
    usefulSource = sourceEvidence && !/^(NOT STARTED|UNKNOWN|NO POST-LAUNCH|NO PAID|NO GROWTH)/i.test(sourceEvidence),
    usefulReceipt = receipts.some((receipt) => receipt.evidence?.trim() || receipt.output?.trim());
  return Boolean(sharedNote || usefulSource || usefulReceipt);
}
function growthStrengthScores(tasks) {
  const runs = data.growthSystem?.runs || [];
  return growthStrengthAxes.map((axis) => {
    const phaseTasks = tasks.filter((task) => task.phaseId === axis.phaseId);
    if (!phaseTasks.length) return { ...axis, score: 0, evidence: 0, total: 0 };
    let progress = 0,
      evidence = 0;
    phaseTasks.forEach((task) => {
      const receipts = runs.filter((receipt) => receipt.taskId === task.id),
        savedStatus = taskStatus(task),
        statusWeight = ({ COMPLETE: 1, "IN PROGRESS": .45, BLOCKED: .15 })[savedStatus] || 0,
        receiptWeight = receipts.reduce((best, receipt) => Math.max(best, growthReceiptWeight(receipt.status)), 0);
      progress += Math.max(statusWeight, receiptWeight);
      if (hasGrowthEvidence(task, receipts)) evidence += 1;
    });
    const score = Math.min(5, Number(((progress / phaseTasks.length) * 4 + evidence / phaseTasks.length).toFixed(1)));
    return { ...axis, score, evidence, total: phaseTasks.length };
  });
}
function growthStrengthRadar(tasks) {
  const scores = growthStrengthScores(tasks),
    centerX = 300,
    centerY = 205,
    radius = 142,
    point = (index, value, extra = 0) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / scores.length,
        distance = radius * (value / 5) + extra;
      return [centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance];
    },
    polygon = (value) => scores.map((_, index) => point(index, value).map((number) => number.toFixed(1)).join(",")).join(" "),
    dataPoints = scores.map((item, index) => point(index, item.score).map((number) => number.toFixed(1)).join(",")).join(" "),
    grid = [1, 2, 3, 4, 5].map((level) => `<polygon points="${polygon(level)}"></polygon>`).join(""),
    axes = scores.map((_, index) => { const [x, y] = point(index, 5); return `<line x1="${centerX}" y1="${centerY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"></line>`; }).join(""),
    labels = scores.map((item, index) => { const [x, y] = point(index, 5, 34), anchor = x < centerX - 18 ? "end" : x > centerX + 18 ? "start" : "middle"; return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${esc(item.short)}</text>`; }).join(""),
    dots = scores.map((item, index) => { const [x, y] = point(index, item.score); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${esc(item.title)}: ${item.score} of 5</title></circle>`; }).join(""),
    weakest = [...scores].sort((a, b) => a.score - b.score || a.phaseId.localeCompare(b.phaseId))[0];
  return `<section class="panel growth-strength"><div class="growth-strength-head"><div><div class="eyebrow">GROWTH STRENGTH MAP</div><h2>Where we are strong—and where to improve</h2><p>Scores update from saved Growth task status, task evidence, and recorded Growth run receipts.</p></div><span class="tag neutral">Evidence score · 0–5</span></div><div class="growth-strength-layout"><div class="growth-radar-wrap"><svg class="growth-radar" viewBox="0 0 600 410" role="img" aria-label="Eight-area Growth strength spider chart. ${scores.map((item) => `${item.title}: ${item.score} of 5`).join(". ")}"><g class="growth-radar-grid">${grid}${axes}</g><polygon class="growth-radar-shape" points="${dataPoints}"></polygon><g class="growth-radar-dots">${dots}</g><g class="growth-radar-labels">${labels}</g></svg></div><div class="growth-strength-scores">${scores.map((item) => `<div data-strength-phase="${item.phaseId}"><span>${esc(item.title)}</span><strong>${item.score}<small>/5</small></strong><i><b style="--score:${item.score * 20}%"></b></i><small>${item.evidence} of ${item.total} tasks have recorded evidence</small></div>`).join("")}</div></div><div class="growth-strength-foot"><p><strong>Weakest current area:</strong> ${esc(weakest.title)}. Use its strengthening task in AI Work to improve the evidence and score.</p>${growthMore("How the chart learns", `<p>Each area receives up to four points from recorded task or run progress and one point from evidence coverage. Not started work adds nothing. In-progress work, completed work, saved notes, source evidence, and run receipts update the score automatically. The chart is a prioritization aid, not a forecast or proof of business results.</p>`)}</div></section>`;
}
function growth() {
  const g = data.growthSystem;
  if (!g) { $("#main").innerHTML = head("Growth", "Refresh to load the growth plan."); return; }
  if (growthTab === "tasks") return plan(true);
  if (growthTab === "rhythm") growthTab = "work";
  const simple = g.adminView;
  if (!simple) { $("#main").innerHTML = head("Growth", "Refresh to load the simplified growth plan."); return; }
  const tasks = data.tasks.filter(t => t.lifecycle === "GROWTH");

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
    body = `<section class="growth-goal"><div><small>OUR NEXT GOAL</small><h2>${target ? `${target} paying subscribers` : "Choose the next subscriber goal"}</h2><p>${esc(simple.planSummary)}</p></div><span class="tag neutral">Growth</span></section>`;
    body += `<section class="stats growth-stats growth-summary-stats">${growthMetricCard("Total active subscribers","Paying subscribers")}${growthMetricCard("MRR","Monthly recurring revenue")}<article class="stat"><div class="label">Budget left</div><div class="number">${money(data.budget.remaining)}</div><div class="note">${money(data.budget.spent)} spent of ${money(data.budget.total)}</div></article></section>`;
    body += `<div class="growth-grid">${growthPanel("AI’s next task", nextContent)}${growthPanel(pending.length ? "Your action needed" : "Your actions",adminContent)}</div>`;
    body += sharedProjectNotepad("Growth & budget");
    body += `<div class="growth-simple-footer"><p>${esc(automation)} AI’s daily and weekly routines are ready to use.</p><button class="text-btn" data-growth-tab="work">See what AI will do →</button></div>`;
  } else if (growthTab === "work") {
    body = `<div class="growth-intro"><h2>AI handles the ongoing work</h2><p>Research, prepare, carry out approved work, and record the results.</p><p class="subtle">${esc(automation)}</p></div>${taskTypeSummary(tasks)}<div class="growth-routines">${simple.routines.map(r => growthPanel(esc(r.title), `<p>${esc(r.summary)}</p>${routineTaskList(tasks, r.id)}${growthMore("See the steps",`<ol>${r.steps.map(step=>`<li>${esc(step)}</li>`).join("")}</ol><button class="quiet" data-growth-brief="${esc(r.id)}">Copy ${esc(r.id)} instructions</button><p class="subtle">Paste into Codex to request this routine. Copying does not start it.</p>${growthMore("Detailed run instructions", `<ol>${g.routines.find(full=>full.id===r.id).steps.map(step=>`<li>${esc(step)}</li>`).join("")}</ol>${docButton("01_STRATEGY/GROWTH_EXECUTION.md","Full operating guide")}`)}`)}`)).join("")}</div>`;
    const oneTimeCount = tasks.filter(t => growthTaskType(t) === "ONE_TIME").length;
    body += growthMore(`Browse ${oneTimeCount} One Time AI tasks`, `<p class="subtle">Recurring tasks are listed above in Every day, Every week and Every month.</p><label class="growth-search-label">Find a one-time task<input id="growth-task-search" type="search" placeholder="Try website, partners or ads"></label>${oneTimeTaskList(tasks)}<p id="growth-search-empty" hidden>No matching tasks.</p><button class="text-btn" data-growth-tab="tasks">Edit detailed task records →</button>`);
    body += growthMore("Recent AI activity", receipts);
    if (pending.length) body = growthPanel("Your action needed",adminContent) + body;
  } else if (growthTab === "strategy") {
    body = growthStrengthRadar(tasks);
    body += `<div class="growth-intro"><h2>How we’ll grow</h2><p>${esc(simple.planSummary)} AI adjusts the plan as results come in.</p></div>`;
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

function records() {
  let section = "updates";
  $("#main").innerHTML =
    head(
      "Project records.",
      "Growth updates and working documents.",
    ) +
    `<div class="tabs" role="group" aria-label="Project record type"><button class="selected" data-record-section="updates" aria-pressed="true">Updates</button><button data-record-section="documents" aria-pressed="false">Documents</button></div><div id="record-content"></div>`;
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
    for (const [id, item] of Object.entries(shared?.tasks || {})) {
      const task = data.tasks.find((t) => t.id === id);
      if (
        task &&
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
async function saveSharedTask(id, status, note, blocker) {
  const task = data.tasks.find((t) => t.id === id);
  if (
    !task ||
    !["COMPLETE", "IN PROGRESS", "NOT STARTED", "BLOCKED"].includes(status)
  )
    throw new Error("Invalid task update");
  if (status === "COMPLETE" && !note)
    throw new Error(
      "Add completion evidence before marking this task complete.",
    );
  if (status === "BLOCKED" && !blocker)
    throw new Error("Add the blocking reason before saving this task.");
  const packedText =
    packTaskText(note, blocker);
  if (packedText.length > 1000)
    throw new Error("Note or evidence must be 1000 characters or fewer.");
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
function navigate() {
  if (!data) return;
  const requested = location.hash.slice(1) || "overview",
    redirects = {
      readiness: "growth",
      admin: "growth",
      plan: "growth",
      updates: "records",
      library: "records",
    };
  view = redirects[requested] || requested;
  if (!titles[view]) view = "overview";
  if (view === "growth") growthTab = "home";
  if (requested !== view) history.replaceState(null, "", `#${view}`);
  $("#crumb").textContent = titles[view];
  document.querySelectorAll("[data-view]").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === view);
    if (a.dataset.view === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  ({ overview, growth, records, support })[view]();
  window.scrollTo(0, 0);
}

const supportCategoryLabel = (value) => ({
  export: "Export", recording: "Recording", camera_microphone: "Camera / microphone",
  premium_purchase: "Premium / purchase", feature_request: "Feature request",
  crash_error: "Crash / error", other: "Other",
})[value] || "Other";
const supportDate = (value) => {
  try { return value?.toDate?.().toLocaleString() || "Unknown date"; }
  catch { return "Unknown date"; }
};

function support() {
  if (!supportSession.authReady) {
    $("#main").innerHTML = '<section class="panel empty"><h2>Checking support access…</h2></section>';
    return;
  }
  if (!supportSession.user) {
    $("#main").innerHTML = `<section class="panel support-auth-card"><div class="eyebrow">PRIVATE SUPPORT INBOX</div><h2>Admin sign-in required</h2><p>Sign in with an approved Reaction Creator support account. The dashboard PIN does not grant access to customer data.</p><button data-support-sign-in>Sign in with Google</button>${supportSession.error ? `<p class="support-error">${esc(supportSession.error)}</p>` : ""}</section>`;
    return;
  }
  if (!supportSession.admin) {
    $("#main").innerHTML = `<section class="panel support-auth-card"><div class="eyebrow">PRIVATE SUPPORT INBOX</div><h2>Verify support access</h2><p>${esc(supportSession.user.email || "This account")} is signed in but does not currently have the <code>support_admin</code> claim. The official support account can activate its claim once.</p><button data-support-bootstrap>Activate support access</button><button class="quiet" data-support-sign-out>Sign out</button>${supportSession.error ? `<p class="support-error">${esc(supportSession.error)}</p>` : ""}</section>`;
    return;
  }
  if (supportSession.selected) { renderSupportConversation(); return; }
  const options = [["open", "Open"], ["resolved", "Resolved"], ["all", "All"]]
    .map(([value, label]) => `<option value="${value}" ${supportSession.status === value ? "selected" : ""}>${label}</option>`).join("");
  const tickets = supportSession.tickets.map((ticket) => `
    <button class="support-ticket" data-support-open="${esc(ticket.id)}" data-support-uid="${esc(ticket.uid)}">
      <span><strong>${esc(supportCategoryLabel(ticket.category))}</strong><small>${esc(supportDate(ticket.last_message_at))}</small></span>
      <span><span class="tag ${ticket.status === "open" ? "progress" : "complete"}">${esc(ticket.status)}</span><small>${ticket.message_count || 0} messages</small></span>
      ${ticket.last_message_role === "user" ? '<em>Waiting for support</em>' : '<em>Support replied</em>'}
    </button>`).join("");
  $("#main").innerHTML = `<section class="support-head"><div><div class="eyebrow">PRIVATE SUPPORT INBOX</div><h2>Customer requests</h2><p>Signed in as ${esc(supportSession.user.email || supportSession.user.uid)}</p></div><button class="quiet" data-support-sign-out>Sign out</button></section><section class="panel"><div class="support-toolbar"><label>Status <select id="support-status">${options}</select></label><button class="quiet" data-support-refresh>Refresh</button></div>${supportSession.error ? `<p class="support-error">${esc(supportSession.error)}</p>` : ""}${supportSession.loading && !tickets ? '<p>Loading requests…</p>' : tickets || '<p class="empty">No requests match this status.</p>'}${supportSession.hasMore ? '<div class="support-more"><button class="quiet" data-support-more>Load older requests</button></div>' : ""}</section>`;
  $("#support-status")?.addEventListener("change", (event) => {
    supportSession.status = event.target.value;
    supportSession.cursor = null; supportSession.tickets = []; loadSupportTickets(true);
  });
  if (!supportSession.loaded && !supportSession.loading) loadSupportTickets(true);
}

async function loadSupportTickets(reset = false) {
  if (!supportSession.admin) return;
  supportSession.loading = true;
  supportSession.error = "";
  support();
  try {
    const base = collectionGroup(supportDb, "supportTickets");
    const constraints = [];
    if (supportSession.status !== "all") constraints.push(where("status", "==", supportSession.status));
    constraints.push(orderBy("last_message_at", "desc"));
    if (!reset && supportSession.cursor) constraints.push(startAfter(supportSession.cursor));
    constraints.push(limit(25));
    const inbox = query(base, ...constraints);
    const snapshot = await getDocs(inbox);
    const page = snapshot.docs.map((ticketDoc) => {
      const parts = ticketDoc.ref.path.split("/");
      return { id: ticketDoc.id, uid: parts[1], ...ticketDoc.data() };
    });
    supportSession.tickets = reset ? page : [...supportSession.tickets, ...page].filter(
      (ticket, index, all) => all.findIndex((item) => item.id === ticket.id && item.uid === ticket.uid) === index,
    );
    supportSession.cursor = snapshot.docs.at(-1) || null;
    supportSession.hasMore = snapshot.size === 25;
    supportSession.loaded = true;
  } catch (error) {
    supportSession.error = error.message || "Could not load support requests.";
  } finally {
    supportSession.loading = false;
    if (view === "support") support();
  }
}

async function openSupportTicket(uid, ticketId) {
  supportSession.loading = true;
  supportSession.error = "";
  supportSession.selected = supportSession.tickets.find((item) => item.id === ticketId && item.uid === uid) || {id: ticketId, uid};
  support();
  try {
    const ticketRef = firestoreDoc(supportDb, "users", uid, "supportTickets", ticketId);
    const [ticketSnapshot, messageSnapshot, diagnosticsSnapshot] = await Promise.all([
      getDoc(ticketRef),
      getDocs(query(collection(ticketRef, "messages"), orderBy("sequence", "desc"), limit(30))),
      getDoc(firestoreDoc(ticketRef, "details", "diagnostics")),
    ]);
    if (!ticketSnapshot.exists()) throw new Error("Ticket no longer exists.");
    supportSession.selected = {id: ticketId, uid, ...ticketSnapshot.data()};
    supportSession.messages = messageSnapshot.docs.map((item) => ({id: item.id, ...item.data()})).reverse();
    supportSession.messageOldest = supportSession.messages[0]?.sequence || null;
    supportSession.messageHasMore = messageSnapshot.size === 30;
    supportSession.diagnostics = diagnosticsSnapshot.exists() ? diagnosticsSnapshot.data().values : null;
  } catch (error) {
    supportSession.error = error.message || "Could not load this conversation.";
  } finally {
    supportSession.loading = false;
    if (view === "support") support();
  }
}

function renderSupportConversation() {
  const ticket = supportSession.selected;
  const messages = supportSession.messages.map((message) => `
    <article class="support-message ${message.sender_role === "admin" ? "admin" : "customer"}">
      <header><strong>${message.sender_role === "admin" ? "Support" : "Customer"}</strong><small>${esc(supportDate(message.created_at))}</small></header>
      <p>${esc(message.body)}</p>
      ${message.attachment?.storage_path ? `<button class="text-btn" data-support-attachment="${esc(message.attachment.storage_path)}">Open screenshot</button>` : ""}
    </article>`).join("");
  const diagnostics = supportSession.diagnostics ? Object.entries(supportSession.diagnostics)
    .map(([key, value]) => `<div><dt>${esc(key.replaceAll("_", " "))}</dt><dd>${esc(value)}</dd></div>`).join("") : "";
  $("#main").innerHTML = `<button class="text-btn support-back" data-support-back>← Back to inbox</button><section class="support-head"><div><div class="eyebrow">${esc(ticket.id)}</div><h2>${esc(supportCategoryLabel(ticket.category))}</h2><p>${esc(ticket.uid)} · ${esc(ticket.status || "open")}</p></div><button class="quiet" data-support-status="${ticket.status === "resolved" ? "open" : "resolved"}">${ticket.status === "resolved" ? "Reopen" : "Resolve"}</button></section>${supportSession.error ? `<p class="support-error">${esc(supportSession.error)}</p>` : ""}<section class="support-conversation">${supportSession.messageHasMore ? '<button class="text-btn" data-support-messages-more>Load older messages</button>' : ""}${supportSession.loading ? "<p>Loading conversation…</p>" : messages || "<p>No messages.</p>"}</section>${diagnostics ? `<details class="panel support-diagnostics"><summary>Technical diagnostics</summary><dl>${diagnostics}</dl></details>` : ""}<section class="panel support-reply"><label for="support-reply">Reply</label><textarea id="support-reply" maxlength="4000" rows="5" placeholder="Write a reply…"></textarea><div><small id="support-reply-status"></small><button data-support-reply>Send reply</button></div></section>`;
}

async function loadOlderSupportMessages() {
  const ticket = supportSession.selected;
  if (!ticket || !supportSession.messageOldest) return;
  supportSession.loading = true; support();
  try {
    const ticketRef = firestoreDoc(supportDb, "users", ticket.uid, "supportTickets", ticket.id);
    const snapshot = await getDocs(query(
      collection(ticketRef, "messages"), where("sequence", "<", supportSession.messageOldest),
      orderBy("sequence", "desc"), limit(30),
    ));
    const older = snapshot.docs.map((item) => ({id: item.id, ...item.data()})).reverse();
    supportSession.messages = [...older, ...supportSession.messages].filter(
      (message, index, all) => all.findIndex((item) => item.id === message.id) === index,
    );
    supportSession.messageOldest = supportSession.messages[0]?.sequence || null;
    supportSession.messageHasMore = snapshot.size === 30;
  } catch (error) { supportSession.error = error.message || "Could not load older messages."; }
  finally { supportSession.loading = false; support(); }
}

async function sendSupportReply() {
  const field = $("#support-reply"), status = $("#support-reply-status"), body = field.value.trim();
  if (!body) { status.textContent = "Write a reply first."; return; }
  status.textContent = "Sending…";
  try {
    await httpsCallable(supportFunctions, "replyToSupportTicket")({
      uid: supportSession.selected.uid, ticket_id: supportSession.selected.id,
      request_id: crypto.randomUUID(), body,
    });
    field.value = "";
    await openSupportTicket(supportSession.selected.uid, supportSession.selected.id);
  } catch (error) { status.textContent = error.message || "Reply failed."; }
}

async function changeSupportStatus(status) {
  try {
    await httpsCallable(supportFunctions, "updateSupportTicketStatus")({
      uid: supportSession.selected.uid, ticket_id: supportSession.selected.id, status,
    });
    supportSession.selected.status = status;
    supportSession.loaded = false;
    support();
  } catch (error) { supportSession.error = error.message || "Status update failed."; support(); }
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
    project: { ...(base.project || {}) },
    updates: [...(base.updates || [])],
  };
  const saved = localStorage.getItem(localKey);
  if (!saved) {
    return;
  }
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
  } catch {
    localStorage.removeItem(localKey);
  }
  for (const key of ["taskOverrides", "taskNotes", "taskBlockers"]) {
    adminState[key] = Object.fromEntries(Object.entries(adminState[key]).filter(([id]) => data.tasks.some(t => t.id === id)));
  }
  adminState.project = { ...base.project };
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
    blocker = row.querySelector("[data-task-row-blocker]")?.value.trim() || "",
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
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.hasAttribute("data-support-sign-in")) {
    supportSession.error = "";
    try { await signInWithPopup(supportAuth, supportProvider); }
    catch (error) { supportSession.error = error.message || "Sign-in failed."; support(); }
    return;
  }
  if (b.hasAttribute("data-support-sign-out")) { await signOut(supportAuth); return; }
  if (b.hasAttribute("data-support-bootstrap")) {
    supportSession.error = "";
    try {
      await httpsCallable(supportFunctions, "bootstrapSupportAdmin")({});
      const token = await getIdTokenResult(supportSession.user, true);
      supportSession.admin = token.claims.support_admin === true;
      support();
    } catch (error) { supportSession.error = error.message || "Access activation failed."; support(); }
    return;
  }
  if (b.hasAttribute("data-support-refresh")) { supportSession.loaded = false; supportSession.cursor = null; supportSession.tickets = []; await loadSupportTickets(true); return; }
  if (b.hasAttribute("data-support-more")) { await loadSupportTickets(false); return; }
  if (b.hasAttribute("data-support-messages-more")) { await loadOlderSupportMessages(); return; }
  if (b.dataset.supportOpen) { await openSupportTicket(b.dataset.supportUid, b.dataset.supportOpen); return; }
  if (b.hasAttribute("data-support-back")) {
    supportSession.selected = null; supportSession.messages = []; supportSession.diagnostics = null; support(); return;
  }
  if (b.hasAttribute("data-support-reply")) { await sendSupportReply(); return; }
  if (b.dataset.supportStatus) { await changeSupportStatus(b.dataset.supportStatus); return; }
  if (b.dataset.supportAttachment) {
    try { window.open(await getDownloadURL(storageRef(supportStorage, b.dataset.supportAttachment)), "_blank", "noopener"); }
    catch (error) { supportSession.error = error.message || "Screenshot could not be opened."; support(); }
    return;
  }
  if (b.hasAttribute("data-project-notepad")) { $("#admin-note")?.focus(); $("#admin-note")?.scrollIntoView({block:"center", behavior:"smooth"}); return; }
  if (b.dataset.go) location.hash = b.dataset.go;
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

});
document.addEventListener("change", (e) => {
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

onAuthStateChanged(supportAuth, async (user) => {
  supportSession.user = user;
  supportSession.admin = false;
  supportSession.authReady = true;
  supportSession.loaded = false;
  supportSession.tickets = [];
  supportSession.cursor = null;
  supportSession.selected = null;
  supportSession.error = "";
  if (user) {
    try {
      const token = await getIdTokenResult(user, true);
      supportSession.admin = token.claims.support_admin === true;
    } catch (error) {
      supportSession.error = error.message || "Could not verify admin access.";
    }
  }
  if (data && view === "support") support();
});

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
