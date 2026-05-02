# Plummer 🔗

A simple, fast, open-source link shortener powered by **Cloudflare Workers** and **KV**.

Built for [SillyLittleTech](https://sillylittle.tech) at `share.sillylittle.tech`, but designed as a reusable template for anyone who wants to host their own link shortener on Cloudflare's edge network.

---

## Features

| Feature | Details |
|---|---|
| ⚡ Edge-fast redirects | Served from Cloudflare's global network |
| 📊 Click analytics | Per-link click counter in the admin dashboard |
| 🔒 Password protection | Require a password before redirecting |
| ⏰ Link expiry | Set an expiry date/time; expired links are cleaned up automatically |
| 🌙 Dark / light mode | Follows system preference with a manual toggle |
| 🔑 Admin authentication | HTTP Basic Auth secured by a Wrangler secret |

---

## How it works

```
Visitor → share.sillylittle.tech/my-link
        → Cloudflare Worker (nearest edge PoP)
        → KV namespace LINKIVERSE
        → 302 redirect to destination URL
```

Links are stored in a Cloudflare KV namespace as JSON values under the key `link:{slug}`:

```jsonc
{
  "slug":         "my-link",
  "guest":        "https://example.com",
  "passwordHash": null,          // SHA-256 of password, or null
  "expiresAt":    null,          // Unix ms timestamp, or null
  "clicks":       42,
  "createdAt":    1714500000000
}
```

---

## Setup

### 1. Fork this repository

Click **Fork** on GitHub and clone your fork locally.

### 2. Install dependencies

```bash
npm install
```

### 3. Create a Cloudflare KV namespace

```bash
# Production namespace
npx wrangler kv namespace create LINKIVERSE

# Development / preview namespace (used by `wrangler dev`)
npx wrangler kv namespace create LINKIVERSE --preview
```

Copy the `id` values printed by the commands above and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding    = "LINKIVERSE"
id         = "your-production-namespace-id"
preview_id = "your-preview-namespace-id"
```

### 4. Set the admin password secret

The admin dashboard is protected by HTTP Basic Auth. Set the password via Wrangler:

```bash
npx wrangler secret put ADMIN_SECRET
# → Enter your chosen password when prompted
```

When visiting `/admin`, your browser will ask for a username and password.  
Use **any username** and the password you just set.

### 5. (Optional) Configure a custom domain

To use a custom domain (e.g. `share.sillylittle.tech`), uncomment and update the
`[[routes]]` block in `wrangler.toml`:

```toml
[[routes]]
pattern   = "share.sillylittle.tech/*"
zone_name = "sillylittle.tech"
```

The domain must be added to your Cloudflare account and DNS must point to Cloudflare.

### 6. Deploy

```bash
npm run deploy
# or: npx wrangler deploy
```

For local development:

```bash
npm run dev
# or: npx wrangler dev
```

---

## GitHub Actions CI/CD

The included workflow (`.github/workflows/deploy.yml`) automatically deploys to
Cloudflare Workers on every push to `main`.

Add the following **repository secrets** in your GitHub repo settings
(**Settings → Secrets and variables → Actions**):

| Secret | Where to find it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens) — create a token with **Workers: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Dashboard → right-hand sidebar on the Workers overview page |

> **Note:** `ADMIN_SECRET` is stored as a Wrangler secret (step 4 above) and is
> **not** a GitHub Actions secret — Wrangler secrets are separate from GitHub secrets.

---

## Project structure

```
plummer/
├── src/
│   └── index.js          # Cloudflare Worker (all routes + HTML templates inline)
├── .github/
│   └── workflows/
│       └── deploy.yml    # GitHub Actions → Cloudflare Workers
├── wrangler.toml          # Wrangler / Worker configuration
├── package.json
└── README.md
```

---

## API reference

All API routes require HTTP Basic Auth (same credentials as the admin dashboard).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/links` | List all links (JSON array) |
| `POST` | `/api/links` | Create a new link (JSON body) |
| `DELETE` | `/api/links/:slug` | Delete a link |

### Create link — request body

```jsonc
{
  "slug":      "my-link",          // required — letters, numbers, - and _ only
  "guest":     "https://...",      // required — must be http or https
  "expiresAt": 1714600000000,      // optional — Unix ms timestamp (must be future)
  "password":  "secret123"         // optional — plain text; stored as SHA-256 hash
}
```

---

## License

MIT — see [LICENSE](LICENSE).
