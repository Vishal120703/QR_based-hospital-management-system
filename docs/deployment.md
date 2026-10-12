# Deploying CARE QR

The API (`services/`) runs on **Render**. The database is any managed **PostgreSQL** 17 or newer; the live deployment uses **Neon**. The web app (`frontend/`) runs on **Vercel**. The browser calls the API directly; the API allows calls only from the web app's address.

```text
Phone / staff browser ──► Vercel (web app) ──► Render (API) ──► PostgreSQL (Neon)
                         VITE_API_URL ─────────┘   PUBLIC_APP_URL = the Vercel address
```

Order: **1.** a PostgreSQL database → **2.** API on Render → **3.** web app on Vercel → **4.** tell the API the web app's address → **5.** create the first super admin.

## 1. The database

Create a PostgreSQL database with your provider (Neon: **New project**; Render PostgreSQL also works) and copy its connection string. Use it as `DATABASE_URL` below. Nothing in this repository creates, replaces, or deletes a database.

## 2. API on Render

### Option A: Blueprint (recommended)

1. Push the repository to GitHub.
2. Render dashboard → **New → Blueprint** → choose the repository. Render reads [`render.yaml`](../render.yaml) and creates the **careqr-api** web service.
3. When asked, enter `DATABASE_URL` (your connection string) and `PUBLIC_APP_URL` (your Vercel address, for example `https://care-qr.vercel.app`, or a placeholder such as `https://example.com` that you fix in step 4). Leave `CORS_ORIGINS` empty. Render keeps these values; later Blueprint syncs do not overwrite them.
4. Wait for the deploy. Open `https://<your-api>.onrender.com/ready`; it should show `"status":"ok"`.

### Option B: a web service you already created

Set these on the web service (**Settings** and **Environment**):

| Setting | Value |
|---|---|
| Root Directory | `services` |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start:prod` |
| Health Check Path | `/health` |

| Environment variable | Value |
|---|---|
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your database's connection string (Neon: from **Connect**; Render PostgreSQL: the **Internal Database URL**) |
| `PUBLIC_APP_URL` | your Vercel address, e.g. `https://care-qr.vercel.app` (no trailing slash) |
| `CORS_ORIGINS` | optional: other web addresses allowed to call the API, comma-separated |
| `TRUST_PROXY` | `3` (Cloudflare, Render's load balancer, and a local proxy sit in front of the API) |
| `ESCALATION_INTERVAL_SECONDS` | optional, default `60`: how often the SLA worker escalates overdue requests; `0` turns it off in that instance |
| `SHUTDOWN_TIMEOUT_SECONDS` | optional, default `10`: on a redeploy or stop, how long requests in progress may take to finish (keep under Render's 30 seconds) |

Do **not** set `HOST`, `PORT`, or `REDIS_URL`; Render provides the port, and nothing needs Redis yet. Without `TRUST_PROXY=3`, every visitor looks like Render's internal address, so sign-in and QR-scan rate limits would be shared by everyone.

`npm run build` generates the database client and compiles the API. `npm run start:prod` applies any new database migrations, then starts the API, so the database is always up to date. If a migration ever fails through a pooled connection (Neon's `-pooler` host), run that deploy's migration once with the direct (non-pooled) connection string: `DATABASE_URL="<direct URL>" npx prisma migrate deploy` from `services/`.

## 3. Web app on Vercel

1. Vercel → **Add New → Project** → import the repository.
2. **Root Directory:** `frontend`. Vercel detects Vite: build `npm run build`, output `dist`.
3. **Environment Variables:** `VITE_API_URL` = your Render API address, e.g. `https://careqr-api.onrender.com` (no trailing slash, no `/api`).
4. Deploy. [`frontend/vercel.json`](../frontend/vercel.json) makes every page link (`/admin/...`, printed QR links `/q/...`) open the app, and sends the security headers (no referrer, no framing by other sites, camera only for this site).

`VITE_API_URL` is built into the app, and into its Content Security Policy (the only API address the page may call), so after changing it, redeploy (**Deployments → Redeploy**).

## 4. Tell the API the web app's address

In Render, set `PUBLIC_APP_URL` to the exact Vercel address (for example `https://care-qr.vercel.app`) and save; Render redeploys. This address:

- is the only web origin allowed to call the API (add others, such as preview deployments, to `CORS_ORIGINS`);
- is where printed QR codes point (`<PUBLIC_APP_URL>/q/<token>`). If you later move to your own domain, update it and replace the printed labels.

## 5. Create the first super admin

The super admin creates clients and hospitals (each with its first Hospital Manager) from `/platform/login`. Create the super admin once from your computer, against the Render database:

1. Copy the database's connection string that works from outside the provider (Neon: the connection string; Render PostgreSQL: **Connections → External Database URL**).
2. In `services/` on your computer (Node 24 and `npm install` done):

```bash
DATABASE_URL="<connection string>" PLATFORM_ADMIN_EMAIL="you@example.com" PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD="<at least 12 characters>" npm run bootstrap:platform-admin
```

The values typed on the command line take priority over `services/.env`. If the connection is refused, add `?sslmode=require` to the end of the URL.

3. Open `https://<your-vercel-app>/platform/login`, sign in, and add your first client and hospital.

The demo and test seeds (`seed:demo`, `seed:test`) refuse to run against anything but a local database, so they cannot fill production with dummy accounts.

## Checking a deployment

| Check | Expected |
|---|---|
| `https://<api>.onrender.com/` | `{"service":"CARE QR API","status":"ok",...}` |
| `https://<api>.onrender.com/health` | `{"status":"ok"}` |
| `https://<api>.onrender.com/ready` | `"status":"ok"` with `postgresql` ok |
| Render logs at start-up | `CARE QR API listening` with your `publicAppUrl`, `corsOrigins`, and `escalationIntervalSeconds` |
| `https://<web>.vercel.app/login` | the sign-in page; signing in works |
| A printed QR label | opens `https://<web>.vercel.app/q/...` on a phone; the patient can send a request |
| Requests screen (as a manager) | the request appears; assign, accept, complete, and close work |

### Deploying a new version, and going back

1. **API first, then the web app.** A new web app may call API features the old API does not have yet (for example the paged Requests list). Render and Vercel both deploy on push; if Vercel finishes first, the Requests screen can fail for a few minutes until Render is live. For a pilot, deploy outside busy hours, or turn off Vercel's automatic deploys and redeploy the web app once Render shows the new version live.
2. After both are live, repeat the checks above.
3. **Going back:** Render → the service → **Events** → choose the previous deploy → **Rollback**; Vercel → **Deployments** → the previous one → **Promote to Production**. Database migrations only move forward and are written to stay compatible with the version before (new columns have defaults; new tables are unused by older code), so rolling the app back does not need a database change. Never undo a migration on the live database by hand.

## Health checks and monitoring

| Endpoint | Meaning | Use it for |
|---|---|---|
| `/health` | The API process is running and answering. Checks nothing else. | Render's health check (a database outage must not make Render restart a healthy API). |
| `/ready` | The API can serve requests: PostgreSQL (and Redis, if set) answered within 3 seconds. `503` otherwise, without internal details; the log names the failed dependency. | An uptime monitor (for example every 1–5 minutes) that alerts you. |

Nothing in this repository sets up an uptime monitor: add one with your monitoring service and point it at `https://<api>.onrender.com/ready`.

On a redeploy or stop, the API stops taking new requests, lets those in progress finish (up to `SHUTDOWN_TIMEOUT_SECONDS`), stops the SLA worker, then closes the database connection. If the port is taken or a setting is wrong at start-up, the log says so in one line and the process exits.

The **SLA worker** runs inside the API: every minute it escalates requests past their deadline by the service's escalation policy, once per step. It runs only while the API is awake: on Render's free plan it pauses with the API after 15 minutes without traffic. Several API instances can run it at the same time safely.

## Backups and restore

The database holds every hospital's staff accounts (with password hashes), requests and their history, and the audit log. Back it up, and test that a backup restores, before a pilot.

**What your provider keeps.** Neon keeps history you can restore to a past moment ("restore" / "instant restore" in the Neon console), but how far back depends on your plan, so check the restore window in your Neon project settings before relying on it. Render PostgreSQL backups also depend on the plan. Do not assume a plan includes them.

**Your own copy (works with any plan).** From a trusted computer with PostgreSQL 17+ client tools, using the **direct** (non-pooled) connection string:

```bash
pg_dump --format=custom --no-owner --file "careqr-$(date +%Y-%m-%d).dump" "<direct connection string>"
```

Keep dumps encrypted and off the database provider (they contain personal data), keep several days and weeks, and never commit them to the repository.

**Test a restore regularly**, into a separate, empty database (local or staging), never the live one:

```bash
createdb careqr_restore_test
pg_restore --no-owner --dbname "postgresql://<you>@localhost:5432/careqr_restore_test" careqr-YYYY-MM-DD.dump
DATABASE_URL="postgresql://<you>@localhost:5432/careqr_restore_test" npx prisma migrate status
```

`migrate status` (run in `services/`) should say the schema is up to date; then check that the counts of hospitals, staff, and requests look right, and delete the test database. Restoring into the live database replaces its data: do it only as a planned recovery, with the hospital's approval.

## Troubleshooting

| What you see | Fix |
|---|---|
| Render log: `API failed to start: check the environment variables` with `PUBLIC_APP_URL ... is required` | Set `PUBLIC_APP_URL` on the Render service. The log names every missing or invalid variable. |
| Render log: `tsc: not found` or `prisma: not found` | Build command must be `npm ci --include=dev && npm run build`. |
| Render log: `Cannot find module .../dist/src/server.js` | Root Directory must be `services`, and the build command must run `npm run build`. |
| Render log: `The table ... does not exist` | Start command must be `npm run start:prod`, which applies migrations. |
| Render log: `Redis client error` | Remove `REDIS_URL`, or point it at a working Redis. |
| Web app: "Cannot reach the hospital system" | `VITE_API_URL` is missing or wrong on Vercel (redeploy after fixing it), or the API is asleep (below). |
| Browser console: blocked by CORS policy | `PUBLIC_APP_URL` on Render must match the web address exactly (`https`, no trailing slash). Add other addresses to `CORS_ORIGINS`. |
| Refreshing `/admin/...` on Vercel shows 404 | `frontend/vercel.json` must be deployed (Root Directory `frontend`). |
| Opening the API address shows `{"service":"CARE QR API","status":"ok",...}` | Expected: that is the API, not the web app. Open the Vercel address to use CARE QR. |
| Many people get "Too many requests" at sign-in | Set `TRUST_PROXY=3` on Render so each visitor is counted separately. |
| The first request takes about a minute | Render's free plan sleeps after 15 minutes without traffic (and the SLA worker pauses too). An always-on instance stays awake. |
| Free database stops working | Free database plans can expire or pause (Render's free PostgreSQL expires after a trial period); check your provider's plan before going live. |
| Render log: `API failed to start: Port ... is already in use` | Another process uses the port; on Render, do not set `PORT`. |
| Staff see "Choose a new password" after signing in | An administrator reset their password; they enter the temporary one and choose their own. |
| Browser console: "Refused to connect ... Content Security Policy" | The web app was built with a different `VITE_API_URL` than the API it calls: fix it on Vercel and redeploy. |

## Local development is unchanged

`npm run dev` in `services/` and `frontend/` works as before: Vite forwards `/api` to `http://localhost:3001`, so `VITE_API_URL` stays unset locally.
