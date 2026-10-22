/**
 * profile.js — Personal Information Form Logic
 *
 * Supports three modes driven by URL query parameters:
 *   ?mode=add           → Create a new record (POST /api/users)
 *   ?mode=view&id={id}  → Read only (GET /api/users/{id})
 *   ?mode=edit&id={id}  → Pre-fill and update (PUT /api/users/{id})
 *
 * Deletion uses DELETE /api/users/{id} with a confirmation dialog.
 * No data is saved to localStorage. All reads and writes go to the API.
 */

'use strict';

// ── Parse URL params ──────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const MODE   = params.get('mode') || 'add';
const RECORD_ID = params.get('id') || null;

// ── DOM refs ──────────────────────────────────────────────────────
let form, formAlert, pageTitle, pageSubtitle;
let saveBtn, editBtn, deleteBtn, cancelBtn, readBtn;
let loadingOverlay, formContent;

// Field refs
const fields = ['fullName', 'email', 'age', 'phone', 'city', 'country'];
const fieldRefs = {};

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  form           = document.getElementById('profile-form');
  formAlert      = document.getElementById('form-alert');
  pageTitle      = document.getElementById('page-title');
  pageSubtitle   = document.getElementById('page-subtitle');
  saveBtn        = document.getElementById('save-btn');
  editBtn        = document.getElementById('edit-btn');
  deleteBtn      = document.getElementById('delete-btn');
  cancelBtn      = document.getElementById('cancel-btn');
  readBtn        = document.getElementById('read-btn');
  loadingOverlay = document.getElementById('form-loading');
  formContent    = document.getElementById('form-content');

  // Mobile sidebar toggle
  const toggle  = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  // Populate field refs
  fields.forEach(f => {
    fieldRefs[f] = document.getElementById(f);
  });

  // Wire up buttons
  if (form)      form.addEventListener('submit', handleSave);
  if (editBtn)   editBtn.addEventListener('click', enterEditMode);
  if (deleteBtn) deleteBtn.addEventListener('click', handleDelete);
  if (cancelBtn) cancelBtn.addEventListener('click', handleCancel);
  if (readBtn)   readBtn.addEventListener('click', handleRead);

  // Delete modal
  const confirmBtn = document.getElementById('delete-confirm-btn');
  const cancelModal = document.getElementById('delete-cancel-btn');
  const closeModal  = document.getElementById('delete-modal-close');
  const modal       = document.getElementById('delete-modal');

  if (confirmBtn) confirmBtn.addEventListener('click', executeDelete);
  if (cancelModal) cancelModal.addEventListener('click', closeDeleteModal);
  if (closeModal)  closeModal.addEventListener('click', closeDeleteModal);
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeDeleteModal(); });

  // Logout
  const logoutBtns = document.querySelectorAll('.logout-btn');
  logoutBtns.forEach(btn => btn.addEventListener('click', handleLogout));

  // Apply mode
  await applyMode();
});

// ── Mode application ──────────────────────────────────────────────
async function applyMode() {
  switch (MODE) {
    case 'view':
      setFormReadOnly(true);
      updateUI({ title: 'View Record', subtitle: 'Personal information details', saveVisible: false, editVisible: true, deleteVisible: true, readVisible: false });
      if (RECORD_ID) await loadRecord(RECORD_ID);
      break;

    case 'edit':
      setFormReadOnly(false);
      updateUI({ title: 'Edit Record', subtitle: 'Update personal information', saveVisible: true, editVisible: false, deleteVisible: true, readVisible: false });
      if (RECORD_ID) await loadRecord(RECORD_ID);
      break;

    case 'add':
    default:
      setFormReadOnly(false);
      updateUI({ title: 'Add Information', subtitle: 'Enter new personal information', saveVisible: true, editVisible: false, deleteVisible: false, readVisible: false });
      break;
  }
}

// ── Load a record from API ────────────────────────────────────────
async function loadRecord(id) {
  showOverlay(true);
  hideAlert();
  try {
    const record = await window.Users.get(id);
    populateForm(record);
  } catch (err) {
    showAlertMsg('danger', 'Could not load record: ' + window.formatError(err));
  } finally {
    showOverlay(false);
  }
}

// ── Populate form fields ──────────────────────────────────────────
function populateForm(record) {
  if (!record) return;
  const map = {
    fullName: record.fullName  || record.full_name || '',
    email:    record.email     || '',
    age:      record.age       != null ? String(record.age) : '',
    phone:    record.phone     || record.phoneNumber || '',
    city:     record.city      || '',
    country:  record.country   || '',
  };
  fields.forEach(f => {
    if (fieldRefs[f]) fieldRefs[f].value = map[f] || '';
  });
}

// ── Gather form data ──────────────────────────────────────────────
function collectFormData() {
  return {
    fullName: fieldRefs.fullName?.value.trim()   || '',
    email:    fieldRefs.email?.value.trim()      || '',
    age:      fieldRefs.age?.value ? Number(fieldRefs.age.value) : null,
    phone:    fieldRefs.phone?.value.trim()      || '',
    city:     fieldRefs.city?.value.trim()       || '',
    country:  fieldRefs.country?.value.trim()    || '',
  };
}

// ── Validation ────────────────────────────────────────────────────
function validateForm(data) {
  clearValidation();
  let valid = true;

  if (!data.fullName || data.fullName.length < 2) {
    showFieldError('fullName', 'Full name is required (min 2 characters).');
    valid = false;
  }

  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    showFieldError('email', 'A valid email address is required.');
    valid = false;
  }

  if (data.age !== null && (isNaN(data.age) || data.age < 1 || data.age > 130)) {
    showFieldError('age', 'Age must be between 1 and 130.');
    valid = false;
  }

  if (data.phone && !/^[\d\s\+\-\(\)]{6,20}$/.test(data.phone)) {
    showFieldError('phone', 'Enter a valid phone number.');
    valid = false;
  }

  return valid;
}

function showFieldError(fieldName, message) {
  const input = fieldRefs[fieldName];
  const errorEl = document.getElementById(`${fieldName}-error`);
  if (input) input.classList.add('is-invalid');
  if (errorEl) { errorEl.textContent = message; errorEl.style.display = 'flex'; }
}

function clearValidation() {
  fields.forEach(f => {
    if (fieldRefs[f]) fieldRefs[f].classList.remove('is-invalid', 'is-valid');
    const errEl = document.getElementById(`${f}-error`);
    if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  });
}

// ── Save (Create or Update) ───────────────────────────────────────
async function handleSave(e) {
  e.preventDefault();
  const data = collectFormData();
  if (!validateForm(data)) return;

  hideAlert();
  setBtnLoading(saveBtn, true, 'Saving…');

  try {
    let result;
    if (MODE === 'edit' && RECORD_ID) {
      result = await window.Users.update(RECORD_ID, data);
      showAlertMsg('success', 'Record updated successfully!');
    } else {
      result = await window.Users.create(data);
      showAlertMsg('success', 'Record saved successfully!');
      // Switch to view mode with the new ID
      const newId = result?.id || result?.data?.id;
      if (newId) {
        setTimeout(() => {
          window.location.href = `/profile.html?mode=view&id=${newId}`;
        }, 1500);
      }
    }
  } catch (err) {
    showAlertMsg('danger', window.formatError(err));
  } finally {
    setBtnLoading(saveBtn, false, 'Save Information');
  }
}

// ── Read (manual refresh) ─────────────────────────────────────────
async function handleRead() {
  if (!RECORD_ID) {
    showAlertMsg('warning', 'No record selected. Please select a record from the dashboard.');
    return;
  }
  await loadRecord(RECORD_ID);
  showAlertMsg('success', 'Record loaded from server.');
}

// ── Edit mode ─────────────────────────────────────────────────────
function enterEditMode() {
  window.location.href = `/profile.html?mode=edit&id=${RECORD_ID}`;
}

// ── Delete ────────────────────────────────────────────────────────
function handleDelete() {
  if (!RECORD_ID) return;
  const modal = document.getElementById('delete-modal');
  if (modal) modal.style.display = 'flex';
}

async function executeDelete() {
  closeDeleteModal();
  if (!RECORD_ID) return;

  setBtnLoading(deleteBtn, true, 'Deleting…');
  hideAlert();

  try {
    await window.Users.delete(RECORD_ID);
    showAlertMsg('success', 'Record deleted. Returning to dashboard…');
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 1800);
  } catch (err) {
    showAlertMsg('danger', window.formatError(err));
    setBtnLoading(deleteBtn, false, 'Delete');
  }
}

function closeDeleteModal() {
  const modal = document.getElementById('delete-modal');
  if (modal) modal.style.display = 'none';
}

// ── Cancel ────────────────────────────────────────────────────────
function handleCancel() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    window.location.href = '/dashboard.html';
  }
}

// ── Logout ────────────────────────────────────────────────────────
async function handleLogout() {
  try { await window.Auth.logout(); } catch (_) { /* ignore */ }
  sessionStorage.removeItem('up_user');
  window.location.href = '/login.html';
}

// ── UI Helpers ────────────────────────────────────────────────────
function updateUI({ title, subtitle, saveVisible, editVisible, deleteVisible, readVisible }) {
  if (pageTitle)    pageTitle.textContent    = title;
  if (pageSubtitle) pageSubtitle.textContent = subtitle;
  toggle(saveBtn,   saveVisible);
  toggle(editBtn,   editVisible);
  toggle(deleteBtn, deleteVisible);
  toggle(readBtn,   readVisible);
}

function toggle(el, visible) {
  if (el) el.style.display = visible ? 'inline-flex' : 'none';
}

function setFormReadOnly(readonly) {
  fields.forEach(f => {
    if (fieldRefs[f]) {
      fieldRefs[f].readOnly = readonly;
      fieldRefs[f].style.background = readonly ? 'var(--gray-50)' : '';
      fieldRefs[f].style.cursor     = readonly ? 'default' : '';
    }
  });
}

function showOverlay(show) {
  if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
  if (formContent)    formContent.style.display    = show ? 'none' : 'block';
}

function showAlertMsg(type, message) {
  if (!formAlert) return;
  const icons = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    danger:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  };
  formAlert.className = `alert alert-${type}`;
  formAlert.innerHTML = `${icons[type] || ''}<span>${message}</span>`;
  formAlert.style.display = 'flex';
  formAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideAlert() {
  if (formAlert) formAlert.style.display = 'none';
}

function setBtnLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? `<div class="spinner spinner-sm"></div> ${label}` : label;
}
