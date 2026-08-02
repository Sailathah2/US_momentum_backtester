# Deploying the Momentum Backtest Portal

**Short version:** the website deploys to Vercel in about two minutes. The Python
backend **cannot** run on Vercel as written, and this document explains exactly why
and what to do instead.

---

## Why the backend does not fit Vercel

Vercel runs backend code as **serverless functions**: short-lived, stateless
processes that spin up per request and vanish. This portal was built as a
long-running server that keeps your data in memory. Three specific collisions:

### 1. Sessions live in the server's memory

`app.py` keeps loaded price tables in a `SESSIONS` dictionary. The whole flow
depends on it:

```
scan folder  ->  session_id  ->  backtest (reads the session)  ->  export (reads it again)
```

On Vercel each request may hit a **different instance** with empty memory, so the
backtest would not find the data the scan just loaded. This is not a tuning
problem; the design assumes one process that remembers things.

### 2. It reads folders off your hard disk

`/api/scan-folder` walks a path like `D:\algo_trading\...\data_5y`. There is no
such filesystem on Vercel, and your **41 MB of CSVs are gitignored**, so they are
not in the repository to deploy either.

### 3. Backtests are too heavy for a serverless function

A run over 748 symbols × 1,254 days holds several large pandas frames and takes
seconds. Serverless functions have execution-time and memory ceilings, and
`pandas` + `numpy` + `openpyxl` push against the bundle-size limit too. It may
work; it will not work *reliably*.

---

## Option A — Website on Vercel, backend on a normal host (recommended)

The frontend is a static single-page app and deploys perfectly. Put the Python
server somewhere that supports long-running processes. **Render**, **Railway** and
**Fly.io** all have free tiers and run this unchanged.

### Step 1 — deploy the backend

Point your host at the `backend/` folder with:

- **Build:** `pip install -r requirements.txt`
- **Start:** `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 300 --workers 1`

Three things matter here:

| Setting | Why |
|---|---|
| `--workers 1` | Sessions live in memory. Two workers means two separate memories, and requests landing on the wrong one. |
| `--timeout 300` | A large backtest takes far longer than the 30-second default. |
| `PORT` from the environment | Every host assigns its own port. |

`gunicorn` is not in `requirements.txt` because it is not needed locally — add it
if your host does not provide one.

Set these environment variables:

| Variable | Value | Why |
|---|---|---|
| `PORTAL_SECRET` | a long random string | Signs login tokens. Without it a restart logs everyone out; worse, a shared filesystem could expose the generated key file. |
| `REQUIRE_LOGIN` | `1` | Never expose this without it. |

Generate a secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Step 2 — create your login

Accounts are created on the machine running the backend, not through a sign-up
page. On your host's shell:

```bash
python manage_users.py add yourname
```

It prints a strong password **once**.

### Step 3 — deploy the website to Vercel

```bash
cd frontend
npm i -g vercel
vercel
```

In the Vercel dashboard set **one** environment variable:

| Variable | Value |
|---|---|
| `VITE_API_BASE` | `https://your-backend.onrender.com` |

Then redeploy so the build picks it up (`vercel --prod`). Without it the site will
call `/api` on the Vercel domain, where nothing is listening.

### Step 4 — let the browser talk to the backend

The backend currently allows requests from anywhere (`CORS(app)`). Once it is
public, restrict it to your site by editing `app.py`:

```python
CORS(app, origins=["https://your-site.vercel.app"])
```

### Step 5 — the data

Nothing you have loaded locally exists on the server. Either commit a small sample
CSV set, or upload files through the drag-and-drop box, which works fine remotely.
**Folder scanning will not** — it reads the server's disk, not yours.

---

## Option B — Make it genuinely serverless

Only worth it if you want it entirely on Vercel. It is a rewrite, not a config
change:

- Replace the in-memory `SESSIONS` with **Vercel KV** or **Postgres**.
- Replace folder scanning with uploads to **Vercel Blob**.
- Split the backtest so no single request exceeds the time limit, or move it to a
  background job with polling.
- Trim the Python bundle to fit the function size limit.

Realistically a few days' work, and it makes the local experience worse.

---

## Option C — Keep it local

Worth saying plainly: this is a personal research tool that reads your own files
off your own disk. Running it locally is not a limitation — it is the simplest
correct answer, and it is why the folder-scan feature exists. Deploy only if you
actually need to reach it from another machine.

---

## Before you expose it publicly

- [ ] `REQUIRE_LOGIN=1` and at least one account created
- [ ] `PORTAL_SECRET` set from the environment, not the generated file
- [ ] CORS restricted to your own domain
- [ ] HTTPS everywhere (Vercel and the hosts above do this automatically) — tokens
      travel in a header and must never cross plain HTTP
- [ ] `users.json` and `.secret_key` are gitignored — **check they were never
      committed**
- [ ] You accept that anyone with a login can read whatever data is loaded

### A note on what the login does and does not do

It is a solid front door: PBKDF2-hashed passwords with a per-user salt, signed
expiring tokens, identical replies for a wrong username and a wrong password, and
a five-attempt lockout.

It is **not** multi-tenancy. Every signed-in user shares the same session store and
can see the same loaded data. It is designed to keep strangers out, not to separate
colleagues from each other.
