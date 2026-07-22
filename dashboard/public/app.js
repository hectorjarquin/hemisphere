let state = { project: '', kind: '', status: '', search: '', trash: false, archived: false, limit: 20, offset: 0, total: 0 };
let loadVersion = 0;
let allProjects = [];

var baseBadge = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
var kindColors = {
  fact:                baseBadge + ' bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
  decision:            baseBadge + ' bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  bug:                 baseBadge + ' bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  plan:                baseBadge + ' bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  note:                baseBadge + ' bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  progressive_summary: baseBadge + ' bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  insight:             baseBadge + ' bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
};
var kindStatusColors = {
  proposed:     baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  open:         baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress:  baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  pending:      baseBadge + ' bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved:     baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  implemented:  baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  fixed:        baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  completed:    baseBadge + ' bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected:     baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  superseded:   baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  wont_fix:     baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  cant_repro:   baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  cancelled:    baseBadge + ' bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(ts) {
  const sec = Math.floor(Date.now() / 1000 - ts);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

/* ─────────── TOASTS ─────────── */

function toast(msg, type, duration) {
  type = type || 'info';
  duration = duration || 4000;
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  container.appendChild(el);
  const timer = setTimeout(() => removeToast(el), duration);
  el._timer = timer;
}

function removeToast(el) {
  if (el._removing) return;
  el._removing = true;
  clearTimeout(el._timer);
  el.classList.add('removing');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
}

/* ─────────── SKELETON ─────────── */

function showSkeleton() {
  const tbody = document.getElementById('tbody');
  const stats = document.getElementById('stats');
  const pagination = document.getElementById('pagination');
  const skeleton = document.getElementById('loading-skeleton');
  if (skeleton) skeleton.style.display = '';
  if (tbody) tbody.innerHTML = '';
  if (stats) stats.textContent = 'Loading...';
  if (pagination) pagination.innerHTML = '';
}

function hideSkeleton() {
  const skeleton = document.getElementById('loading-skeleton');
  if (skeleton) skeleton.style.display = 'none';
}

function initSkeleton() {
  const tbody = document.getElementById('skeleton-body');
  if (!tbody) return;
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push('<tr class="skeleton-row"><td class="skeleton-cell tiny"></td><td class="skeleton-cell tiny"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell wide"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell tiny"></td><td></td></tr>');
  }
  tbody.innerHTML = rows.join('');
}

/* ─────────── PREVIEW MODAL ─────────── */

var previewHistory = [];
var previewForward = [];
var previewNavVersion = 0;

function renderPreviewNav() {
  document.getElementById('preview-back').disabled = previewHistory.length <= 1;
  document.getElementById('preview-forward').disabled = previewForward.length === 0;
}

function renderPreviewMeta(m) {
  var el = document.getElementById('preview-meta');
  var parts = [];
  if (m.project) {
    parts.push('<span class="text-muted-foreground">' + esc(m.project) + '</span>');
  }
  if (m.kind) {
    var k = (m.kind || '').toLowerCase();
    parts.push('<span class="' + (kindColors[k] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(m.kind === 'progressive_summary' ? 'summary' : m.kind) + '</span>');
  }
  if (m.status) {
    parts.push('<span class="' + (kindStatusColors[(m.status || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(m.status) + '</span>');
  }
  el.innerHTML = parts.join(' <span class="text-muted-foreground">·</span> ');
}

function renderPreviewTitle(id) {
  document.getElementById('preview-title').textContent = 'Memory #' + id;
}

function showPreviewLoading() {
  document.getElementById('preview-body').textContent = '';
  document.getElementById('preview-loading').classList.remove('hidden');
}

function hidePreviewLoading() {
  document.getElementById('preview-loading').classList.add('hidden');
}

function renderPreviewBody(m) {
  document.getElementById('preview-body').textContent = m.content;
}

function renderPreviewRelated(m) {
  var refBy = m.referenced_by || [];
  var ids = m.related_ids || [];
  var rows = lastData ? (lastData.rows || []) : [];

  var refBySelect = document.getElementById('preview-refby-select');
  refBySelect.disabled = refBy.length === 0;
  refBySelect.innerHTML = '<option value="" disabled selected>Referenced by (' + refBy.length + ')</option>' +
    refBy.map(function (r) {
      return '<option value="' + r.id + '">Memory #' + r.id + (r.status ? ' (' + esc(r.status) + ')' : '') + '</option>';
    }).join('');
  refBySelect.value = '';

  var select = document.getElementById('preview-related-select');
  select.disabled = ids.length === 0;
  select.innerHTML = '<option value="" disabled selected>Related (' + ids.length + ')</option>' +
    ids.map(function (rid) {
      var rel = rows.find(function (r) { return r.id === rid; });
      var label = 'Memory #' + rid + (rel && rel.status ? ' (' + esc(rel.status) + ')' : '');
      return '<option value="' + rid + '">' + label + '</option>';
    }).join('');
  select.value = '';
}

function navigateMemory(id, project) {
  var current = { id: id, project: project };
  var idx = previewHistory.findIndex(function (h) { return h.id === current.id && h.project === current.project; });
  if (idx !== -1) {
    var removed = previewHistory.splice(idx + 1);
    previewForward = removed.reverse().concat(previewForward);
  } else {
    if (previewHistory.length >= 10) previewHistory.shift();
    previewHistory.push(current);
    previewForward = [];
  }

  var version = ++previewNavVersion;
  renderPreviewNav();
  renderPreviewTitle(id);
  showPreviewLoading();

  fetch('/api/memories/' + id + '?project=' + encodeURIComponent(project))
    .then(function (r) { if (!r.ok) throw new Error('Not found'); return r.json(); })
    .then(function (m) {
      if (version !== previewNavVersion) return;
      hidePreviewLoading();
      renderPreviewMeta(m);
      renderPreviewTitle(m.id);
      renderPreviewBody(m);
      renderPreviewRelated(m);
      renderPreviewNav();
    })
    .catch(function () {
      if (version !== previewNavVersion) return;
      previewHistory = previewHistory.filter(function (h) { return h.id !== id || h.project !== project; });
      hidePreviewLoading();
      renderPreviewTitle(id);
      renderPreviewBody({ content: 'Error loading memory.' });
      renderPreviewNav();
      toast('Failed to load memory #' + id, 'error');
    });
}

function previewMemory(id, project) {
  previewHistory = [];
  previewForward = [];
  previewNavVersion = 0;
  document.getElementById('preview-dialog').showModal();
  navigateMemory(id, project);
}

/* ─────────── API FETCHERS ─────────── */

function showError(msg) {
  const el = document.getElementById('error');
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
  console.error(msg);
}

function renderProjectDropdown(projects) {
  const dd = document.getElementById('project-dropdown');
  const input = document.getElementById('project');
  if (projects.length === 0) {
    dd.innerHTML = '<div class="project-picker-empty">No projects found</div>';
  } else {
    dd.innerHTML = projects.map(function (p) {
      return '<div class="project-picker-option" role="option" data-value="' + esc(p) + '">' + esc(p) + '</div>';
    }).join('');
  }
  input.setAttribute('aria-expanded', dd.classList.contains('open') ? 'true' : 'false');
}

async function loadProjects() {
  const r = await fetch('/api/projects');
  if (!r.ok) throw new Error('Failed to load projects');
  allProjects = await r.json();
  renderProjectDropdown(allProjects);
  return allProjects;
}

async function loadStats(project) {
  const url = project ? '/api/stats?project=' + encodeURIComponent(project) : '/api/stats';
  const r = await fetch(url);
  if (!r.ok) throw new Error('Failed to load stats');
  const data = await r.json();
  const sel = document.getElementById('kind');
  const current = sel.value;
  sel.innerHTML = '<option value="" disabled>Kind</option><option value="">all</option>' + data.kinds.map(function (k) {
    return '<option value="' + esc(k) + '">' + esc(k) + '</option>';
  }).join('');
  if (data.kinds.includes(current)) sel.value = current;
  else sel.value = '';
  state.kind = sel.value;

  const statusSel = document.getElementById('status-filter');
  const currentStatus = statusSel.value;
  statusSel.innerHTML = '<option value="" disabled>Status</option><option value="">all</option>' + (data.statuses || []).map(function (s) {
    return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
  }).join('');
  if (data.statuses && data.statuses.includes(currentStatus)) statusSel.value = currentStatus;
  else statusSel.value = '';
  state.status = statusSel.value;
}

async function loadMemories() {
  const version = ++loadVersion;
  showSkeleton();

  const params = new URLSearchParams();
  if (state.project) params.set('project', state.project);
  params.set('kind', state.kind);
  params.set('status', state.status);
  params.set('limit', state.limit);
  params.set('offset', state.offset);
  if (state.search) params.set('search', state.search);
  if (state.trash) params.set('trash', '1');
  if (state.archived) params.set('archived', '1');

  const r = await fetch('/api/memories?' + params.toString());
  if (!r.ok) throw new Error('Failed to load memories');
  const data = await r.json();
  if (version !== loadVersion) return;

  lastData = data;
  hideSkeleton();
  document.getElementById('error').style.display = 'none';

  state.total = data.total;
  const isSearch = !!data.search;

  const tbody = document.getElementById('tbody');
  const stats = document.getElementById('stats');
  const pagination = document.getElementById('pagination');

  if (data.rows.length === 0) {
    const msg = isSearch ? 'No results for "' + esc(state.search) + '"' : 'No memories yet';
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty">' + msg + '</div></td></tr>';
    stats.textContent = msg;
    pagination.innerHTML = '';
    return;
  }

  stats.textContent = isSearch
    ? 'Search: "' + esc(state.search) + '"  —  ' + data.total + ' result' + (data.total !== 1 ? 's' : '')
    : 'Showing ' + (data.offset + 1) + '\u2013' + Math.min(data.offset + data.rows.length, data.total) + ' of ' + data.total + ' memories';

  tbody.innerHTML = data.rows.map(function (m) {
    return '<tr class="border-b border-border last:border-b-0 transition-colors hover:bg-muted/50" data-id="' + m.id + '">'
      + '<td class="max-w-[400px] truncate p-2 align-middle text-sm">' + esc(m.content) + (m.score !== undefined ? ' <span class="text-xs ml-1.5" title="score: ' + m.score.toFixed(4) + '">' + m.score.toFixed(2) + '</span>' : '') + '</td>'
      + '<td class="p-2 align-middle"><span class="' + (kindColors[(m.kind || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(m.kind === 'progressive_summary' ? 'summary' : (m.kind || '')) + '</span></td>'
      + '<td class="text-xs p-2 align-middle truncate max-w-[120px]">' + esc(m.project) + '</td>'
      + '<td class="whitespace-nowrap max-w-[180px] overflow-x-auto text-center p-2 align-middle">' + (m.kind === 'progressive_summary' ? '<span class="text-muted-foreground/60 text-xs">&mdash;</span>' :
          (m.related_ids && m.related_ids.length ?
            m.related_ids.map(function (rid) { return '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">' + rid + '</span>'; }).join(' ')
            : '<span class="text-muted-foreground/60 text-xs">&mdash;</span>')) + '</td>'
      + '<td class="p-2 align-middle">' + (m.status ? '<span class="' + (kindStatusColors[(m.status || '').toLowerCase()] || baseBadge + ' bg-muted text-muted-foreground') + '">' + esc(m.status) + '</span>' : '<span class="text-muted-foreground/60 text-xs">&mdash;</span>') + '</td>'
      + '<td class="whitespace-nowrap text-sm text-muted-foreground p-2 align-middle" title="' + new Date((m.updated_at || m.created_at || 0) * 1000).toISOString().slice(0, 19).replace('T', ' ') + '">' + timeAgo(m.updated_at || m.created_at) + '</td>'
      + '<td class="text-xs p-2 align-middle">' + m.id + '</td>'
      + '<td class="p-2"><div class="dropdown-menu">'
      + '<button class="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-accent" aria-haspopup="menu" aria-expanded="false" aria-label="Actions"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg></button>'
      + '<div data-popover aria-hidden="true" class="z-50 rounded-lg bg-popover p-1 shadow-md ring-1 ring-border/10 min-w-40"><div role="menu">'
      + '<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent preview-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Preview</div>'
      + (state.trash
        ? '<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent restore-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Restore</div><div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent archive-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Archive</div>'
        : state.archived
        ? '<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent unarchive-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Unarchive</div><div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent trash-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Trash</div>'
        : '<div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent archive-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Archive</div><div role="menuitem" class="rounded-md px-2.5 py-1.5 text-sm cursor-pointer hover:bg-accent trash-action" data-id="' + m.id + '" data-project="' + esc(m.project) + '">Trash</div>'
      )
      + '</div></div></div></td></tr>';
  }).join('');

  const tp = Math.ceil(data.total / state.limit);
  const cp = Math.floor(state.offset / state.limit) + 1;
  pagination.innerHTML = '<button id="page-prev" class="btn rounded-full cursor-pointer" data-variant="outline" data-size="sm"' + (cp <= 1 ? ' disabled' : '') + ' aria-label="Previous page">&larr; Prev</button>'
    + '<span class="text-[13px]">Page ' + cp + ' of ' + tp + '</span>'
    + '<button id="page-next" class="btn rounded-full cursor-pointer" data-variant="outline" data-size="sm"' + (cp >= tp ? ' disabled' : '') + ' aria-label="Next page">Next &rarr;</button>';

  /* Flip last 3 dropdowns to open above */
  var allMenus = tbody.querySelectorAll('.dropdown-menu');
  var n = allMenus.length;
  if (n > 0) {
    for (var i = 0; i < n; i++) {
      var popover = allMenus[i].querySelector('[data-popover]');
      if (popover) {
        popover.setAttribute('data-align', i >= n - 3 ? 'end' : 'start');
        popover.setAttribute('data-side', 'left');
        popover.style.margin = '0';
      }
    }
  }
  if (window.basecoat && window.basecoat.initAll) {
    setTimeout(function () { window.basecoat.initAll({ force: true }); }, 0);
  }
}

/* ─────────── EVENT WIRING ─────────── */

document.getElementById('project').addEventListener('change', function () {
  state.project = this.value;
  document.getElementById('project-clear').classList.toggle('hidden', !this.value);
  state.offset = 0;
  state.search = '';
  document.getElementById('search').value = '';
  loadStats(state.project).catch(showError);
  loadMemories().catch(showError);
});

/* Custom combobox behavior */
const projectInput = document.getElementById('project');
const projectDropdown = document.getElementById('project-dropdown');

projectInput.addEventListener('focus', function () {
  renderProjectDropdown(allProjects);
  projectDropdown.classList.add('open');
  this.setAttribute('aria-expanded', 'true');
});

projectInput.addEventListener('input', function () {
  const val = this.value.toLowerCase();
  const filtered = allProjects.filter(function (p) { return p.toLowerCase().includes(val); });
  renderProjectDropdown(filtered);
  projectDropdown.classList.add('open');
  this.setAttribute('aria-expanded', 'true');
});

projectDropdown.addEventListener('mousedown', function (e) {
  e.preventDefault();
  const opt = e.target.closest('.project-picker-option');
  if (opt) {
    projectInput.value = opt.dataset.value;
    document.getElementById('project-clear').classList.remove('hidden');
    projectDropdown.classList.remove('open');
    projectInput.setAttribute('aria-expanded', 'false');
    projectInput.dispatchEvent(new Event('change'));
  }
});

projectInput.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && projectInput.value) {
    document.getElementById('project-clear').click();
    return;
  }
  const dd = projectDropdown;
  if (!dd.classList.contains('open')) return;
  const items = dd.querySelectorAll('.project-picker-option');
  if (items.length === 0) return;
  const cur = dd.querySelector('.project-picker-option.highlight');
  let idx = cur ? Array.from(items).indexOf(cur) : -1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cur) cur.classList.remove('highlight');
    idx = (idx + 1) % items.length;
    items[idx].classList.add('highlight');
    items[idx].scrollIntoView({ block: 'nearest' });
    items[idx].setAttribute('aria-selected', 'true');
    if (cur) cur.removeAttribute('aria-selected');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cur) cur.classList.remove('highlight');
    idx = (idx - 1 + items.length) % items.length;
    items[idx].classList.add('highlight');
    items[idx].scrollIntoView({ block: 'nearest' });
    items[idx].setAttribute('aria-selected', 'true');
    if (cur) cur.removeAttribute('aria-selected');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (cur) {
      projectInput.value = cur.dataset.value;
      dd.classList.remove('open');
      projectInput.setAttribute('aria-expanded', 'false');
      projectInput.dispatchEvent(new Event('change'));
    }
  } else if (e.key === 'Escape') {
    dd.classList.remove('open');
    projectInput.setAttribute('aria-expanded', 'false');
  }
});

projectInput.addEventListener('blur', function () {
  setTimeout(function () {
    projectDropdown.classList.remove('open');
    projectInput.setAttribute('aria-expanded', 'false');
  }, 200);
});

document.getElementById('project-clear').addEventListener('click', function () {
  projectInput.value = '';
  this.classList.add('hidden');
  projectInput.dispatchEvent(new Event('change'));
  projectInput.focus();
});

document.getElementById('kind').addEventListener('change', function () {
  state.kind = this.value;
  state.offset = 0;
  loadMemories().catch(showError);
});

document.getElementById('status-filter').addEventListener('change', function () {
  state.status = this.value;
  state.offset = 0;
  loadMemories().catch(showError);
});

document.getElementById('view').addEventListener('change', function () {
  state.trash = this.value === 'recycled';
  state.archived = this.value === 'archived';
  state.offset = 0;
  loadMemories().catch(showError);
});

let searchTimer = null;
document.getElementById('search').addEventListener('input', function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    state.search = this.value.trim();
    state.offset = 0;
    loadMemories().catch(showError);
  }.bind(this), 200);
});

document.getElementById('tbody').addEventListener('click', function (e) {
  const previewItem = e.target.closest('.preview-action');
  if (previewItem) {
    previewMemory(previewItem.dataset.id, previewItem.dataset.project);
    return;
  }

  const archiveItem = e.target.closest('.archive-action');
  if (archiveItem) {
    e.stopPropagation();
    fetch('/api/memories/' + archiveItem.dataset.id + '/archive?project=' + encodeURIComponent(archiveItem.dataset.project), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('Archive failed'); return r.json(); })
      .then(function (d) {
        if (d.archived) {
          toast('Memory #' + archiveItem.dataset.id + ' archived', 'success');
          loadMemories().catch(showError);
        }
      })
      .catch(function (err) { toast('Archive failed: ' + err.message, 'error'); });
    return;
  }

  const unarchiveItem = e.target.closest('.unarchive-action');
  if (unarchiveItem) {
    e.stopPropagation();

    fetch('/api/memories/' + unarchiveItem.dataset.id + '/unarchive?project=' + encodeURIComponent(unarchiveItem.dataset.project), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('Unarchive failed'); return r.json(); })
      .then(function (d) {
        if (d.unarchived) {
          toast('Memory #' + unarchiveItem.dataset.id + ' restored to active', 'success');
          loadMemories().catch(showError);
        }
      })
      .catch(function (err) { toast('Unarchive failed: ' + err.message, 'error'); });
    return;
  }

  const restoreItem = e.target.closest('.restore-action');
  if (restoreItem) {
    e.stopPropagation();
    fetch('/api/memories/' + restoreItem.dataset.id + '/restore?project=' + encodeURIComponent(restoreItem.dataset.project), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('Restore failed'); return r.json(); })
      .then(function (d) {
        if (d.restored) {
          toast('Memory #' + restoreItem.dataset.id + ' restored', 'success');
          loadMemories().catch(showError);
        }
      })
      .catch(function (err) { toast('Restore failed: ' + err.message, 'error'); });
    return;
  }

  const trashItem = e.target.closest('.trash-action');
  if (trashItem) {
    e.stopPropagation();
    const id = trashItem.dataset.id;
    const project = trashItem.dataset.project;
    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-message').textContent = 'Trash memory #' + id + '?';
    dialog.showModal();
    document.getElementById('confirm-ok').onclick = function () {
      dialog.close();
      fetch('/api/memories/' + id + '?project=' + encodeURIComponent(project), { method: 'DELETE' })
        .then(function (r) { if (!r.ok) throw new Error('Trash failed'); return r.json(); })
        .then(function (d) {
          if (d.deleted) {
            toast('Memory #' + id + ' trashed', 'success');
            loadMemories().catch(showError);
          }
        })
        .catch(function (err) { toast('Trash failed: ' + err.message, 'error'); });
    };
    document.getElementById('confirm-cancel').onclick = function () { dialog.close(); };
    return;
  }

});

document.getElementById('preview-back').addEventListener('click', function () {
  if (previewHistory.length <= 1) return;
  var current = previewHistory.pop();
  previewForward.unshift(current);
  var prev = previewHistory[previewHistory.length - 1];
  navigateMemory(prev.id, prev.project);
});

document.getElementById('preview-forward').addEventListener('click', function () {
  if (previewForward.length === 0) return;
  var next = previewForward.shift();
  previewHistory.push(next);
  navigateMemory(next.id, next.project);
});

document.getElementById('preview-refby-select').addEventListener('change', function () {
  if (!this.value) return;
  var h = previewHistory[previewHistory.length - 1];
  navigateMemory(parseInt(this.value, 10), h ? h.project : state.project);
});

document.getElementById('preview-related-select').addEventListener('change', function () {
  if (!this.value) return;
  var h = previewHistory[previewHistory.length - 1];
  navigateMemory(parseInt(this.value, 10), h ? h.project : state.project);
});

document.getElementById('preview-dialog').addEventListener('close', function () {
  previewHistory = [];
  previewForward = [];
  document.getElementById('preview-title').textContent = '';
  document.getElementById('preview-meta').innerHTML = '';
  document.getElementById('preview-body').textContent = '';
  document.getElementById('preview-loading').classList.add('hidden');
  document.getElementById('preview-refby-select').innerHTML = '<option value="" disabled selected>Referenced by</option>';
  document.getElementById('preview-refby-select').disabled = true;
  document.getElementById('preview-related-select').innerHTML = '<option value="" disabled selected>Related</option>';
  document.getElementById('preview-related-select').disabled = true;
  document.getElementById('preview-back').disabled = true;
  document.getElementById('preview-forward').disabled = true;
});

document.getElementById('pagination').addEventListener('click', function (e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'page-prev' && state.offset > 0) {
    state.offset = Math.max(0, state.offset - state.limit);
    loadMemories().catch(showError);
  } else if (btn.id === 'page-next') {
    state.offset += state.limit;
    loadMemories().catch(showError);
  }
});

document.getElementById('theme-btn').addEventListener('click', function () {
  document.documentElement.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('hemisphere-theme', isDark ? 'dark' : 'light');
  this.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
});

/* Auto-purge + backup every hour */
setInterval(function () {
  Promise.all([
    fetch('/api/purge', { method: 'POST' }).then(function (r) { return r.json(); }),
    fetch('/api/backups', { method: 'POST' }).then(function (r) { return r.json(); })
  ]).then(function (results) {
    const purge = results[0];
    const backup = results[1];
    if (purge.purged > 0) console.log('Purged', purge.purged, 'expired memories');
    if (backup.filename) console.log('Backup:', backup.filename);
  }).catch(function () {});
}, 3600000);

/* ===== SSE: Real-Time Updates (replaces 10s polling) ===== */
const es = new EventSource('/api/events');

es.onerror = function () {};

es.addEventListener('memory_new', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (!state.project || state.project === data.project || !data.project) {
      toast('Memory #' + data.id + ' added', 'success');
      loadMemories().catch(showError);
    }
  } catch (_) {}
});

es.addEventListener('memory_update', function (e) {
  try {
    const data = JSON.parse(e.data);
    const row = document.querySelector('tr[data-id="' + data.id + '"]');
    if (row) {
      loadMemories().catch(showError);
    }
  } catch (_) {}
});

es.addEventListener('memory_trash', function (e) {
  try {
    const data = JSON.parse(e.data);
    removeRow(data.id);
  } catch (_) {}
});

es.addEventListener('memory_restore', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (state.trash) {
      removeRow(data.id);
    } else {
      if (!state.project || state.project === data.project || !data.project) {
        loadMemories().catch(showError);
      }
    }
  } catch (_) {}
});

es.addEventListener('memory_archive', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (!state.archived) {
      removeRow(data.id);
    } else {
      loadMemories().catch(showError);
    }
  } catch (_) {}
});

es.addEventListener('memory_unarchive', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (state.archived) {
      removeRow(data.id);
    } else {
      if (!state.project || state.project === data.project || !data.project) {
        loadMemories().catch(showError);
      }
    }
  } catch (_) {}
});

es.addEventListener('project_new', function () {
  loadProjects().catch(showError);
});

es.addEventListener('memory_purge', function (e) {
  try {
    const data = JSON.parse(e.data);
    removeRow(data.id);
  } catch (_) {}
});

es.addEventListener('memory_reassign', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (!state.project || state.project === data.from || state.project === data.to) {
      loadMemories().catch(showError);
    }
    loadProjects().catch(showError);
  } catch (_) {}
});

es.addEventListener('project_trash', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (!state.project || state.project === data.project) {
      loadMemories().catch(showError);
    }
  } catch (_) {}
});

es.addEventListener('project_purge', function (e) {
  try {
    const data = JSON.parse(e.data);
    if (state.project === data.project) {
      state.project = '';
      document.getElementById('project').value = '';
      loadMemories().catch(showError);
    }
    loadProjects().catch(showError);
  } catch (_) {}
});

/* ===== Granular DOM Helpers ===== */
function removeRow(id) {
  const row = document.querySelector('tr[data-id="' + id + '"]');
  if (row) {
    row.style.transition = 'opacity .2s';
    row.style.opacity = '0';
    setTimeout(function () { row.remove(); }, 250);
  }
}

/* ===== Fallback Polling (30s safety net if SSE disconnects) ===== */
setInterval(function () {
  if (es.readyState === EventSource.CLOSED) {
    loadMemories().catch(function () {});
    loadStats(state.project || '').catch(function () {});
  }
}, 30000);

/* Init */
(function () {
  initSkeleton();
  document.getElementById('confirm-dialog').addEventListener('click', function (e) {
    if (e.target === this) this.close();
  });
  if (document.documentElement.classList.contains('dark')) {
    document.getElementById('theme-btn').setAttribute('aria-label', 'Switch to light theme');
  }
  loadProjects()
    .then(function () { return loadStats(); })
    .then(function () { return loadMemories(); })
    .catch(showError);
})();
