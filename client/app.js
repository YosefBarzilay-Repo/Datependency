const state = {
  releases: [],
  template: [],
  currentRelease: null,
  search: '',
  sort: 'number',
  viewMode: 'details',
  showReleased: false,
  changedIds: new Set(),
};

const els = {
  listView: document.querySelector('#listView'),
  settingsView: document.querySelector('#settingsView'),
  detailView: document.querySelector('#detailView'),
  releaseList: document.querySelector('#releaseList'),
  timelineView: document.querySelector('#timelineView'),
  searchInput: document.querySelector('#searchInput'),
  sortSelect: document.querySelector('#sortSelect'),
  showReleasedInput: document.querySelector('#showReleasedInput'),
  detailsViewButton: document.querySelector('#detailsViewButton'),
  timelineViewButton: document.querySelector('#timelineViewButton'),
  collapseViewButton: document.querySelector('#collapseViewButton'),
  newReleaseButton: document.querySelector('#newReleaseButton'),
  releaseDialog: document.querySelector('#releaseDialog'),
  closeDialogButton: document.querySelector('#closeDialogButton'),
  releaseForm: document.querySelector('#releaseForm'),
  releaseNameField: document.querySelector('#releaseNameField'),
  baseDateField: document.querySelector('#baseDateField'),
  releaseNameInput: document.querySelector('#releaseNameInput'),
  statusBadge: document.querySelector('#statusBadge'),
  gaDateText: document.querySelector('#gaDateText'),
  milestoneEditor: document.querySelector('#milestoneEditor'),
  deleteReleaseButton: document.querySelector('#deleteReleaseButton'),
  releaseToggleButton: document.querySelector('#releaseToggleButton'),
  warningPanel: document.querySelector('#warningPanel'),
  addMilestoneButton: document.querySelector('#addMilestoneButton'),
  templateEditor: document.querySelector('#templateEditor'),
  addTemplateMilestoneButton: document.querySelector('#addTemplateMilestoneButton'),
  deleteDialog: document.querySelector('#deleteDialog'),
  deleteForm: document.querySelector('#deleteForm'),
  closeDeleteDialogButton: document.querySelector('#closeDeleteDialogButton'),
  cancelDeleteButton: document.querySelector('#cancelDeleteButton'),
  deleteDialogText: document.querySelector('#deleteDialogText'),
  notificationList: document.querySelector('#notificationList'),
  notificationCount: document.querySelector('#notificationCount'),
  toast: document.querySelector('#toast'),
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate(value) {
  if (!value) return 'No date specified';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value) {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    let message = 'Request failed';
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {}
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function statusClass(status) {
  return String(status || 'On Track').toLowerCase().replaceAll(' ', '-');
}

function versionCompletion(release) {
  const milestones = release.milestones || [];
  if (!milestones.length) return 0;
  return Math.round((milestones.filter((milestone) => milestone.completed).length / milestones.length) * 100);
}

function milestoneVisualStatus(release, milestone) {
  if (release.releasedAt) return 'Released';
  return milestone.status;
}

function notificationSeverity(status) {
  if (status === 'Delayed') return 'critical';
  if (status === 'No Date Specified') return 'warning';
  if (status === 'Due Soon') return 'notice';
  return 'info';
}

function buildNotifications() {
  const notifications = [];
  state.releases.forEach((release) => {
    if (release.releasedAt) return;
    release.milestones.forEach((milestone) => {
      if (milestone.completed) return;
      if (!['Delayed', 'No Date Specified', 'Due Soon'].includes(milestone.status)) return;
      notifications.push({
        id: `${release.id}:${milestone.id}:${milestone.status}`,
        releaseId: release.id,
        releaseName: release.name,
        milestoneName: milestone.name,
        status: milestone.status,
        severity: notificationSeverity(milestone.status),
        message: milestone.reason || milestone.status,
      });
    });
  });
  return notifications;
}

function renderNotifications() {
  const notifications = buildNotifications();
  els.notificationCount.textContent = notifications.length;
  if (!notifications.length) {
    els.notificationList.innerHTML = '<div class="notification-empty">No active alerts.</div>';
    return;
  }

  els.notificationList.innerHTML = notifications.map((item) => `
    <button class="notification-item ${item.severity}" type="button" data-release-id="${item.releaseId}">
      <span class="notification-status">${escapeHtml(item.status)}</span>
      <strong>${escapeHtml(item.releaseName)}</strong>
      <span>${escapeHtml(item.milestoneName)} - ${escapeHtml(item.message)}</span>
    </button>
  `).join('');
}

function renderList() {
  const query = state.search.trim().toLowerCase();
  const releases = state.releases.filter((release) => release.name.toLowerCase().includes(query));
  els.releaseList.classList.toggle('hidden', state.viewMode === 'timeline');
  els.timelineView.classList.toggle('hidden', state.viewMode !== 'timeline');

  if (!releases.length) {
    els.releaseList.innerHTML = `
      <div class="empty-state">
        <h2>${query ? 'No matching versions' : 'No versions yet'}</h2>
      </div>
    `;
    els.timelineView.innerHTML = '';
    return;
  }

  if (state.viewMode === 'timeline') {
    renderTimeline(releases);
    return;
  }

  els.releaseList.innerHTML = releases
    .map((release) => `
      <article class="release-card ${release.releasedAt ? 'released-card' : ''} ${state.viewMode === 'collapsed' ? 'collapsed-card' : ''}" data-release-id="${release.id}">
        <div class="release-card-main">
          <div>
            <h2>${escapeHtml(release.name)}</h2>
            <p>GA ${formatDisplayDate(release.targetGaDate)}</p>
          </div>
          <span class="status-badge ${statusClass(release.status)}">${release.status}</span>
        </div>
        <div class="collapse-progress ${state.viewMode === 'collapsed' ? '' : 'hidden'}">
          <div class="collapse-progress-bar ${statusClass(release.status)}">
            <span style="width: ${versionCompletion(release)}%"></span>
          </div>
          <strong>${versionCompletion(release)}% complete</strong>
        </div>
        <div class="progress-track ${state.viewMode === 'collapsed' ? 'hidden' : ''}">
          ${release.milestones.map((milestone, index) => `
            <div class="progress-step ${statusClass(milestoneVisualStatus(release, milestone))}" style="--step-index: ${index}" title="${escapeHtml(milestone.reason || milestone.status)}">
              <div class="step-dot"></div>
              <div class="step-card">
                <span>${escapeHtml(milestone.name)}</span>
                <strong>${formatDisplayDate(milestone.date)}</strong>
              </div>
            </div>
          `).join('')}
        </div>
      </article>
    `)
    .join('');
}

function monthKey(value) {
  return value.slice(0, 7);
}

function addMonths(date, amount) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function timelineMonths(releases) {
  const dateValues = [];
  releases.forEach((release) => {
    release.milestones.forEach((milestone) => {
      if (milestone.date) dateValues.push(milestone.date);
    });
  });
  if (!dateValues.length) return [];

  const sorted = dateValues.sort();
  const start = new Date(`${sorted[0].slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(`${sorted[sorted.length - 1].slice(0, 7)}-01T00:00:00.000Z`);
  const months = [];
  for (let date = start; date <= end; date = addMonths(date, 1)) {
    months.push(date.toISOString().slice(0, 7));
  }
  return months;
}

function monthLabel(key) {
  return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(`${key}-01T00:00:00`));
}

function quarterLabel(key) {
  const [year, month] = key.split('-').map(Number);
  return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
}

function quarterCells(months) {
  const cells = [];
  let index = 0;
  while (index < months.length) {
    const label = quarterLabel(months[index]);
    let span = 1;
    while (months[index + span] && quarterLabel(months[index + span]) === label) span += 1;
    cells.push({ label, span });
    index += span;
  }
  return cells;
}

function renderTimeline(releases) {
  const months = timelineMonths(releases);
  if (!months.length) {
    els.timelineView.innerHTML = '<div class="empty-state"><h2>No scheduled dates yet</h2></div>';
    return;
  }

  els.timelineView.style.setProperty('--date-count', months.length);
  els.timelineView.innerHTML = `
    <div class="timeline-grid">
      <div class="timeline-corner quarter-corner">Version</div>
      ${quarterCells(months).map((quarter) => `<div class="timeline-quarter" style="grid-column: span ${quarter.span}">${quarter.label}</div>`).join('')}
      <div class="timeline-corner month-corner"></div>
      ${months.map((month) => `<div class="timeline-date">${monthLabel(month)}</div>`).join('')}
      ${releases.map((release) => `
        <div class="timeline-version" data-release-id="${release.id}">
          <strong>${escapeHtml(release.name)}</strong>
          <span class="status-badge small ${statusClass(release.status)}">${release.status}</span>
        </div>
        ${months.map((month) => {
          const datedMilestones = release.milestones.filter((milestone) => milestone.date);
          const firstMonth = datedMilestones[0] ? monthKey(datedMilestones[0].date) : null;
          const ga = release.milestones.find((milestone) => milestone.name.toLowerCase() === 'ga') || datedMilestones[datedMilestones.length - 1];
          const lastMonth = ga?.date ? monthKey(ga.date) : null;
          const inRange = firstMonth && lastMonth && month >= firstMonth && month <= lastMonth;
          const milestones = release.milestones.filter((milestone) => milestone.date && monthKey(milestone.date) === month);
          return `
            <div class="timeline-cell ${milestones.length ? 'has-item' : ''} ${inRange ? 'in-range' : ''}" data-release-id="${release.id}">
              ${milestones.map((milestone) => `
                <span class="timeline-milestone ${statusClass(milestoneVisualStatus(release, milestone))}" title="${escapeHtml(milestone.reason || milestone.status)}">
                  <i></i>
                  <span>${escapeHtml(milestone.name)}</span>
                  <strong>${formatShortDate(milestone.date)}</strong>
                </span>
              `).join('')}
            </div>
          `;
        }).join('')}
      `).join('')}
    </div>
  `;
}

function renderTemplate() {
  els.templateEditor.innerHTML = state.template
    .map((item, index) => `
      <div class="template-row" data-template-id="${item.id}">
        <div class="template-order">${index + 1}</div>
        <input class="template-name" value="${escapeHtml(item.name)}" aria-label="Template milestone name">
        <button class="template-up icon-text" type="button" ${index === 0 ? 'disabled' : ''}>Up</button>
        <button class="template-down icon-text" type="button" ${index === state.template.length - 1 ? 'disabled' : ''}>Down</button>
        <button class="template-delete row-delete" type="button" ${state.template.length <= 1 ? 'disabled' : ''}>Delete</button>
      </div>
    `)
    .join('');
}

function renderWarnings(release) {
  const warnings = release.milestones.filter((milestone) => milestone.warning);
  if (!warnings.length) {
    els.warningPanel.classList.add('hidden');
    els.warningPanel.innerHTML = '';
    return;
  }

  els.warningPanel.classList.remove('hidden');
  els.warningPanel.innerHTML = warnings
    .map((milestone) => `<div><strong>${escapeHtml(milestone.name)}</strong>: ${escapeHtml(milestone.warning)}</div>`)
    .join('');
}

function renderDetail() {
  const release = state.currentRelease;
  if (!release) return;

  const released = Boolean(release.releasedAt);
  els.releaseNameInput.value = release.name;
  els.statusBadge.textContent = release.status;
  els.statusBadge.className = `status-badge ${statusClass(release.status)}`;
  els.gaDateText.textContent = formatDisplayDate(release.targetGaDate);
  els.releaseToggleButton.textContent = released ? 'Unrelease' : 'Mark Released';
  els.addMilestoneButton.disabled = released;
  renderWarnings(release);

  els.milestoneEditor.innerHTML = release.milestones
    .map((milestone) => `
      <div class="milestone-row ${state.changedIds.has(milestone.id) ? 'changed' : ''} ${milestone.warning ? 'has-warning' : ''}" data-milestone-id="${milestone.id}">
        <div class="milestone-index"></div>
        <div class="milestone-body">
          <div class="milestone-title-line">
            <input class="milestone-name" value="${escapeHtml(milestone.name)}" aria-label="Milestone name">
            <span class="status-badge small ${statusClass(released ? 'Released' : milestone.status)}" title="${escapeHtml(released ? 'Released version' : milestone.reason || milestone.status)}">${released ? 'Released' : milestone.status}</span>
          </div>
          <textarea class="milestone-notes" rows="2" placeholder="Notes" aria-label="${escapeHtml(milestone.name)} notes">${escapeHtml(milestone.notes || '')}</textarea>
        </div>
        <div class="milestone-controls">
          <input class="milestone-date" type="date" value="${milestone.date}" ${released || milestone.completed ? 'disabled' : ''} aria-label="${escapeHtml(milestone.name)} date">
          <label class="complete-toggle">
            <input class="milestone-completed" type="checkbox" ${milestone.completed ? 'checked' : ''} ${released ? 'disabled' : ''}>
            <span>Completed</span>
          </label>
          <button class="row-delete" type="button" ${released ? 'disabled' : ''} aria-label="Delete ${escapeHtml(milestone.name)}">Delete</button>
        </div>
      </div>
    `)
    .join('');

  window.setTimeout(() => {
    state.changedIds.clear();
    document.querySelectorAll('.milestone-row.changed').forEach((row) => row.classList.remove('changed'));
  }, 1400);
}

function showListView() {
  state.currentRelease = null;
  els.listView.classList.remove('hidden');
  els.detailView.classList.add('hidden');
  els.settingsView.classList.add('hidden');
  els.searchInput.disabled = false;
  els.sortSelect.disabled = false;
  renderList();
}

function showSettingsView() {
  state.currentRelease = null;
  els.listView.classList.add('hidden');
  els.detailView.classList.add('hidden');
  els.settingsView.classList.remove('hidden');
  els.searchInput.disabled = true;
  els.sortSelect.disabled = true;
  renderTemplate();
}

async function showDetailView(id) {
  const release = await api(`/releases/${id}`);
  state.currentRelease = release;
  els.listView.classList.add('hidden');
  els.detailView.classList.remove('hidden');
  els.settingsView.classList.add('hidden');
  els.searchInput.disabled = true;
  els.sortSelect.disabled = true;
  renderDetail();
}

async function loadListData() {
  const [releases, template] = await Promise.all([
    api(`/releases?sort=${encodeURIComponent(state.sort)}&includeReleased=${state.showReleased ? 'true' : 'false'}`),
    api('/template'),
  ]);
  state.releases = releases;
  state.template = template;
  renderList();
  renderTemplate();
  renderNotifications();
}

function changedMilestones(before, after) {
  const beforeMap = new Map(before.map((milestone) => [milestone.id, milestone.date]));
  return after.filter((milestone) => beforeMap.get(milestone.id) !== milestone.date).map((milestone) => milestone.id);
}

async function patchRelease(payload) {
  const before = state.currentRelease?.milestones || [];
  const updated = await api(`/releases/${state.currentRelease.id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  state.changedIds = new Set(changedMilestones(before, updated.milestones));
  state.currentRelease = updated;
  state.releases = state.releases.map((release) => release.id === updated.id ? updated : release);
  renderDetail();
  renderNotifications();
}

function milestoneFromRow(row) {
  const id = row.dataset.milestoneId;
  return state.currentRelease.milestones.find((milestone) => milestone.id === id);
}

async function saveTemplate(nextTemplate) {
  state.template = await api('/template', {
    method: 'PUT',
    body: JSON.stringify({ template: nextTemplate }),
  });
  renderTemplate();
}

els.releaseList.addEventListener('click', (event) => {
  const card = event.target.closest('.release-card');
  if (!card) return;
  history.pushState({}, '', `/release/${card.dataset.releaseId}`);
  showDetailView(card.dataset.releaseId).catch((error) => showToast(error.message));
});

els.timelineView.addEventListener('click', (event) => {
  const item = event.target.closest('[data-release-id]');
  if (!item) return;
  history.pushState({}, '', `/release/${item.dataset.releaseId}`);
  showDetailView(item.dataset.releaseId).catch((error) => showToast(error.message));
});

els.notificationList.addEventListener('click', (event) => {
  const item = event.target.closest('[data-release-id]');
  if (!item) return;
  history.pushState({}, '', `/release/${item.dataset.releaseId}`);
  showDetailView(item.dataset.releaseId).catch((error) => showToast(error.message));
});

els.searchInput.addEventListener('input', () => {
  state.search = els.searchInput.value;
  renderList();
});

els.sortSelect.addEventListener('change', async () => {
  state.sort = els.sortSelect.value;
  await loadListData();
});

els.showReleasedInput.addEventListener('change', async () => {
  state.showReleased = els.showReleasedInput.checked;
  await loadListData();
});

function setViewMode(mode) {
  state.viewMode = mode;
  els.detailsViewButton.classList.toggle('active', mode === 'details');
  els.timelineViewButton.classList.toggle('active', mode === 'timeline');
  els.collapseViewButton.classList.toggle('active', mode === 'collapsed');
  renderList();
}

els.detailsViewButton.addEventListener('click', () => setViewMode('details'));
els.timelineViewButton.addEventListener('click', () => setViewMode('timeline'));
els.collapseViewButton.addEventListener('click', () => setViewMode('collapsed'));

els.newReleaseButton.addEventListener('click', () => {
  els.releaseNameField.value = '';
  els.baseDateField.value = today();
  els.releaseDialog.showModal();
  els.releaseNameField.focus();
});

els.closeDialogButton.addEventListener('click', () => els.releaseDialog.close());

els.releaseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const release = await api('/releases', {
      method: 'POST',
      body: JSON.stringify({
        name: els.releaseNameField.value,
        gaDate: els.baseDateField.value,
      }),
    });
    els.releaseDialog.close();
    await loadListData();
    history.pushState({}, '', `/release/${release.id}`);
    await showDetailView(release.id);
  } catch (error) {
    showToast(error.message);
  }
});

els.releaseNameInput.addEventListener('change', async () => {
  try {
    await patchRelease({ name: els.releaseNameInput.value });
  } catch (error) {
    showToast(error.message);
    renderDetail();
  }
});

els.releaseToggleButton.addEventListener('click', async () => {
  if (!state.currentRelease) return;
  try {
    await patchRelease({ released: !state.currentRelease.releasedAt });
  } catch (error) {
    showToast(error.message);
  }
});

els.milestoneEditor.addEventListener('change', async (event) => {
  if (event.target.classList.contains('milestone-date')) return;
  const row = event.target.closest('.milestone-row');
  if (!row) return;
  const milestone = milestoneFromRow(row);
  if (!milestone) return;

  const patch = {
    id: milestone.id,
    name: row.querySelector('.milestone-name').value,
    date: row.querySelector('.milestone-date').value,
    notes: row.querySelector('.milestone-notes').value,
    completed: row.querySelector('.milestone-completed').checked,
  };

  try {
    await patchRelease({ milestone: patch });
  } catch (error) {
    showToast(error.message);
    renderDetail();
  }
});

els.milestoneEditor.addEventListener('focusout', async (event) => {
  if (!event.target.matches('.milestone-date, .milestone-name, .milestone-notes')) return;
  const row = event.target.closest('.milestone-row');
  if (!row) return;
  const milestone = milestoneFromRow(row);
  if (!milestone) return;

  const patch = {
    id: milestone.id,
    name: row.querySelector('.milestone-name').value,
    date: row.querySelector('.milestone-date').value,
    notes: row.querySelector('.milestone-notes').value,
    completed: row.querySelector('.milestone-completed').checked,
  };

  if (
    patch.name === milestone.name &&
    patch.date === milestone.date &&
    patch.notes === (milestone.notes || '') &&
    patch.completed === Boolean(milestone.completed)
  ) {
    return;
  }

  try {
    await patchRelease({ milestone: patch });
  } catch (error) {
    showToast(error.message);
    renderDetail();
  }
});

els.milestoneEditor.addEventListener('click', async (event) => {
  const button = event.target.closest('.row-delete');
  if (!button) return;
  const row = event.target.closest('.milestone-row');
  const milestone = milestoneFromRow(row);
  if (!milestone || !state.currentRelease) return;
  if (state.currentRelease.milestones.length <= 1) {
    showToast('A version must have at least one milestone');
    return;
  }

  try {
    const updated = await api(`/releases/${state.currentRelease.id}/milestones/${milestone.id}`, { method: 'DELETE' });
    state.currentRelease = updated;
    renderDetail();
  } catch (error) {
    showToast(error.message);
  }
});

els.addMilestoneButton.addEventListener('click', async () => {
  if (!state.currentRelease) return;
  const last = state.currentRelease.milestones[state.currentRelease.milestones.length - 1];
  try {
    const updated = await api(`/releases/${state.currentRelease.id}/milestones`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'New Milestone',
        date: '',
      }),
    });
    state.currentRelease = updated;
    state.changedIds = new Set([updated.milestones[updated.milestones.length - 1].id]);
    renderDetail();
  } catch (error) {
    showToast(error.message);
  }
});

els.templateEditor.addEventListener('change', async (event) => {
  if (!event.target.classList.contains('template-name')) return;
  const rows = [...els.templateEditor.querySelectorAll('.template-row')];
  const nextTemplate = rows.map((row) => ({
    id: row.dataset.templateId,
    name: row.querySelector('.template-name').value,
  }));
  try {
    await saveTemplate(nextTemplate);
  } catch (error) {
    showToast(error.message);
    renderTemplate();
  }
});

els.templateEditor.addEventListener('click', async (event) => {
  const row = event.target.closest('.template-row');
  if (!row) return;
  const index = state.template.findIndex((item) => item.id === row.dataset.templateId);
  if (index === -1) return;

  let nextTemplate = [...state.template];
  if (event.target.closest('.template-up') && index > 0) {
    [nextTemplate[index - 1], nextTemplate[index]] = [nextTemplate[index], nextTemplate[index - 1]];
  } else if (event.target.closest('.template-down') && index < nextTemplate.length - 1) {
    [nextTemplate[index + 1], nextTemplate[index]] = [nextTemplate[index], nextTemplate[index + 1]];
  } else if (event.target.closest('.template-delete') && nextTemplate.length > 1) {
    nextTemplate = nextTemplate.filter((item) => item.id !== row.dataset.templateId);
  } else {
    return;
  }

  try {
    await saveTemplate(nextTemplate);
  } catch (error) {
    showToast(error.message);
  }
});

els.addTemplateMilestoneButton.addEventListener('click', async () => {
  try {
    await saveTemplate([...state.template, { name: 'New Milestone' }]);
  } catch (error) {
    showToast(error.message);
  }
});

els.deleteReleaseButton.addEventListener('click', async () => {
  if (!state.currentRelease) return;
  els.deleteDialogText.textContent = `Delete version ${state.currentRelease.name}? This cannot be undone.`;
  els.deleteDialog.showModal();
});

els.closeDeleteDialogButton.addEventListener('click', () => els.deleteDialog.close());
els.cancelDeleteButton.addEventListener('click', () => els.deleteDialog.close());

els.deleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.currentRelease) return;
  try {
    await api(`/releases/${state.currentRelease.id}`, { method: 'DELETE' });
    await loadListData();
    els.deleteDialog.close();
    history.pushState({}, '', '/');
    showListView();
  } catch (error) {
    showToast(error.message);
  }
});

window.addEventListener('popstate', () => route());

async function route() {
  const match = location.pathname.match(/^\/release\/([^/]+)$/);
  try {
    if (match) {
      await loadListData();
      await showDetailView(match[1]);
    } else if (location.pathname === '/settings') {
      await loadListData();
      showSettingsView();
    } else {
      await loadListData();
      showListView();
    }
  } catch (error) {
    showToast(error.message);
    history.replaceState({}, '', '/');
    await loadListData();
    showListView();
  }
}

route();
