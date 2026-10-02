# Deploying Matisan HR

This guide gets the system live on the internet so your team can actually use
it day to day. Total cost to start: **$0/month** (free tiers), two accounts
to create, about 15 minutes.

Two pieces, both on **your own accounts** (not Claude's) so you keep full
ownership and control:

1. **Neon** — hosts the Postgres database.
2. **Render** — hosts the web app (the server, which also serves the built
   client) using the `render.yaml` file already in this repo.

A custom domain (e.g. `hr.matisans.com`) can be attached later once that's
settled with the client — Render gives you a working `*.onrender.com` URL
immediately, with no domain required to start.

## 1. Create the database (Neon)

1. Go to **neon.tech** and sign up (free — no credit card required for the
   free tier).
2. Create a new project, e.g. name it `matisan-hr`.
3. Once created, Neon shows a **connection string** that looks like:
   ```
   postgresql://<user>:<password>@<host>/<database>?sslmode=require
   ```
   Copy it — you'll paste it into Render in the next step.

Why Neon instead of Render's own Postgres: Render's free Postgres tier
auto-deletes the database after 30 days of the plan's expiry, which is a bad
fit for data a real company depends on. Neon's free tier doesn't do this.

## 2. Deploy the app (Render)

1. Go to **render.com** and sign up, connecting your GitHub account.
2. **New → Blueprint**, pick the `Matisan` repo. Render reads `render.yaml`
   in this repo automatically and sets up one web service named `matisan-hr`.
3. Before the first deploy finishes, open the service's **Environment** tab
   and set:
   - `DATABASE_URL` — paste the Neon connection string from step 1.
   - `SEED_ADMIN_EMAIL` *(optional)* — the real admin login email. Defaults
     to `admin@matisans.com` if you skip this.
   - `SEED_ADMIN_PASSWORD` *(optional but recommended)* — a real password.
     Defaults to `Admin@123` if you skip this — **set a real one before
     sharing the link with anyone**.
   - `JWT_SECRET` is generated automatically by Render — nothing to do.
4. Save and deploy. Render runs `npm run build` (builds the React app) then
   `npm run start` (applies the database schema via `db:migrate`, runs the
   seed, and starts the server). Both are safe to run on every future deploy
   — they never touch existing data.
5. When the deploy finishes, Render gives you a URL like
   `https://matisan-hr.onrender.com`. Open it, log in with the admin
   account from step 3, and change the password from the Profile page.

That's it — the system is live. Anyone on the team opens that URL (phone or
desktop) and logs in with the account you create for them in **Users**.

## 3. Day-to-day

- **Deploys:** pushing to the repo's main branch auto-deploys (Render's
  `autoDeploy: true`). No manual steps.
- **Backups:** Neon keeps automatic point-in-time backup/restore on its free
  tier for the last 24 hours; check Neon's dashboard for the exact retention
  on your plan before relying on it for anything older.
- **Free-tier sleep:** Render's free web service plan spins down after 15
  minutes of no traffic and takes ~30–50 seconds to wake up on the next
  request. Fine for internal use; if that delay becomes a problem, Render's
  paid "Starter" plan ($7/mo) keeps it always-on.
- **Custom domain:** once decided with the client, add it under the Render
  service's **Settings → Custom Domains** — no code changes needed.

## Local development vs. production

Nothing above changes how you work locally. `npm run dev` from the repo root
still runs against your local Postgres (see `server/.env` / `.env.example`)
exactly as before. Production (Render) gets its own separate Neon database —
the two never mix.
