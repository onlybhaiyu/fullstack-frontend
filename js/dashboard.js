/**
 * dashboard.js — Dashboard Page Logic
 *
 * On page load:
 *  1. Verifies the session via GET /api/auth/me
 *  2. Loads user records from GET /api/users
 *  3. Renders them in a searchable table with Read / Edit / Delete actions
 *
 * All data comes from the real backend. Nothing is faked.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────
let allRecords    = [];
let currentUser   = null;
let deleteTargetId = null;

// ── DOM refs (populated after DOMContentLoaded) ───────────────────
const D = {};

// ── Initialise ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  D.loadingState   = document.getElementById('loading-state');
  D.errorState     = document.getElementById('error-state');
  D.emptyState     = document.getElementById('empty-state');
  D.tableWrapper   = document.getElementById('table-wrapper');
  D.tableBody      = document.getElementById('users-tbody');
  D.recordCount    = document.getElementById('record-count');
  D.searchInput    = document.getElementById('search-input');
  D.refreshBtn     = document.getElementById('refresh-btn');
  D.addBtn         = document.getElementById('add-btn');
  D.logoutBtn      = document.getElementById('logout-btn');
  D.logoutBtnSide  = document.getElementById('logout-btn-sidebar');
  D.userNameEl     = document.getElementById('user-display-name');
  D.userEmailEl    = document.getElementById('user-display-email');
  D.userAvatarEl   = document.getElementById('user-avatar');
  D.welcomeName    = document.getElementById('welcome-name');
  D.deleteModal    = document.getElementById('delete-modal');
  D.deleteConfirm  = document.getElementById('delete-confirm-btn');
  D.deleteCancel   = document.getElementById('delete-cancel-btn');
  D.deleteModalClose = document.getElementById('delete-modal-close');
  D.errorStateMsg  = document.getElementById('error-state-msg');
  D.errorRetryBtn  = document.getElementById('error-retry-btn');
  D.sidebarToggle  = document.getElementById('sidebar-toggle');
  D.sidebar        = document.getElementById('sidebar');

  // Mobile sidebar toggle
  if (D.sidebarToggle && D.sidebar) {
    D.sidebarToggle.addEventListener('click', () => {
      D.sidebar.classList.toggle('open');
    });
  }

  // Wire up logout buttons
  [D.logoutBtn, D.logoutBtnSide].forEach(btn => {
    if (btn) btn.addEventListener('click', handleLogout);
  });

  // Wire up add button
  if (D.addBtn) {
    D.addBtn.addEventListener('click', () => {
      window.location.href = '/profile.html?mode=add';
    });
  }

  // Wire up refresh
  if (D.refreshBtn) {
    D.refreshBtn.addEventListener('click', () => loadRecords());
  }

  // Wire up error retry
  if (D.errorRetryBtn) {
    D.errorRetryBtn.addEventListener('click', () => {
      showState('loading');
      setTimeout(() => bootstrap(), 300);
    });
  }

  // Search input
  if (D.searchInput) {
    D.searchInput.addEventListener('input', () => {
      renderTable(filterRecords(D.searchInput.value));
    });
  }

  // Delete modal buttons
  if (D.deleteConfirm) D.deleteConfirm.addEventListener('click', confirmDelete);
  if (D.deleteCancel)  D.deleteCancel.addEventListener('click',  closeDeleteModal);
  if (D.deleteModalClose) D.deleteModalClose.addEventListener('click', closeDeleteModal);
  if (D.deleteModal) {
    D.deleteModal.addEventListener('click', e => {
      if (e.target === D.deleteModal) closeDeleteModal();
    });
  }

  // Start
  await bootstrap();
});

// ── Bootstrap: verify session then load data ──────────────────────
async function bootstrap() {
  showState('loading');
  try {
    currentUser = await window.Auth.me();
    populateUserInfo(currentUser);
    await loadRecords();
  } catch (err) {
    // If 401 → api.js already redirects. For other errors show error state.
    if (!err.status || err.status !== 401) {
      showErrorState(window.formatError(err));
    }
  }
}

// ── Load records from API ─────────────────────────────────────────
async function loadRecords() {
  showState('loading');
  if (D.refreshBtn) {
    D.refreshBtn.disabled = true;
    D.refreshBtn.innerHTML = `<div class="spinner spinner-sm"></div> Loading…`;
  }
  try {
    const data = await window.Users.list();
    // API may return array directly or { users: [...] } / { data: [...] }
    allRecords = Array.isArray(data) ? data : (data.users || data.data || []);
    renderTable(allRecords);
    showState(allRecords.length ? 'table' : 'empty');
  } catch (err) {
    showErrorState(window.formatError(err));
  } finally {
    if (D.refreshBtn) {
      D.refreshBtn.disabled = false;
      D.refreshBtn.innerHTML = refreshIcon() + ' Refresh';
    }
  }
}

// ── Render table ──────────────────────────────────────────────────
function renderTable(records) {
  if (!D.tableBody) return;

  if (records.length === 0 && D.searchInput?.value) {
    D.tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted)">
          No records match your search.
        </td>
      </tr>`;
    showState('table');
    if (D.recordCount) D.recordCount.textContent = '0 records';
    return;
  }

  D.tableBody.innerHTML = records.map(r => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:0.75rem">
          <div class="avatar" style="width:34px;height:34px;font-size:0.8rem">
            ${initials(r.fullName || r.full_name || 'U')}
          </div>
          <span style="font-weight:600">${escHtml(r.fullName || r.full_name || '—')}</span>
        </div>
      </td>
      <td>${escHtml(r.email || '—')}</td>
      <td>${escHtml(String(r.age || '—'))}</td>
      <td>${escHtml(r.phone || r.phoneNumber || '—')}</td>
      <td>${escHtml(r.city || '—')}</td>
      <td>${escHtml(r.country || '—')}</td>
      <td>
        <div style="display:flex;align-items:center;gap:0.5rem">
          <button class="btn btn-sm btn-secondary btn-icon" title="View"
            onclick="viewRecord('${r.id}')" aria-label="View record">
            ${viewIcon()}
          </button>
          <button class="btn btn-sm btn-secondary btn-icon" title="Edit"
            onclick="editRecord('${r.id}')" aria-label="Edit record">
            ${editIcon()}
          </button>
          <button class="btn btn-sm btn-danger btn-icon" title="Delete"
            onclick="promptDelete('${r.id}', '${escHtml(r.fullName || r.full_name || '')}')"
            aria-label="Delete record">
            ${deleteIcon()}
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  showState('table');
  if (D.recordCount) {
    D.recordCount.textContent = `${records.length} record${records.length !== 1 ? 's' : ''}`;
  }
}

// ── Filter ────────────────────────────────────────────────────────
function filterRecords(query) {
  if (!query) return allRecords;
  const q = query.toLowerCase();
  return allRecords.filter(r =>
    (r.fullName  || r.full_name || '').toLowerCase().includes(q) ||
    (r.email     || '').toLowerCase().includes(q) ||
    (r.city      || '').toLowerCase().includes(q) ||
    (r.country   || '').toLowerCase().includes(q)
  );
}

// ── Actions ───────────────────────────────────────────────────────
window.viewRecord = function(id) {
  window.location.href = `/profile.html?mode=view&id=${id}`;
};

window.editRecord = function(id) {
  window.location.href = `/profile.html?mode=edit&id=${id}`;
};

window.promptDelete = function(id, name) {
  deleteTargetId = id;
  const nameEl = document.getElementById('delete-record-name');
  if (nameEl) nameEl.textContent = name || 'this record';
  if (D.deleteModal) D.deleteModal.style.display = 'flex';
};

function closeDeleteModal() {
  deleteTargetId = null;
  if (D.deleteModal) D.deleteModal.style.display = 'none';
}

async function confirmDelete() {
  if (!deleteTargetId) return;
  const id = deleteTargetId;
  closeDeleteModal();

  if (D.deleteConfirm) {
    D.deleteConfirm.disabled = true;
    D.deleteConfirm.innerHTML = `<div class="spinner"></div> Deleting…`;
  }

  try {
    await window.Users.delete(id);
    allRecords = allRecords.filter(r => String(r.id) !== String(id));
    renderTable(filterRecords(D.searchInput?.value || ''));
    if (allRecords.length === 0) showState('empty');
    showToast('Record deleted successfully.', 'success');
  } catch (err) {
    showToast(window.formatError(err), 'danger');
  } finally {
    if (D.deleteConfirm) {
      D.deleteConfirm.disabled = false;
      D.deleteConfirm.innerHTML = 'Delete';
    }
  }
}

// ── Logout ────────────────────────────────────────────────────────
async function handleLogout() {
  try {
    await window.Auth.logout();
  } catch (_) { /* ignore */ }
  sessionStorage.removeItem('up_user');
  window.location.href = '/login.html';
}

// ── Populate user info ────────────────────────────────────────────
function populateUserInfo(user) {
  if (!user) return;
  const name  = user.fullName || user.full_name || user.name || 'User';
  const email = user.email || '';
  if (D.userNameEl)  D.userNameEl.textContent  = name;
  if (D.userEmailEl) D.userEmailEl.textContent = email;
  if (D.welcomeName) D.welcomeName.textContent = name.split(' ')[0];
  if (D.userAvatarEl) D.userAvatarEl.textContent = initials(name);
}

// ── State management ──────────────────────────────────────────────
function showState(state) {
  const states = { loading: D.loadingState, error: D.errorState, empty: D.emptyState, table: D.tableWrapper };
  Object.entries(states).forEach(([key, el]) => {
    if (el) el.style.display = key === state ? (key === 'table' ? 'block' : 'flex') : 'none';
  });
}

function showErrorState(message) {
  if (D.errorStateMsg) D.errorStateMsg.textContent = message;
  showState('error');
}

// ── Icon helpers ──────────────────────────────────────────────────
function viewIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
}
function editIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
}
function deleteIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>`;
}
function refreshIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;
}

// ── Utility ───────────────────────────────────────────────────────
function initials(name) {
  return name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function showToast(message, type = 'default', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 350);
  }, duration);
}
