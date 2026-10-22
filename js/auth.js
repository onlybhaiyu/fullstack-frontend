/**
 * auth.js — Authentication UI Logic
 *
 * Handles form validation and wires up the signup / login pages
 * to the real backend through api.js.
 *
 * IMPORTANT:
 *  - Passwords are NEVER stored in localStorage or sessionStorage.
 *  - Authentication state is NOT faked. A real backend response is
 *    required to consider the user authenticated.
 *  - Google Sign-In requires a future backend integration —
 *    the button is a placeholder only.
 */

'use strict';

// ── Toast notification system ────────────────────────────────────
function showToast(message, type = 'default', duration = 5000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    danger:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><triangle points="10.29 3.86 1.82 18 22.18 18"></triangle><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    default: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type] || icons.default}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(16px)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ── Field validation helpers ──────────────────────────────────────
function setFieldState(input, errorEl, isValid, message = '') {
  input.classList.toggle('is-invalid', !isValid);
  input.classList.toggle('is-valid',   isValid && input.value.length > 0);
  if (errorEl) {
    errorEl.textContent = isValid ? '' : message;
    errorEl.style.display = isValid ? 'none' : 'flex';
  }
  return isValid;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function validatePassword(password) {
  return password.length >= 8;
}

// ── Password strength meter ───────────────────────────────────────
function measurePasswordStrength(password) {
  let score = 0;
  if (password.length >= 8)  score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { level: 'weak',   label: 'Weak' };
  if (score === 2) return { level: 'fair',   label: 'Fair' };
  if (score === 3) return { level: 'good',   label: 'Good' };
  return              { level: 'strong', label: 'Strong' };
}

// ── Show / Hide password toggle ───────────────────────────────────
function initPasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.togglePassword);
      if (!target) return;
      const isText = target.type === 'text';
      target.type = isText ? 'password' : 'text';
      btn.innerHTML = isText ? eyeIcon() : eyeOffIcon();
      btn.setAttribute('aria-label', isText ? 'Show password' : 'Hide password');
    });
  });
}

function eyeIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
}

function eyeOffIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
}

// ── Signup Page ───────────────────────────────────────────────────
function initSignupPage() {
  const form           = document.getElementById('signup-form');
  if (!form) return;

  initPasswordToggles();

  const nameInput      = document.getElementById('fullName');
  const emailInput     = document.getElementById('email');
  const passwordInput  = document.getElementById('password');
  const confirmInput   = document.getElementById('confirmPassword');
  const strengthFill   = document.getElementById('strength-fill');
  const strengthLabel  = document.getElementById('strength-label');
  const submitBtn      = document.getElementById('signup-btn');
  const formAlert      = document.getElementById('form-alert');
  const googleBtn      = document.getElementById('google-signin-btn');

  const nameError    = document.getElementById('name-error');
  const emailError   = document.getElementById('email-error');
  const passError    = document.getElementById('pass-error');
  const confirmError = document.getElementById('confirm-error');

  // Password strength listener
  passwordInput.addEventListener('input', () => {
    const val = passwordInput.value;
    if (val.length === 0) {
      strengthFill.className = 'strength-fill';
      strengthFill.style.width = '0%';
      strengthLabel.textContent = '';
      strengthLabel.className = 'strength-label';
      return;
    }
    const { level, label } = measurePasswordStrength(val);
    strengthFill.className = `strength-fill ${level}`;
    strengthLabel.textContent = `Password strength: ${label}`;
    strengthLabel.className = `strength-label ${level}`;
  });

  // Real-time validation
  nameInput.addEventListener('blur', () => {
    setFieldState(nameInput, nameError,
      nameInput.value.trim().length >= 2,
      'Full name must be at least 2 characters.');
  });

  emailInput.addEventListener('blur', () => {
    setFieldState(emailInput, emailError,
      validateEmail(emailInput.value),
      'Please enter a valid email address.');
  });

  passwordInput.addEventListener('blur', () => {
    setFieldState(passwordInput, passError,
      validatePassword(passwordInput.value),
      'Password must be at least 8 characters.');
  });

  confirmInput.addEventListener('blur', () => {
    setFieldState(confirmInput, confirmError,
      confirmInput.value === passwordInput.value && confirmInput.value.length > 0,
      'Passwords do not match.');
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Run all validations
    const v1 = setFieldState(nameInput,    nameError,    nameInput.value.trim().length >= 2, 'Full name must be at least 2 characters.');
    const v2 = setFieldState(emailInput,   emailError,   validateEmail(emailInput.value),    'Please enter a valid email address.');
    const v3 = setFieldState(passwordInput,passError,    validatePassword(passwordInput.value), 'Password must be at least 8 characters.');
    const v4 = setFieldState(confirmInput, confirmError, confirmInput.value === passwordInput.value && confirmInput.value.length > 0, 'Passwords do not match.');

    if (!v1 || !v2 || !v3 || !v4) return;

    // Hide previous alert
    formAlert.style.display = 'none';
    formAlert.className = 'alert';

    setButtonLoading(submitBtn, true, 'Creating Account…');

    try {
      await window.Auth.signup({
        fullName: nameInput.value.trim(),
        email:    emailInput.value.trim().toLowerCase(),
        password: passwordInput.value,
      });

      // Success — only shown because real API responded 2xx
      showAlert(formAlert, 'success',
        'Account created successfully! Redirecting to login…');

      setTimeout(() => {
        window.location.href = '/login.html?registered=1';
      }, 1800);

    } catch (err) {
      const message = window.formatError(err);
      showAlert(formAlert, 'danger', message);
      setButtonLoading(submitBtn, false, 'Create Account');
    }
  });

  // Google sign-in placeholder
  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      showToast(
        'Google Sign-In requires backend OAuth integration. This feature will be enabled once the backend is deployed.',
        'warning',
        6000
      );
    });
  }
}

// ── Login Page ────────────────────────────────────────────────────
function initLoginPage() {
  const form      = document.getElementById('login-form');
  if (!form) return;

  initPasswordToggles();

  const emailInput    = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const submitBtn     = document.getElementById('login-btn');
  const formAlert     = document.getElementById('form-alert');
  const googleBtn     = document.getElementById('google-signin-btn');

  const emailError = document.getElementById('email-error');
  const passError  = document.getElementById('pass-error');

  // Show message if redirected after registration
  const params = new URLSearchParams(window.location.search);
  if (params.get('registered') === '1') {
    showAlert(formAlert, 'success', 'Account created! Please log in to continue.');
  }
  if (params.get('reason') === 'session_expired') {
    showAlert(formAlert, 'warning', 'Your session has expired. Please log in again.');
  }

  emailInput.addEventListener('blur', () => {
    setFieldState(emailInput, emailError,
      validateEmail(emailInput.value),
      'Please enter a valid email address.');
  });

  passwordInput.addEventListener('blur', () => {
    setFieldState(passwordInput, passError,
      passwordInput.value.length > 0,
      'Please enter your password.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const v1 = setFieldState(emailInput,    emailError, validateEmail(emailInput.value), 'Please enter a valid email address.');
    const v2 = setFieldState(passwordInput, passError,  passwordInput.value.length > 0,  'Please enter your password.');
    if (!v1 || !v2) return;

    formAlert.style.display = 'none';
    setButtonLoading(submitBtn, true, 'Signing In…');

    try {
      await window.Auth.login({
        email:    emailInput.value.trim().toLowerCase(),
        password: passwordInput.value,
      });

      // On success the backend sets a session cookie.
      // We redirect to the dashboard which will verify the session via /api/auth/me.
      showAlert(formAlert, 'success', 'Login successful! Redirecting…');
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1000);

    } catch (err) {
      const message = window.formatError(err);
      showAlert(formAlert, 'danger', message);
      setButtonLoading(submitBtn, false, 'Sign In');
    }
  });

  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      showToast(
        'Google Sign-In requires backend OAuth integration. This feature will be enabled once the backend is deployed.',
        'warning',
        6000
      );
    });
  }
}

// ── Shared UI helpers ─────────────────────────────────────────────
function setButtonLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<div class="spinner"></div> ${label}`
    : label;
}

function showAlert(el, type, message) {
  const icons = {
    success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    danger:  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  };
  el.className = `alert alert-${type}`;
  el.innerHTML = `${icons[type] || ''}<span>${message}</span>`;
  el.style.display = 'flex';
}

// ── Init on DOM ready ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSignupPage();
  initLoginPage();
});
