# How to procure every environment variable

There are **four** things to obtain. Two you generate on your own machine; two
come from a website. Everything else in `.env.example` has a working default.

| # | Variable(s) | Where it comes from | Cost |
|---|---|---|---|
| 1 | `DATABASE_URL` + `DIRECT_URL` | Neon — Vercel integration, or the Connect modal | Free tier |
| 2 | `AUTH_SECRET` | `openssl` on your machine | — |
| 3 | `CRON_SECRET` | `openssl` on your machine | — |
| 4 | `GROQ_API_KEY` | Groq console | Free tier |

---

## 1. Database — `DATABASE_URL` and `DIRECT_URL`

The only mandatory external service. Neon's free tier is enough for an internal
team.

### Option A — let Vercel set it up for you (easiest)

If you are deploying to Vercel, install Neon from the Vercel Marketplace and it
provisions the database *and* writes the environment variables for you:

1. Vercel → **Storage** (or the [Neon listing on the Vercel
   Marketplace](https://vercel.com/marketplace/neon)) → **Install**.
2. Pick region and plan, name the database.
3. **Connect Project** → tick Development, Preview and Production.

It then sets these in your Vercel project automatically:

| Variable it creates | What it is | Maps to |
|---|---|---|
| `DATABASE_URL` | pooled | `DATABASE_URL` — used as-is ✅ |
| `DATABASE_URL_UNPOOLED` | direct | **this app calls it `DIRECT_URL`** ⚠️ |
| `PGHOST`, `PGUSER`, … | components | unused |

> **The one manual step:** Neon names the direct string
> `DATABASE_URL_UNPOOLED`; Prisma's convention (and this app's) is `DIRECT_URL`.
> Copy the value across, or add `DIRECT_URL` in Vercel with the same value.
>
> In practice this only matters on your own machine — `DIRECT_URL` is read by
> the Prisma **CLI** during `migrate`, never by the app at runtime. The deployed
> app only needs `DATABASE_URL`.

### Option B — copy the strings by hand

1. Go to **<https://console.neon.tech>** and sign in with GitHub.
2. **Create a project.** Name it `taskforge`, pick the region closest to your
   team.
3. Click the **Connect** button in the console navigation (it is also on the
   Project Dashboard). This opens the **“Connect to your database”** modal.
4. In the modal, choose your **Branch**, **Compute**, **Database** and **Role**.
   The snippet dropdown defaults to **Connection string** — if it is showing
   `psql`, switch it.
5. The modal has a **Connection pooling** toggle, **on by default**. You need
   the value in *both* positions:

   **Toggle ON** → hostname contains `-pooler` → this is **`DATABASE_URL`**
   ```
   postgresql://neondb_owner:npg_XXXX@ep-cool-darkness-12345678-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
                                                                    ^^^^^^^
   ```

   **Toggle OFF** → no `-pooler` → this is **`DIRECT_URL`**
   ```
   postgresql://neondb_owner:npg_XXXX@ep-cool-darkness-12345678.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

   They are otherwise identical — only the hostname differs.

> **Why two?** The pooled host runs PgBouncer, which is what keeps serverless
> functions from exhausting Neon's connection limit. But schema migrations take
> advisory locks that do not survive transaction pooling, so `prisma migrate`
> needs the direct host. Neon documents this: migrations should use a direct
> connection.
>
> Symptom of getting them the wrong way round: `npx prisma migrate` sits there
> doing nothing. If that happens, check this first.

Make sure both end with `?sslmode=require`.

## 2. `AUTH_SECRET`

Signs and encrypts every session cookie. Generate it:

```bash
openssl rand -base64 32
```

Any 32-byte random string works. Rules:

- **Never commit it.**
- **Use a different value for local and production.**
- **Changing it signs everyone out** — that is the intended emergency lever if
  you ever believe sessions were compromised.

---

## 3. `CRON_SECRET`

Only needed if you use recurring tickets. It is the shared secret guarding
`/api/cron/recurring`, so a stranger cannot trigger ticket generation.

```bash
openssl rand -hex 32
```

Without it the endpoint returns `503` and recurring tickets simply never
generate — nothing else breaks.

---

## 4. `GROQ_API_KEY` — optional, for the AI Copilot

The app runs completely without this. Leave `AI_PROVIDER="none"` and the Copilot
panel explains what to configure instead of erroring.

To enable it:

1. Go to **<https://console.groq.com>** and sign in with Google or GitHub.
2. Left sidebar → **API Keys** → **Create API Key**.
3. Name it `taskforge`, create, and **copy it immediately** — Groq shows the key
   once and never again.
4. Set:
   ```bash
   AI_PROVIDER="groq"
   GROQ_API_KEY="gsk_..."
   GROQ_MODEL="llama-3.3-70b-versatile"
   ```

Groq's free tier is rate-limited but generous; this app makes one request per
Copilot message.

### Or run it locally with Ollama (no key, no cost)

```bash
brew install ollama
ollama serve          # leave running
ollama pull llama3.1  # ~4.7 GB, one time
```

```bash
AI_PROVIDER="ollama"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="llama3.1"
```

> **Ollama cannot work on Vercel.** Serverless functions cannot reach
> `127.0.0.1` on your laptop. Use Ollama for local development and Groq for the
> deployed app — the provider is chosen by an environment variable, so the same
> code runs against either.

---

## 5. The admin account

Not procured from anywhere — you choose it. The seed script creates exactly one
admin from these values, once.

```bash
ADMIN_USERNAME="admin"
ADMIN_EMAIL="you@yourcompany.com"
ADMIN_NAME="Your Name"
ADMIN_PASSWORD="<choose a strong one>"
```

Re-running the seed **never overwrites an existing admin's password**, so it is
safe to run again after editing templates.

---

## Putting it together

```bash
cp .env.example .env
# edit .env with the four values above
npm run db:migrate    # creates the tables
npm run db:seed       # creates roles, templates and your admin
npm run dev
```

Add `SEED_DEMO=true npm run db:seed` to also get a demo workspace to click
around in.

## Checking it worked

```bash
npm run dev > /tmp/tf.log 2>&1 &
npm run smoke -- http://localhost:3000 admin '<your ADMIN_PASSWORD>' /tmp/tf.log
```

That signs in for real, walks every route, and checks the server log for render
errors. It should end with `✅ 26 checks passed`.

## What each failure looks like

| Symptom | Cause |
|---|---|
| `prisma migrate` hangs with no output | `DIRECT_URL` is the pooled host (or is missing) |
| `Environment variable not found: DIRECT_URL` | Neon's integration named it `DATABASE_URL_UNPOOLED` — copy it across |
| `Invalid environment configuration` at boot | A required variable is missing — the error names it |
| Signed out immediately after signing in | `AUTH_SECRET` is unset, or differs between build and runtime |
| `Can't reach database server` | Wrong password in the URL, or `?sslmode=require` is missing |
| `too many connections` | Using the **direct** URL as `DATABASE_URL` |
| Copilot says "not configured" | `AI_PROVIDER` is `none`, or the key is missing |
| Cron returns `503` | `CRON_SECRET` is not set |
