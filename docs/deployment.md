# Deploying CARE QR

The API (`services/`) runs on **Render** with a Render PostgreSQL database. The web app (`frontend/`) runs on **Vercel**. The browser calls the API directly; the API allows calls only from the web app's address.

```text
Phone / staff browser ──► Vercel (web app) ──► Render (API) ──► Render PostgreSQL
                         VITE_API_URL ─────────┘   PUBLIC_APP_URL = the Vercel address
```

Order: **1.** API and database on Render → **2.** web app on Vercel → **3.** tell the API the web app's address → **4.** create the first super admin.

## 1. API and database on Render

### Option A: Blueprint (recommended)

1. Push the repository to GitHub.
2. Render dashboard → **New → Blueprint** → choose the repository. Render reads [`render.yaml`](../render.yaml) and creates the **careqr-api** web service and the **careqr-db** database.
3. When asked for `PUBLIC_APP_URL`, enter your Vercel address if you know it (for example `https://care-qr.vercel.app`), or any placeholder such as `https://example.com` and fix it in step 3. Leave `CORS_ORIGINS` empty.
4. Wait for the deploy. Open `https://<your-api>.onrender.com/ready`; it should show `"status":"ok"`.

### Option B: a web service you already created

Create a PostgreSQL database in Render first, then set these on the web service (**Settings** and **Environment**):

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
| `DATABASE_URL` | the database's **Internal Database URL** |
| `PUBLIC_APP_URL` | your Vercel address, e.g. `https://care-qr.vercel.app` (no trailing slash) |
| `CORS_ORIGINS` | optional: other web addresses allowed to call the API, comma-separated |

Do **not** set `HOST` or `PORT`; Render provides the port. `REDIS_URL` is optional (nothing needs Redis yet), and `TRUST_PROXY` defaults to `1` in production, which is right for Render.

`npm run build` generates the database client and compiles the API. `npm run start:prod` applies any new database migrations, then starts the API, so the database is always up to date.

## 2. Web app on Vercel

1. Vercel → **Add New → Project** → import the repository.
2. **Root Directory:** `frontend`. Vercel detects Vite: build `npm run build`, output `dist`.
3. **Environment Variables:** `VITE_API_URL` = your Render API address, e.g. `https://careqr-api.onrender.com` (no trailing slash, no `/api`).
4. Deploy. [`frontend/vercel.json`](../frontend/vercel.json) makes every page link (`/admin/...`, printed QR links `/q/...`) open the app.

`VITE_API_URL` is built into the app, so after changing it, redeploy (**Deployments → Redeploy**).

## 3. Tell the API the web app's address

In Render, set `PUBLIC_APP_URL` to the exact Vercel address (for example `https://care-qr.vercel.app`) and save; Render redeploys. This address:

- is the only web origin allowed to call the API (add others, such as preview deployments, to `CORS_ORIGINS`);
- is where printed QR codes point (`<PUBLIC_APP_URL>/q/<token>`). If you later move to your own domain, update it and replace the printed labels.

## 4. Create the first super admin

The super admin creates clients and hospitals (each with its first Hospital Manager) from `/platform/login`. Create the super admin once from your computer, against the Render database:

1. Render → database → **Connections** → copy the **External Database URL**.
2. In `services/` on your computer (Node 24 and `npm install` done):

```bash
DATABASE_URL="<External Database URL>" PLATFORM_ADMIN_EMAIL="you@example.com" PLATFORM_ADMIN_NAME="Your Name" PLATFORM_ADMIN_PASSWORD="<at least 12 characters>" npm run bootstrap:platform-admin
```

The values typed on the command line take priority over `services/.env`. If the connection is refused, add `?sslmode=require` to the end of the URL.

3. Open `https://<your-vercel-app>/platform/login`, sign in, and add your first client and hospital.

The demo and test seeds (`seed:demo`, `seed:test`) refuse to run against anything but a local database, so they cannot fill production with dummy accounts.

## Checking a deployment

| Check | Expected |
|---|---|
| `https://<api>.onrender.com/health` | `{"status":"ok"}` |
| `https://<api>.onrender.com/ready` | `"status":"ok"` with `postgresql` ok |
| Render logs at start-up | `CARE QR API listening` with your `publicAppUrl` and `corsOrigins` |
| `https://<web>.vercel.app/login` | the sign-in page; signing in works |
| A printed QR label | opens `https://<web>.vercel.app/q/...` on a phone |

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
| The first request takes about a minute | Render's free plan sleeps after 15 minutes without traffic. A paid instance stays awake. |
| Free database stops working | Render's free PostgreSQL expires after a trial period; upgrade the database plan before going live. |

## Local development is unchanged

`npm run dev` in `services/` and `frontend/` works as before: Vite forwards `/api` to `http://localhost:3001`, so `VITE_API_URL` stays unset locally.
