let state = { project: '', kind: '', search: '', trash: false, archived: false, limit: 20, offset: 0, total: 0 };
let loadVersion = 0;
let expandedId = null;
let allProjects = [];

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

function kindClass(k) {
  k = (k || '').toLowerCase();
  if (k.startsWith('bug')) return 'bug';
  if (k.startsWith('fact')) return 'fact';
  if (k.startsWith('dec')) return 'decision';
  if (k.startsWith('note')) return 'note';
  return 'default';
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
    rows.push('<tr class="skeleton-row"><td class="skeleton-cell tiny"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell wide"></td><td class="skeleton-cell narrow"></td><td class="skeleton-cell tiny"></td><td></td></tr>');
  }
  tbody.innerHTML = rows.join('');
}

/* ─────────── DETAIL TOGGLE ─────────── */

function toggleDetail(id) {
  const detail = document.querySelector('.detail-row[data-parent="' + id + '"]');
  if (!detail) return;
  const open = detail.style.display !== 'none';
  if (open) {
    detail.style.display = 'none';
    detail.querySelector('.detail').classList.remove('open');
    expandedId = null;
  } else {
    if (expandedId) {
      const prev = document.querySelector('.detail-row[data-parent="' + expandedId + '"]');
      if (prev) {
        prev.style.display = 'none';
        prev.querySelector('.detail').classList.remove('open');
      }
    }
    detail.style.display = '';
    detail.querySelector('.detail').classList.add('open');
    expandedId = id;
  }
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
    dd.innerHTML = '<div class="combobox-empty">No projects found</div>';
  } else {
    dd.innerHTML = projects.map(function (p) {
      return '<div class="combobox-option" role="option" data-value="' + esc(p) + '">' + esc(p) + '</div>';
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
  sel.innerHTML = '<option value="">all</option>' + data.kinds.map(function (k) {
    return '<option value="' + esc(k) + '">' + esc(k) + '</option>';
  }).join('');
  if (data.kinds.includes(current)) sel.value = current;
  else sel.value = '';
  state.kind = sel.value;
}

async function loadMemories() {
  const version = ++loadVersion;
  showSkeleton();

  const params = new URLSearchParams();
  if (state.project) params.set('project', state.project);
  params.set('kind', state.kind);
  params.set('limit', state.limit);
  params.set('offset', state.offset);
  if (state.search) params.set('search', state.search);
  if (state.trash) params.set('trash', '1');
  if (state.archived) params.set('archived', '1');

  const r = await fetch('/api/memories?' + params.toString());
  if (!r.ok) throw new Error('Failed to load memories');
  const data = await r.json();
  if (version !== loadVersion) return;

  hideSkeleton();
  document.getElementById('error').style.display = 'none';

  state.total = data.total;
  const isSearch = !!data.search;

  const tbody = document.getElementById('tbody');
  const stats = document.getElementById('stats');
  const pagination = document.getElementById('pagination');

  if (data.rows.length === 0) {
    const msg = isSearch ? 'No results for "' + esc(state.search) + '"' : 'No memories yet';
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty">' + msg + '</div></td></tr>';
    stats.textContent = msg;
    pagination.innerHTML = '';
    return;
  }

  stats.textContent = isSearch
    ? 'Search: "' + esc(state.search) + '"  —  ' + data.total + ' result' + (data.total !== 1 ? 's' : '')
    : 'Showing ' + (data.offset + 1) + '\u2013' + Math.min(data.offset + data.rows.length, data.total) + ' of ' + data.total + ' memories';

  let savedScroll = 0;
  if (expandedId) {
    const el = document.querySelector('.detail-row[data-parent="' + expandedId + '"] .detail');
    if (el) savedScroll = el.scrollTop;
  }

  tbody.innerHTML = data.rows.map(function (m) {
    const kc = kindClass(m.kind);
    return '<tr class="memory-row" data-id="' + m.id + '" tabindex="0" role="button" aria-label="Memory ' + m.id + ': ' + esc(m.content.slice(0, 60)) + '">'
      + '<td class="id-cell">' + m.id + '</td>'
      + '<td class="related-cell">' + (m.kind === 'progressive_summary' ? '<span class="related-none">\u2014</span>' :
          (m.related_ids && m.related_ids.length ?
            m.related_ids.map(function (rid) { return '<span class="related-chip">' + rid + '</span>'; }).join(' ')
            : '<span class="related-none">\u2014</span>')) + '</td>'
      + '<td><span class="kind-badge kind-' + kc + '">' + esc(m.kind || '') + '</span></td>'
      + '<td class="content-cell">' + esc(m.content) + (m.score !== undefined ? ' <span class="score" title="score: ' + m.score.toFixed(4) + '">' + m.score.toFixed(2) + '</span>' : '') + '</td>'
      + '<td class="status-cell">' + (m.status ? '<span class="status-badge status-' + m.status.replace(/[^a-z0-9]/g, '-') + '">' + esc(m.status) + '</span>' : '<span class="related-none">\u2014</span>') + '</td>'
      + '<td class="time-cell" title="' + new Date((m.updated_at || m.created_at || 0) * 1000).toISOString().slice(0, 19).replace('T', ' ') + '">' + timeAgo(m.updated_at || m.created_at) + '</td>'
      + '<td>' + (state.trash ?
        '<button class="restore-btn" data-id="' + m.id + '" data-project="' + esc(m.project) + '" aria-label="Restore memory ' + m.id + '"><svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor" aria-hidden="true"><path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"/></svg></button>'
        : state.archived ?
        '<button class="unarchive-btn" data-id="' + m.id + '" data-project="' + esc(m.project) + '" aria-label="Unarchive memory ' + m.id + '"><svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor" aria-hidden="true"><path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"/></svg></button>'
        : '<button class="archive-btn" data-id="' + m.id + '" data-project="' + esc(m.project) + '" aria-label="Archive memory ' + m.id + '"><svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor" aria-hidden="true"><path d="M200-640v440h560v-440H200ZM160-120q-33 0-56.5-23.5T80-200v-520h-40v-80h200v-40h240v40h200v80h40v80h-40v440q0 33-23.5 56.5T600-120H160Zm0-600v440-440Zm40 280h320v-80H200v80Z"/></svg></button>') + '</td></tr>'
      + '<tr class="detail-row" data-parent="' + m.id + '" style="display:none"><td colspan="7"><div class="detail"><pre>' + esc(m.content) + '\n\nMetadata: ' + esc(JSON.stringify(m.metadata, null, 2)) + '</pre></div></td></tr>';
  }).join('');

  if (expandedId) {
    const detail = tbody.querySelector('.detail-row[data-parent="' + expandedId + '"]');
    if (detail) {
      detail.style.display = '';
      detail.querySelector('.detail').classList.add('open');
      if (savedScroll > 0) {
        const el = detail.querySelector('.detail');
        if (el) el.scrollTop = savedScroll;
      }
    }
  }

  const tp = Math.ceil(data.total / state.limit);
  const cp = Math.floor(state.offset / state.limit) + 1;
  pagination.innerHTML = '<button id="page-prev"' + (cp <= 1 ? ' disabled' : '') + ' aria-label="Previous page">\u2190 Prev</button>'
    + '<span>Page ' + cp + ' of ' + tp + '</span>'
    + '<button id="page-next"' + (cp >= tp ? ' disabled' : '') + ' aria-label="Next page">Next \u2192</button>';
}

/* ─────────── EVENT WIRING ─────────── */

document.getElementById('project').addEventListener('change', function () {
  state.project = this.value;
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
  const opt = e.target.closest('.combobox-option');
  if (opt) {
    projectInput.value = opt.dataset.value;
    projectDropdown.classList.remove('open');
    projectInput.setAttribute('aria-expanded', 'false');
    projectInput.dispatchEvent(new Event('change'));
  }
});

projectInput.addEventListener('keydown', function (e) {
  const dd = projectDropdown;
  if (!dd.classList.contains('open')) return;
  const items = dd.querySelectorAll('.combobox-option');
  if (items.length === 0) return;
  const cur = dd.querySelector('.combobox-option.highlight');
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
  }, 150);
});

document.getElementById('kind').addEventListener('change', function () {
  state.kind = this.value;
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
  const delBtn = e.target.closest('.del-btn');
  if (delBtn) {
    e.stopPropagation();
    const id = delBtn.dataset.id;
    const project = delBtn.dataset.project;
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

  const restoreBtn = e.target.closest('.restore-btn');
  if (restoreBtn) {
    e.stopPropagation();
    fetch('/api/memories/' + restoreBtn.dataset.id + '/restore?project=' + encodeURIComponent(restoreBtn.dataset.project), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('Restore failed'); return r.json(); })
      .then(function (d) {
        if (d.restored) {
          toast('Memory #' + restoreBtn.dataset.id + ' restored', 'success');
          loadMemories().catch(showError);
        }
      })
      .catch(function (err) { toast('Restore failed: ' + err.message, 'error'); });
    return;
  }

  const archiveBtn = e.target.closest('.archive-btn');
  if (archiveBtn) {
    e.stopPropagation();
    fetch('/api/memories/' + archiveBtn.dataset.id + '/archive?project=' + encodeURIComponent(archiveBtn.dataset.project), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('Archive failed'); return r.json(); })
      .then(function (d) {
        if (d.archived) {
          toast('Memory #' + archiveBtn.dataset.id + ' archived', 'success');
          loadMemories().catch(showError);
        }
      })
      .catch(function (err) { toast('Archive failed: ' + err.message, 'error'); });
    return;
  }

  const unarchiveBtn = e.target.closest('.unarchive-btn');
  if (unarchiveBtn) {
    e.stopPropagation();
    fetch('/api/memories/' + unarchiveBtn.dataset.id + '/unarchive?project=' + encodeURIComponent(unarchiveBtn.dataset.project), { method: 'POST' })
      .then(function (r) { if (!r.ok) throw new Error('Unarchive failed'); return r.json(); })
      .then(function (d) {
        if (d.unarchived) {
          toast('Memory #' + unarchiveBtn.dataset.id + ' restored to active', 'success');
          loadMemories().catch(showError);
        }
      })
      .catch(function (err) { toast('Unarchive failed: ' + err.message, 'error'); });
    return;
  }

  const row = e.target.closest('.memory-row');
  if (row) {
    toggleDetail(row.dataset.id);
  }
});

/* Keyboard navigation: Enter/Space on memory rows toggles detail */
document.getElementById('tbody').addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') {
    const row = e.target.closest('.memory-row');
    if (row) {
      e.preventDefault();
      toggleDetail(row.dataset.id);
    }
  }
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
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? '' : 'light');
  localStorage.setItem('hemisphere-theme', isLight ? 'dark' : 'light');
  this.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
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
    const row = document.querySelector('.memory-row[data-id="' + data.id + '"]');
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

/* ===== Granular DOM Helpers ===== */
function removeRow(id) {
  const row = document.querySelector('.memory-row[data-id="' + id + '"]');
  if (!row) return;
  const detailRow = document.querySelector('.detail-row[data-parent="' + id + '"]');
  if (detailRow) {
    detailRow.style.transition = 'opacity .2s, max-height .2s';
    detailRow.style.opacity = '0';
    detailRow.style.maxHeight = '0';
    setTimeout(function () { detailRow.remove(); }, 250);
  }
  row.style.transition = 'opacity .2s';
  row.style.opacity = '0';
  setTimeout(function () { row.remove(); }, 250);
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
  if (document.documentElement.getAttribute('data-theme') === 'light') {
    document.getElementById('theme-btn').setAttribute('aria-label', 'Switch to dark theme');
  }
  loadProjects()
    .then(function () { return loadStats(); })
    .then(function () { return loadMemories(); })
    .catch(showError);
})();
