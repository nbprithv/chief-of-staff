# Aide

A personal Chief of Staff app that consolidates your email digests and calendar into a single, clean dashboard — powered by Google and Claude AI.

---

## Table of Contents

1. [Overview](#overview)
2. [Step 1 — Create a Dedicated Google Account](#step-1--create-a-dedicated-google-account)
3. [Step 2 — Forward Emails to the Aide Account](#step-2--forward-emails-to-the-aide-account)
4. [Step 3 — Link the Google Account to Claude.ai](#step-3--link-the-google-account-to-claudeai)
5. [Step 4 — Create a Google Cloud Project](#step-4--create-a-google-cloud-project)
6. [Step 5 — Configure OAuth Credentials](#step-5--configure-oauth-credentials)
7. [Step 6 — Set Up the Database (Turso)](#step-6--set-up-the-database-turso)
8. [Step 7 — Get an Anthropic API Key](#step-7--get-an-anthropic-api-key)
9. [Step 8 — Configure Environment Variables](#step-8--configure-environment-variables)
10. [Step 9 — Run Locally](#step-9--run-locally)
11. [Step 10 — Deploy to Vercel](#step-10--deploy-to-vercel)
12. [Step 11 — Connect Google in the App](#step-11--connect-google-in-the-app)
13. [CI/CD](#cicd)
14. [Tech Stack](#tech-stack)

---

## Overview

Aide is a self-hosted web app. It runs as a single Fastify server (or a Vercel serverless function in production) backed by a Turso SQLite database. All email and calendar data stays in your own database — nothing is sent to third-party services beyond Google (for data) and Anthropic (for AI summaries).

---

## Step 1 — Create a Dedicated Google Account

Aide works best with a **dedicated Google account** used exclusively for the app. This keeps your primary inbox clean and gives you a clear separation between personal email and Aide's data.

1. Go to [accounts.google.com](https://accounts.google.com) and create a new Google account.
   - Suggested naming convention: `yourname.aide@gmail.com`
2. Sign in to the new account and confirm it is active.

> This account will be the one you connect to Aide via OAuth. All synced Gmail and Calendar data will be read from this account.

---

## Step 2 — Forward Emails to the Aide Account

To populate Aide with email digests from your real accounts, set up forwarding filters in each of your primary Google accounts.

### For each primary Gmail account:

1. Open Gmail and go to **Settings → See all settings → Filters and Blocked Addresses**.
2. Click **Create a new filter**.
3. In the **From** or **Subject** field, enter criteria matching the digests you want to track (e.g. `subject:"Weekly Digest"` or `from:newsletter@example.com`).
4. Click **Create filter**, then check **Forward it to** and enter your new Aide Gmail address.
5. Click **Create filter** to save.

Repeat for each digest or sender you want Aide to track.

> **Tip:** You can also forward from non-Gmail accounts using their built-in forwarding settings, as long as the destination is the Aide Gmail address.

---

## Step 3 — Link the Google Account to Claude.ai

If you use Claude.ai and want your Aide account's Gmail visible in Claude conversations (optional):

1. Go to [claude.ai](https://claude.ai) → **Settings → Integrations**.
2. Click **Connect Google Account** and sign in with the **Aide Google account** (not your primary one).
3. Grant the requested permissions.

This step is optional and only relevant if you use Claude.ai's native Gmail integration alongside this app.

---

## Step 4 — Create a Google Cloud Project

Aide uses Google's OAuth 2.0 to read Gmail and Google Calendar. You need to register it as an app in Google Cloud.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the **Aide Google account**.
2. Click **Select a project → New Project**.
   - Name it `aide` (or anything recognizable).
   - Click **Create**.
3. In the left sidebar, go to **APIs & Services → Library**.
4. Search for and enable both of these APIs:
   - **Gmail API**
   - **Google Calendar API**

---

## Step 5 — Configure OAuth Credentials

### 5a — Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Select **External** and click **Create**.
3. Fill in the required fields:
   - **App name:** `Aide`
   - **User support email:** your Aide Gmail address
   - **Developer contact email:** your Aide Gmail address
4. Click **Save and Continue** through the Scopes screen (you will add scopes next).
5. On the **Test users** screen, add your Aide Gmail address as a test user.
6. Click **Save and Continue**, then **Back to Dashboard**.

### 5b — Add OAuth Scopes

1. Go back to **OAuth consent screen → Edit App → Scopes**.
2. Click **Add or Remove Scopes** and add the following four scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
3. Save and continue.

### 5c — Create OAuth Client ID credentials

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Select **Web application**.
3. Set the **Name** to `Aide`.
4. Under **Authorised redirect URIs**, add:
   - For local development: `http://localhost:3000/integrations/google/callback`
   - For production: `https://<your-vercel-domain>/integrations/google/callback`
     (e.g. `https://aide.vercel.app/integrations/google/callback`)
5. Click **Create**.
6. Copy the **Client ID** and **Client Secret** — you will need these as environment variables.

---

## Step 6 — Set Up the Database (Turso)

Aide uses [Turso](https://turso.tech) for a hosted SQLite database in production. It is free for personal use.

1. Sign up at [turso.tech](https://turso.tech).
2. Install the Turso CLI:
   ```bash
   # macOS
   brew install tursodatabase/tap/turso

   # Linux / WSL
   curl -sSfL https://get.tur.so/install.sh | bash
   ```
3. Authenticate:
   ```bash
   turso auth login
   ```
4. Create a database:
   ```bash
   turso db create aide
   ```
5. Get the database URL:
   ```bash
   turso db show aide --url
   # → libsql://aide-<your-username>.turso.io
   ```
6. Create an auth token:
   ```bash
   turso db tokens create aide
   # → eyJ...
   ```

Save both the URL and the token — you will need them as environment variables.

> For local development only, Turso is not required. The app defaults to a local SQLite file at `./data/assistant.db` when `TURSO_DATABASE_URL` starts with `file:`.

---

## Step 7 — Get an Anthropic API Key

Aide uses Claude to generate email summaries.

1. Go to [console.anthropic.com](https://console.anthropic.com).
2. Navigate to **API Keys → Create Key**.
3. Copy the key — it starts with `sk-ant-`.

---

## Step 8 — Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Then open `.env` and fill in the values:

```env
# ── Server ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=replace-with-a-long-random-string

# ── Anthropic ─────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── Database ──────────────────────────────────────────────────────────────────
# Local SQLite (default for development — no Turso needed):
TURSO_DATABASE_URL=file:./data/assistant.db

# Remote Turso (required for production, optional for local):
# TURSO_DATABASE_URL=libsql://aide-<your-username>.turso.io
# TURSO_AUTH_TOKEN=eyJ...

# ── Google OAuth ──────────────────────────────────────────────────────────────
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:3000/integrations/google/callback
```

---

## Step 9 — Run Locally

### Prerequisites

- Node.js 20 or 22
- npm 10+

### Install dependencies

```bash
npm install
```

### Run database migrations

```bash
npm run db:migrate
```

This creates the local SQLite file at `./data/assistant.db` and applies all schema migrations. Re-run this whenever you pull changes that include new migrations.

### Start the development server

```bash
npm run dev
```

The app will be available at [http://localhost:3000](http://localhost:3000). The server auto-reloads on file changes.

### Other useful commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with auto-reload |
| `npm run dev:debug` | Start dev server with Node inspector attached |
| `npm run db:migrate` | Apply pending migrations to the database |
| `npm run db:generate` | Regenerate SQL migration files from schema changes |
| `npm run db:studio` | Open Drizzle Studio to browse and edit the database |
| `npm test` | Run the full test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Compile TypeScript and run migrations (used by Vercel) |

---

## Step 10 — Deploy to Vercel

### 10a — Install and link the Vercel CLI

```bash
npm install -g vercel
vercel login
vercel link
```

When prompted, link to an existing Vercel project or create a new one. Name it `aide`.

### 10b — Set environment variables in Vercel

In the Vercel dashboard, open your project → **Settings → Environment Variables**. Add each of the following for the **Production** environment:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | A long random string (generate as shown in Step 8) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `TURSO_DATABASE_URL` | `libsql://aide-<your-username>.turso.io` |
| `TURSO_AUTH_TOKEN` | Your Turso auth token |
| `GOOGLE_CLIENT_ID` | Your Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | `https://<your-vercel-domain>/integrations/google/callback` |

> `GOOGLE_REDIRECT_URI` must match exactly one of the authorised redirect URIs you added in Step 5c. If Vercel assigns you a domain like `aide-abc123.vercel.app`, go back to Google Cloud → Credentials and add that URL.

### 10c — Set up GitHub Actions for automated deployment (recommended)

The repository includes a CI/CD workflow at `.github/workflows/ci.yml` that runs the full test suite on every push and deploys to Vercel only when all tests pass.

Add the following secrets to your GitHub repository under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | How to get it |
|---|---|
| `VERCEL_TOKEN` | Vercel dashboard → Account Settings → Tokens → Create |
| `VERCEL_ORG_ID` | Run `cat .vercel/project.json` after linking, or check Vercel → Settings → General |
| `VERCEL_PROJECT_ID` | Same file as above |

Once configured, every push to `master` will run tests on Node 20 and 22 in parallel, then deploy to production if they pass. Vercel's own Git-triggered deploys are disabled (`"ignoreCommand": "exit 0"` in `vercel.json`) so all deployments go through this pipeline.

### 10d — Manual deploy

To deploy immediately without going through CI:

```bash
vercel deploy --prod
```

### 10e — Verify migrations ran on production

Migrations run automatically as part of the Vercel build (`buildCommand` in `vercel.json`). You can confirm by checking the Vercel deployment logs. If you ever need to run them manually against production:

```bash
TURSO_DATABASE_URL=libsql://aide-<your-username>.turso.io \
TURSO_AUTH_TOKEN=eyJ... \
npm run db:migrate
```

---

## Step 11 — Connect Google in the App

Once the app is running (locally or on Vercel):

1. Open the app in your browser and sign in.
2. Navigate to **Google** in the sidebar.
3. Click **Reconnect Google →**.
4. Sign in with the **Aide Google account** created in Step 1.
5. Grant all requested permissions (Gmail read, Calendar read, profile).
6. You will be redirected back to the dashboard with the account connected.
7. Click **↻ Sync** to pull in your first batch of emails and calendar events.

---

## CI/CD

```
push to master
  └── test job (Node 20.x and 22.x in parallel)
        ├── npm ci
        ├── tsc --noEmit  (type check)
        └── vitest --coverage
              └── deploy job (runs only if all test jobs pass)
                    └── vercel deploy --prod
```

Vercel's native Git integration is intentionally disabled so deployments only happen after tests pass.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5 |
| Server | Fastify 4 |
| Database | SQLite via Turso (libsql) |
| ORM | Drizzle ORM |
| AI | Anthropic Claude |
| Auth | Google OAuth 2.0 |
| Frontend | Vanilla JS (ES modules) |
| Hosting | Vercel (serverless) |
| CI/CD | GitHub Actions |
| Tests | Vitest |
