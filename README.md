# UserPortal — Frontend Deployment Guide

> **Scope**: Frontend-only static files. This guide covers deploying the UserPortal
> frontend onto an existing **Amazon Linux EC2 instance** running Nginx, configuring
> Nginx to reverse-proxy API requests to an internal Application Load Balancer, and
> wiring up the two-ALB AWS architecture.
>
> No backend code, no database, and no AWS resources are created by this guide.
> The Flask backend, RDS database, and both ALBs must already exist or be created
> separately.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Operating System Detection](#2-operating-system-detection)
3. [Project File Map](#3-project-file-map)
4. [JavaScript File Inspection Summary](#4-javascript-file-inspection-summary)
5. [API Endpoint Reference](#5-api-endpoint-reference)
6. [API Request Flow](#6-api-request-flow)
7. [Nginx Configuration](#7-nginx-configuration)
8. [Deployment Instructions](#8-deployment-instructions)
9. [Security Group Requirements](#9-security-group-requirements)
10. [HTTPS with the External ALB](#10-https-with-the-external-alb)
11. [Backend Requirements](#11-backend-requirements)
12. [Troubleshooting](#12-troubleshooting)
13. [DNS Placeholder Substitution Reference](#13-dns-placeholder-substitution-reference)

---

## 1. Architecture Overview

```
                        PUBLIC INTERNET
                               |
                          HTTPS :443
                               |
                               v
              +--------------------------------+
              |  External ALB                  |
              |  Scheme : Internet-facing      |
              |  Listener : HTTPS :443         |
              |  Target  : Frontend EC2 :80   |
              |  DNS     : EXTERNAL_ALB_DNS    |
              +--------------------------------+
                               |
                          HTTP :80
                               |
                               v
              +--------------------------------+
              |  Frontend EC2  (Amazon Linux)  |
              |  Nginx                         |
              |  Document root:                |
              |    /usr/share/nginx/html       |
              |  Static files: HTML/CSS/JS     |
              |  Reverse proxy: /api/* → ALB   |
              +--------------------------------+
                               |
                    /api/* proxied over HTTP :80
                               |
                               v
              +--------------------------------+
              |  Internal ALB                  |
              |  Scheme : Internal             |
              |  Listener : HTTP :80           |
              |  Target  : Backend EC2 :5000   |
              |  DNS     : INTERNAL_ALB_DNS    |
              +--------------------------------+
                               |
                          HTTP :5000
                               |
                               v
              +--------------------------------+
              |  Backend EC2                   |
              |  Flask REST API (:5000)        |
              +--------------------------------+
                               |
                        MySQL :3306
                               |
                               v
              +--------------------------------+
              |  Amazon RDS (MySQL)            |
              +--------------------------------+
```

### Why two ALBs?

| ALB | Purpose |
|-----|---------|
| **External ALB** | Terminates HTTPS from the public internet. Users never contact the Frontend EC2 directly — they always go through this load balancer. It forwards plain HTTP to the Frontend EC2 on port 80. |
| **Internal ALB** | Routes API traffic inside the VPC from the Frontend EC2 to one or more Flask backend EC2 instances. It is not reachable from the public internet. Its DNS name lives only in the Nginx config on the server — never in browser-side JavaScript. |

### Key security principle

> The browser never talks to the Internal ALB.  
> The Internal ALB DNS name never appears in any `.js` file.  
> Nginx is the only component that knows the Internal ALB DNS name.

---

## 2. Operating System Detection

**This guide assumes Amazon Linux 2 or Amazon Linux 2023**, which is the most common
choice for AWS EC2 instances.

To confirm, run the following command on your frontend EC2 instance:

```bash
# On the frontend EC2
cat /etc/os-release
```

| OS | Default web root | Nginx config directory |
|----|-----------------|------------------------|
| Amazon Linux 2 / 2023 | `/usr/share/nginx/html` | `/etc/nginx/conf.d/` |
| Ubuntu 20.04 / 22.04  | `/var/www/html`         | `/etc/nginx/sites-available/` |

If you are on Ubuntu, adjust every path in this guide from `/usr/share/nginx/html`
to `/var/www/html`, and place the Nginx config in `/etc/nginx/sites-available/`
with a symlink to `/etc/nginx/sites-enabled/`.

To inspect the active Nginx document root on your instance:

```bash
# On the frontend EC2
sudo nginx -T 2>/dev/null | grep -E "root|server_name|listen"
```

---

## 3. Project File Map

After deployment the default Nginx web root must contain exactly this structure:

```
/usr/share/nginx/html/          ← Amazon Linux default
├── index.html                  ← Landing page
├── signup.html                 ← Registration form
├── login.html                  ← Login form
├── dashboard.html              ← Records dashboard
├── profile.html                ← Personal information form (Add/View/Edit)
├── css/
│   └── style.css               ← Complete design system (22 KB)
└── js/
    ├── api.js                  ← Shared Fetch API utility
    ├── auth.js                 ← Signup/login UI logic
    ├── dashboard.js            ← Dashboard table, CRUD actions
    └── profile.js              ← Profile form modes and validation
```

> **Do not copy the project as a nested `userportal/userportal/` directory.**
> Copy the *contents* of `userportal/` directly into the web root.

---

## 4. JavaScript File Inspection Summary

All four JavaScript files were inspected before this guide was written.
**No changes to the JavaScript files were required.**

### `js/api.js`

- `API_BASE` is set to `'/api'` — a relative path. ✅
- No ALB DNS, IP address, or hostname is present anywhere in the file. ✅
- All fetch calls use `credentials: 'same-origin'` so session cookies are
  automatically sent. ✅
- Handles HTTP 401 by redirecting to `/login.html`. ✅
- Handles HTTP 502/503/504 with a clear "backend unavailable" message. ✅
- Handles network timeouts (15 s) and connectivity failures. ✅
- Custom `ApiError` and `NetworkError` classes exposed on `window` for use
  by other scripts. ✅

### `js/auth.js`

- Passwords are **never** stored in `localStorage` or `sessionStorage`. ✅
- Signup calls `Auth.signup()` → `POST /api/auth/signup`. ✅
- Login calls `Auth.login()` → `POST /api/auth/login`. ✅
- Google Sign-In button is a **UI placeholder only** — clicking it shows an
  informational toast. No fake OAuth flow occurs. ✅

### `js/dashboard.js`

- On load, calls `Auth.me()` → `GET /api/auth/me` to verify the session. ✅
- Then calls `Users.list()` → `GET /api/users` to populate the table. ✅
- Delete uses a confirmation modal before calling `Users.delete(id)`. ✅
- No data is mocked or fabricated. ✅

### `js/profile.js`

- Mode is driven by URL query params: `?mode=add`, `?mode=view&id=`, `?mode=edit&id=`. ✅
- Create → `POST /api/users`. ✅
- Read → `GET /api/users/{id}`. ✅
- Update → `PUT /api/users/{id}`. ✅
- Delete → `DELETE /api/users/{id}` with confirmation dialog. ✅
- All field values are read from the DOM and sent to the API. ✅

---

## 5. API Endpoint Reference

All endpoints below are called by the frontend using **relative paths**.
Nginx forwards requests matching `/api/*` to the Internal ALB, which routes
them to the Flask backend.

### Path forwarding behaviour

| Browser request | What Nginx forwards to Internal ALB |
|-----------------|--------------------------------------|
| `GET /api/auth/me` | `GET http://INTERNAL_ALB_DNS/api/auth/me` |
| `POST /api/auth/login` | `POST http://INTERNAL_ALB_DNS/api/auth/login` |
| `GET /api/users` | `GET http://INTERNAL_ALB_DNS/api/users` |
| `PUT /api/users/42` | `PUT http://INTERNAL_ALB_DNS/api/users/42` |

> **The `/api/` prefix is preserved.** Nginx does **not** strip it.
> Your Flask backend must register all routes under `/api/`.

### Authentication endpoints

| Method | Path | Called by | Expected backend behaviour |
|--------|------|-----------|---------------------------|
| `POST` | `/api/auth/signup` | `auth.js` | Create user account. Return `201` on success, `409` if email already exists. |
| `POST` | `/api/auth/login` | `auth.js` | Validate credentials. Set `HttpOnly` session cookie. Return `200` on success, `401` on failure. |
| `POST` | `/api/auth/logout` | `dashboard.js`, `profile.js` | Invalidate session. Return `200` or `204`. |
| `GET`  | `/api/auth/me` | `dashboard.js` | Return current user object from session cookie. Return `401` if no valid session. |

### User record endpoints (CRUD)

| Method | Path | Called by | Expected backend behaviour |
|--------|------|-----------|---------------------------|
| `GET`    | `/api/users` | `dashboard.js` | Return array of user records. Accepts optional `?page=&limit=&search=`. |
| `POST`   | `/api/users` | `profile.js` | Create a record. Return `201` with `{ id, fullName, email, ... }`. |
| `GET`    | `/api/users/{id}` | `profile.js` | Return a single record. `404` if not found. |
| `PUT`    | `/api/users/{id}` | `profile.js` | Update a record. Return `200` with updated object. |
| `DELETE` | `/api/users/{id}` | `profile.js` | Delete a record. Return `200` or `204`. |

### Request and response format

All requests send `Content-Type: application/json` and `Accept: application/json`.
All response bodies must be `application/json`.

**Request body for `POST /api/users` and `PUT /api/users/{id}`:**

```json
{
  "fullName": "Alex Johnson",
  "email":    "alex@example.com",
  "age":      28,
  "phone":    "+1 555 000 0000",
  "city":     "New York",
  "country":  "United States"
}
```

**Error response format (any 4xx/5xx):**

```json
{ "message": "Human-readable error description" }
```
or
```json
{ "error": "Human-readable error description" }
```

Both keys are handled by `api.js` `formatError()`.

---

## 6. API Request Flow

```
Browser
  │
  │  fetch('/api/auth/login', { method:'POST', credentials:'same-origin', body:'...' })
  │
  ▼
External ALB   (EXTERNAL_ALB_DNS:443, HTTPS)
  │
  │  HTTP :80  →  Frontend EC2
  ▼
Nginx on Frontend EC2
  │
  │  location /api/ {
  │      proxy_pass http://INTERNAL_ALB_DNS;
  │  }
  │  Forwards: POST http://INTERNAL_ALB_DNS/api/auth/login
  ▼
Internal ALB   (INTERNAL_ALB_DNS:80)
  │
  │  HTTP :5000  →  Backend EC2
  ▼
Flask app      (Backend EC2:5000)
  │
  │  @app.route('/api/auth/login', methods=['POST'])
  ▼
Amazon RDS     (MySQL :3306)
```

---

## 7. Nginx Configuration

The ready-to-use Nginx server block is in:

```
nginx/userportal.conf
```

Key decisions documented in that file:

| Item | Value | Reason |
|------|-------|--------|
| Document root | `/usr/share/nginx/html` | Amazon Linux default |
| API `proxy_pass` | `http://INTERNAL_ALB_DNS` (no trailing path) | Preserves full `/api/` prefix in forwarded URI |
| `proxy_intercept_errors` | `off` | Lets Flask's own error JSON reach the browser |
| 502/503/504 errors on `/api/` | Returns JSON, not HTML | So `api.js` can parse the error body |
| Static asset caching | `Cache-Control: public, immutable, 1y` | Improves page load after first visit |
| Gzip | Enabled for CSS, JS, JSON | Reduces payload size |

### One-liner to install the config on Amazon Linux

```bash
# On the frontend EC2
sudo cp /tmp/userportal/nginx/userportal.conf /etc/nginx/conf.d/userportal.conf
```

After copying, **edit the file to replace `INTERNAL_ALB_DNS`**:

```bash
sudo nano /etc/nginx/conf.d/userportal.conf
# Find: proxy_pass  http://INTERNAL_ALB_DNS;
# Replace INTERNAL_ALB_DNS with your actual internal ALB DNS name.
```

---

## 8. Deployment Instructions

### 8.1 Detect the operating system (on the EC2)

```bash
# Run this on your frontend EC2 instance
cat /etc/os-release | grep -E "^NAME|^VERSION"
```

### 8.2 Find the active Nginx document root (on the EC2)

```bash
sudo nginx -T 2>/dev/null | grep "root"
# Expected output on Amazon Linux: root /usr/share/nginx/html;
```

---

### 8.3 Upload files from your local computer

Run these commands **on your local machine**. Adjust the key path and EC2 IP.

```bash
# ── From your local machine ──────────────────────────────────────

# Set variables (edit these)
EC2_IP="<YOUR_FRONTEND_EC2_PUBLIC_IP>"
KEY_FILE="/path/to/your-key.pem"
LOCAL_PROJECT="./userportal"

# Upload the entire project to /tmp on the EC2
scp -i "$KEY_FILE" -r "$LOCAL_PROJECT" ec2-user@$EC2_IP:/tmp/userportal
```

---

### 8.4 SSH into the frontend EC2

```bash
# ── From your local machine ──────────────────────────────────────
ssh -i "$KEY_FILE" ec2-user@$EC2_IP
```

All remaining commands are run **on the frontend EC2 instance**.

---

### 8.5 Back up the existing web root

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

WEB_ROOT="/usr/share/nginx/html"
BACKUP_DIR="/tmp/nginx_webroot_backup_$(date +%Y%m%d_%H%M%S)"

sudo cp -r "$WEB_ROOT" "$BACKUP_DIR"
echo "Backup created at: $BACKUP_DIR"
ls "$BACKUP_DIR"
```

---

### 8.6 Deploy frontend files into the web root

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

WEB_ROOT="/usr/share/nginx/html"

# Remove old files (the backup was already made)
sudo rm -rf "$WEB_ROOT"/*

# Copy only the frontend content (not the nginx/ subdirectory and not README)
sudo cp  /tmp/userportal/index.html     "$WEB_ROOT/"
sudo cp  /tmp/userportal/signup.html    "$WEB_ROOT/"
sudo cp  /tmp/userportal/login.html     "$WEB_ROOT/"
sudo cp  /tmp/userportal/dashboard.html "$WEB_ROOT/"
sudo cp  /tmp/userportal/profile.html   "$WEB_ROOT/"
sudo cp -r /tmp/userportal/css         "$WEB_ROOT/"
sudo cp -r /tmp/userportal/js          "$WEB_ROOT/"

# Verify the structure
ls -la "$WEB_ROOT/"
ls -la "$WEB_ROOT/css/"
ls -la "$WEB_ROOT/js/"
```

---

### 8.7 Set ownership and permissions

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

WEB_ROOT="/usr/share/nginx/html"

# Owner: nginx service user on Amazon Linux
sudo chown -R nginx:nginx "$WEB_ROOT"

# Directories: 755 (nginx can traverse), Files: 644 (nginx can read)
sudo find "$WEB_ROOT" -type d -exec chmod 755 {} \;
sudo find "$WEB_ROOT" -type f -exec chmod 644 {} \;
```

---

### 8.8 Install the Nginx configuration

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

# Copy the config file
sudo cp /tmp/userportal/nginx/userportal.conf /etc/nginx/conf.d/userportal.conf

# Open the file and replace INTERNAL_ALB_DNS with your real ALB DNS name
sudo nano /etc/nginx/conf.d/userportal.conf
# Line to edit:
#   proxy_pass  http://INTERNAL_ALB_DNS;
# Replace INTERNAL_ALB_DNS with the actual DNS, e.g.:
#   proxy_pass  http://internal-my-backend-alb-123456789.us-east-1.elb.amazonaws.com;

# Check that the placeholder is gone
grep "INTERNAL_ALB_DNS" /etc/nginx/conf.d/userportal.conf
# This should return nothing. If it returns a line, the placeholder was not replaced.
```

---

### 8.9 Check for conflicting Nginx config files

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

# List all active config files
sudo ls /etc/nginx/conf.d/

# If there is a default.conf that conflicts, disable it:
sudo mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.disabled
# (Only do this if it defines a server {} block on port 80 that conflicts.)
```

---

### 8.10 Validate and reload Nginx

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

# Test configuration — do NOT reload if this reports errors
sudo nginx -t

# If the test passes ("syntax is ok" + "test is successful"):
sudo systemctl reload nginx

# Verify Nginx is running
sudo systemctl status nginx
```

---

### 8.11 Test the deployment

```bash
# ── On the frontend EC2 (local curl test) ────────────────────────

# Test that the landing page is served
curl -I http://localhost/
# Expected: HTTP/1.1 200 OK, Content-Type: text/html

# Test that a CSS asset is served
curl -I http://localhost/css/style.css
# Expected: HTTP/1.1 200 OK, Content-Type: text/css

# Test the API proxy path (this will return 502/503 if Flask is not running)
curl -I http://localhost/api/auth/me
# Expected when Flask is up   : HTTP/1.1 401 Unauthorized (JSON body)
# Expected when Flask is down : HTTP/1.1 503 Service Unavailable (JSON body)
# A 404 from Nginx itself would indicate the proxy_pass block is not matching.
```

```bash
# ── From your local browser ───────────────────────────────────────

# Open the External ALB DNS in a browser:
http://EXTERNAL_ALB_DNS/

# You should see the UserPortal landing page.
# If HTTPS is configured on the External ALB:
https://EXTERNAL_ALB_DNS/
```

---

### 8.12 Check Nginx logs if something fails

```bash
# ── On the frontend EC2 ──────────────────────────────────────────

# Real-time access log
sudo tail -f /var/log/nginx/userportal.access.log

# Real-time error log
sudo tail -f /var/log/nginx/userportal.error.log

# Last 50 error lines
sudo tail -50 /var/log/nginx/error.log
```

---

## 9. Security Group Requirements

Configure your AWS security groups as follows. **Never open the Flask port or
MySQL port to the internet (0.0.0.0/0).**

### External ALB security group

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 443 | 0.0.0.0/0 | HTTPS from public internet |
| Inbound | TCP | 80  | 0.0.0.0/0 | HTTP (temporary test or redirect only) |
| Outbound | TCP | 80 | Frontend EC2 SG | Forward to Nginx |

### Frontend EC2 security group

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 80 | External ALB SG | Nginx serves frontend |
| Inbound | TCP | 22 | Your admin IP only | SSH access |
| Outbound | TCP | 80 | Internal ALB SG | Nginx proxies /api/ |
| Outbound | TCP | 443 | 0.0.0.0/0 | Google Fonts, CDN (if needed) |

> **SSH (port 22) must be restricted to your admin IP only.**
> Never open SSH to 0.0.0.0/0.

### Internal ALB security group

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 80 | Frontend EC2 SG | Receive proxied API requests |
| Outbound | TCP | 5000 | Backend EC2 SG | Forward to Flask |

### Backend EC2 security group

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 5000 | Internal ALB SG | Flask application port |
| Inbound | TCP | 22 | Your admin IP only | SSH access |
| Outbound | TCP | 3306 | RDS SG | MySQL queries |

### RDS security group

| Direction | Protocol | Port | Source | Purpose |
|-----------|----------|------|--------|---------|
| Inbound | TCP | 3306 | Backend EC2 SG | MySQL from Flask only |

### VPC / subnet routing

- The Frontend EC2 must be in a **public subnet** (has a route to the internet gateway)
  so the External ALB can forward traffic to it on port 80.
- The Internal ALB must be in **private subnets** within the same VPC so the
  Frontend EC2 can reach it.
- The Backend EC2 and RDS must be in **private subnets**.
- Ensure the Frontend EC2 can resolve the Internal ALB DNS name:
  - Both must be in the same VPC, or
  - VPC DNS resolution must be enabled (`enableDnsSupport = true`).

---

## 10. HTTPS with the External ALB

### When HTTPS is not yet configured

If you do not yet have a domain name or ACM certificate, you can test over HTTP:

1. Add an inbound rule to the External ALB SG: TCP 80 from 0.0.0.0/0.
2. Add an HTTP :80 listener to the External ALB pointing to the Frontend EC2
   target group.
3. Access `http://EXTERNAL_ALB_DNS/`.

> ⚠️ HTTP is not secure. Remove this HTTP listener before going to production.

### When HTTPS is ready

1. Request or import an ACM certificate for your domain in the same AWS region.
2. Add an HTTPS :443 listener to the External ALB.
3. Select the ACM certificate.
4. Set the default action to forward to the Frontend EC2 target group.
5. Optionally add an HTTP :80 listener that redirects to HTTPS.
6. Update your domain's DNS CNAME or ALIAS record to point to `EXTERNAL_ALB_DNS`.

The Nginx configuration on the EC2 does **not** need to handle TLS — the
External ALB terminates HTTPS and forwards plain HTTP to Nginx on port 80.

---

## 11. Backend Requirements

The following is what the Flask backend must implement for the frontend to work.
These requirements are derived from inspecting the actual frontend JavaScript files.

### Routes (all must be prefixed with `/api/`)

```python
# Authentication
POST   /api/auth/signup     # body: { fullName, email, password }
POST   /api/auth/login      # body: { email, password }
POST   /api/auth/logout     # (empty body)
GET    /api/auth/me         # reads session cookie

# User records
GET    /api/users           # ?page=&limit=&search= (all optional)
POST   /api/users           # body: { fullName, email, age, phone, city, country }
GET    /api/users/<id>
PUT    /api/users/<id>      # same body shape as POST
DELETE /api/users/<id>
```

### Session cookies

- The login endpoint must set an `HttpOnly` cookie (`Secure` when served over HTTPS).
- The `GET /api/auth/me` endpoint reads that cookie and returns the user or `401`.
- Flask-Login or Flask-Session with server-side storage (Redis or DB) is recommended.
- The Nginx config uses `proxy_set_header Host $host`, so the cookie domain will
  match the domain the user visited.

### Response requirements

- All responses must be `Content-Type: application/json`.
- All error responses must include a `message` or `error` field.
- `GET /api/users` may return a JSON array **or** `{ "users": [...] }` or
  `{ "data": [...] }` — all three shapes are handled by `dashboard.js`.
- The `POST /api/users` success response must include the new record's `id`:
  `{ "id": 42, "fullName": "...", ... }`.

### Health check endpoint (recommended)

The Internal ALB target group health check needs an endpoint that returns HTTP 200.
If your Flask app does not yet implement one, add:

```python
@app.route('/api/health')
def health():
    return {'status': 'ok'}, 200
```

Configure the Internal ALB target group health check path to `/api/health`.

---

## 12. Troubleshooting

### 502 Bad Gateway on `/api/*` requests

The browser received a 502 from Nginx, meaning Nginx could not connect to the
Internal ALB (or the ALB could not reach the Flask backend).

```bash
# On the frontend EC2:

# 1. Confirm the Internal ALB DNS name is correct in the Nginx config
grep proxy_pass /etc/nginx/conf.d/userportal.conf

# 2. Try to resolve the Internal ALB DNS from the EC2
nslookup INTERNAL_ALB_DNS
# If this fails: the EC2 is not in the same VPC, or VPC DNS is disabled.

# 3. Try to reach the Internal ALB directly
curl -v http://INTERNAL_ALB_DNS/api/health
# 200 = ALB and backend are healthy
# 502/503 = ALB cannot reach Flask backend; check backend EC2 and its SG
# Connection refused = EC2 cannot reach ALB; check Internal ALB SG

# 4. Check Nginx error log
sudo tail -50 /var/log/nginx/userportal.error.log
```

### 404 Not Found on `/api/*` requests

Nginx returned 404, meaning the `location /api/` block is not matching.

```bash
# Verify the config block exists and syntax is correct
sudo nginx -T 2>/dev/null | grep -A 20 "location /api/"

# Ensure there is no higher-priority location block catching /api/ first
sudo nginx -T 2>/dev/null | grep "location"
```

### 404 Not Found for CSS or JavaScript

```bash
# Confirm files exist in the web root
ls /usr/share/nginx/html/css/style.css
ls /usr/share/nginx/html/js/api.js

# Check permissions
ls -la /usr/share/nginx/html/css/
# Files should be -rw-r--r-- (644) owned by nginx:nginx
```

### DNS resolution failure (cannot reach Internal ALB)

```bash
# On the frontend EC2
nslookup INTERNAL_ALB_DNS
dig INTERNAL_ALB_DNS

# If DNS fails:
# - Confirm both EC2 and Internal ALB are in the same VPC
# - Check VPC settings: enableDnsSupport and enableDnsHostnames must be true
# - Check VPC DHCP options set is using AmazonProvidedDNS
```

### Connection timeout on `/api/*` requests

```bash
# The Nginx config has proxy_connect_timeout 10s; proxy_read_timeout 30s.
# If Flask takes longer than 30 s, the browser will receive a 504.
# Increase proxy_read_timeout in the Nginx config if needed:
sudo nano /etc/nginx/conf.d/userportal.conf
# Then:
sudo nginx -t && sudo systemctl reload nginx

# Also check Internal ALB idle timeout (default 60 s in AWS console)
```

### Unhealthy targets in Internal ALB target group

In the AWS console, go to EC2 → Target Groups → your internal target group →
Targets tab.

If the backend EC2 shows **unhealthy**:

1. Confirm Flask is running on port 5000: `sudo systemctl status flask` or
   `ps aux | grep flask`
2. Confirm the health check path returns 200:
   `curl http://localhost:5000/api/health`
3. Confirm the Backend EC2 SG allows inbound TCP 5000 from the Internal ALB SG.

### Incorrect API paths (Flask gets wrong route)

If Flask logs show `/auth/login` instead of `/api/auth/login`, it means Nginx is
stripping `/api/` from the path. Check that `proxy_pass` does **not** have a
trailing path:

```nginx
# CORRECT — preserves /api/ prefix
proxy_pass http://INTERNAL_ALB_DNS;

# WRONG — strips /api/ from the forwarded path
proxy_pass http://INTERNAL_ALB_DNS/;
```

### Session cookie not being sent to Flask

Symptoms: `GET /api/auth/me` always returns 401 even after login.

- Confirm the login endpoint returns `Set-Cookie` with `Path=/`.
- Confirm `credentials: 'same-origin'` is set in fetch calls (it is — see `api.js`).
- If the External ALB uses HTTPS, confirm the cookie has the `Secure` flag.
- Confirm Flask's `SESSION_COOKIE_SAMESITE` is `'Lax'` (not `'Strict'`), since
  the cookie crosses from the browser to Nginx to Flask.

### Nginx does not reload

```bash
# Check syntax first — never reload if this fails
sudo nginx -t

# If syntax is OK but reload hangs:
sudo systemctl restart nginx

# Check service status
sudo systemctl status nginx
journalctl -u nginx -n 50
```

---

## 13. DNS Placeholder Substitution Reference

This table lists every location where you must replace a placeholder with a real value.

| File | Placeholder | Replace with |
|------|-------------|-------------|
| `nginx/userportal.conf` | `INTERNAL_ALB_DNS` | Your internal ALB DNS name (e.g. `internal-xxx.us-east-1.elb.amazonaws.com`) |
| AWS Console — External ALB | `EXTERNAL_ALB_DNS` | Your external ALB DNS name (used in browser URL and domain CNAME) |
| AWS Console — ACM | *(no placeholder)* | Your actual domain and certificate ARN |
| AWS Console — Target groups | *(no placeholder)* | Your actual EC2 instance IDs and ports |

> **INTERNAL_ALB_DNS must appear only in `/etc/nginx/conf.d/userportal.conf`
> on the server. It must never appear in any `.js`, `.html`, or `.css` file.**

---

*Document version: 2026-10-23. Reflects project files as inspected. Not tested
against a live AWS environment — validate each step on your actual instances.*
