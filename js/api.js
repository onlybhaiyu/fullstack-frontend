/**
 * api.js — Shared API Utility for UserPortal
 *
 * ── API base URL (the one place to configure the backend target) ──
 *
 * Current mode: DIRECT BROWSER → PUBLIC API ALB
 *   The browser calls the API ALB directly over HTTP for testing.
 *   The frontend and API live on different origins, so:
 *     - credentials: 'include'  (sends cookies cross-origin)
 *     - The Flask backend MUST return correct CORS headers (see README)
 *
 * HOW TO SWITCH TO NGINX PROXY MODE (production):
 *   1. Change API_BASE_URL back to '/api'  (a relative path)
 *   2. Change credentials back to 'same-origin'
 *   3. Configure Nginx to proxy /api/* to the internal ALB
 *   4. No other file needs to change.
 *
 * ── Endpoint Map ─────────────────────────────────────────────────
 *  POST   /api/auth/signup          Register a new user
 *  POST   /api/auth/login           Authenticate (returns session cookie)
 *  POST   /api/auth/logout          Invalidate session
 *  GET    /api/auth/me              Fetch current user from session
 *
 *  GET    /api/users                List all user records
 *  POST   /api/users                Create a new user record
 *  GET    /api/users/{id}           Fetch a single record
 *  PUT    /api/users/{id}           Update a record
 *  DELETE /api/users/{id}           Delete a record
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// ── API Base URL ──────────────────────────────────────────────────
//
// TESTING MODE — direct browser-to-ALB over HTTP.
//
// Replace PUBLIC_API_ALB_DNS with your actual publicly reachable
// API ALB DNS name when you have it, for example:
//   const API_BASE_URL = 'http://my-api-alb-123456789.us-east-1.elb.amazonaws.com';
//
// The '/api' suffix must be kept — it is the path prefix that all
// Flask routes are registered under.
//
// ⚠️  HTTP is acceptable for temporary testing only.
//     Switch to HTTPS before handling real user data in production.
//
// ⚠️  Do NOT put credentials, passwords, or AWS secrets in this file.
//
const API_BASE_URL = 'http://PUBLIC_API_ALB_DNS';

// All API paths are appended to API_BASE_URL, e.g.:
//   API_BASE_URL + '/api/auth/login'
//   → http://PUBLIC_API_ALB_DNS/api/auth/login
const API_PATH_PREFIX = '/api';

// Default request timeout in milliseconds
const REQUEST_TIMEOUT_MS = 15000;

// ── Custom Error Types ────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status;   // HTTP status code (or 0 for network error)
    this.body    = body;     // Parsed response body (if available)
  }
}

class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

// ── Core fetch wrapper ────────────────────────────────────────────
/**
 * Makes an HTTP request and returns the parsed JSON response.
 *
 * @param {string} path       - Relative path, e.g. '/auth/login'
 * @param {object} [options]  - Fetch init options (method, body, etc.)
 * @returns {Promise<any>}    - Parsed JSON body
 * @throws {ApiError}         - On non-2xx HTTP responses
 * @throws {NetworkError}     - On connectivity / timeout failures
 */
async function request(path, options = {}) {
  // Combine the absolute base URL with the /api prefix and the specific path.
  // Example: 'http://PUBLIC_API_ALB_DNS' + '/api' + '/auth/login'
  const url = `${API_BASE_URL}${API_PATH_PREFIX}${path}`;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const defaultHeaders = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

  const init = {
    // 'include' is required for cross-origin requests so the browser
    // attaches session cookies set by the API ALB / Flask backend.
    // If the frontend and API were on the same origin (Nginx proxy mode)
    // this would be 'same-origin'. See README for the full explanation.
    credentials: 'include',
    headers: { ...defaultHeaders, ...(options.headers || {}) },
    signal: controller.signal,
    ...options,
  };

  // Serialize body to JSON if it's a plain object
  if (init.body && typeof init.body === 'object') {
    init.body = JSON.stringify(init.body);
  }

  try {
    const response = await fetch(url, init);
    clearTimeout(timeoutId);

    // Parse response body (may be empty for 204 No Content)
    let data = null;
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json') && response.status !== 204) {
      data = await response.json();
    }

    // ── Handle specific HTTP statuses ──────────────────────────
    if (response.status === 401) {
      // Session expired or not authenticated — redirect to login
      _handleUnauthorized();
      throw new ApiError('Session expired. Please log in again.', 401, data);
    }

    if (response.status === 503 || response.status === 502 || response.status === 504) {
      throw new ApiError(
        'The backend service is currently unavailable. Please try again later.',
        response.status,
        data
      );
    }

    if (!response.ok) {
      const message = data?.message || data?.error || `Request failed (HTTP ${response.status})`;
      throw new ApiError(message, response.status, data);
    }

    return data;

  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof ApiError) throw err;

    // AbortController timeout or fetch network failure
    if (err.name === 'AbortError') {
      throw new NetworkError('The request timed out. Please check your connection.');
    }

    // Generic network failure: DNS resolution failed, connection refused,
    // no internet, or CORS preflight was rejected by the backend.
    // Check: (1) PUBLIC_API_ALB_DNS is reachable from the browser,
    //        (2) the backend has CORS headers allowing this origin,
    //        (3) the ALB security group allows inbound HTTP :80 from the internet.
    throw new NetworkError(
      'Cannot reach the API server. The backend may not be deployed, ' +
      'the API ALB DNS may be unreachable, or CORS is not configured on the backend.'
    );
  }
}

// ── Convenience Methods ───────────────────────────────────────────
const api = {
  get:    (path, options = {}) => request(path, { method: 'GET',    ...options }),
  post:   (path, body, options = {}) => request(path, { method: 'POST',   body, ...options }),
  put:    (path, body, options = {}) => request(path, { method: 'PUT',    body, ...options }),
  patch:  (path, body, options = {}) => request(path, { method: 'PATCH',  body, ...options }),
  delete: (path, options = {}) => request(path, { method: 'DELETE', ...options }),
};

// ── Auth Endpoints ────────────────────────────────────────────────
const Auth = {
  /**
   * Register a new user.
   * @param {{ fullName: string, email: string, password: string }} data
   */
  signup(data) {
    return api.post('/auth/signup', data);
  },

  /**
   * Authenticate with email and password.
   * The backend sets an HttpOnly session cookie on success.
   * @param {{ email: string, password: string }} data
   */
  login(data) {
    return api.post('/auth/login', data);
  },

  /**
   * Invalidate the current session.
   */
  logout() {
    return api.post('/auth/logout', {});
  },

  /**
   * Fetch the authenticated user from the session cookie.
   * Use this to verify authentication and load profile data.
   */
  me() {
    return api.get('/auth/me');
  },
};

// ── Users Endpoints ───────────────────────────────────────────────
const Users = {
  /**
   * Retrieve all user information records.
   * @param {{ page?: number, limit?: number, search?: string }} [params]
   */
  list(params = {}) {
    const query = new URLSearchParams(params).toString();
    return api.get(`/users${query ? `?${query}` : ''}`);
  },

  /**
   * Create a new user information record.
   * @param {{ fullName: string, email: string, age?: number, phone?: string, city?: string, country?: string }} data
   */
  create(data) {
    return api.post('/users', data);
  },

  /**
   * Retrieve a single user record by ID.
   * @param {string|number} id
   */
  get(id) {
    return api.get(`/users/${id}`);
  },

  /**
   * Update an existing user record.
   * @param {string|number} id
   * @param {object} data
   */
  update(id, data) {
    return api.put(`/users/${id}`, data);
  },

  /**
   * Delete a user record.
   * @param {string|number} id
   */
  delete(id) {
    return api.delete(`/users/${id}`);
  },
};

// ── Internal Helpers ──────────────────────────────────────────────
function _handleUnauthorized() {
  // Clear any non-sensitive UI state and redirect
  sessionStorage.removeItem('up_user');
  // Avoid redirect loop if already on login/signup
  const publicPages = ['/login.html', '/signup.html', '/index.html', '/'];
  const current     = window.location.pathname;
  if (!publicPages.some(p => current.endsWith(p))) {
    window.location.href = '/login.html?reason=session_expired';
  }
}

/**
 * Formats an API or Network error into a user-friendly string.
 * @param {ApiError|NetworkError|Error} err
 * @returns {string}
 */
function formatError(err) {
  if (err instanceof NetworkError) return err.message;
  if (err instanceof ApiError) {
    if (err.status === 0 || !err.status) return 'Unable to connect to the server.';
    if (err.status >= 500) return `Server error (${err.status}). Please try again later.`;
    if (err.status === 404) return 'The requested resource was not found.';
    if (err.status === 409) return err.message || 'A conflict occurred (e.g., email already in use).';
    if (err.status === 422) return err.message || 'Validation failed. Please check your input.';
    return err.message || 'An unexpected error occurred.';
  }
  return err.message || 'An unexpected error occurred.';
}

// ── Exports (accessible via global scope for vanilla JS) ──────────
window.Api       = api;
window.Auth      = Auth;
window.Users     = Users;
window.ApiError  = ApiError;
window.NetworkError = NetworkError;
window.formatError  = formatError;
