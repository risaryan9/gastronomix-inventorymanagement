# Gastronomix Partners — the FOFO dashboard

The web app franchisees use to order supplies. Design and rules:
[`docs/fofo-dashboard-spec.md`](../docs/fofo-dashboard-spec.md).

**The one rule that shapes this folder:** the app holds **no Supabase key**.
The React code in `src/` never talks to the database. Everything goes through
the serverless functions in `api/`, which hold the keys on the server. The build
fails if a secret ends up in the browser bundle — see `vite.config.js`.

```
partner-frontend/
  api/          serverless functions — Vercel runs every file here as /api/<name>
  api/admin.js  every /api/admin/* route, for the internal app's admin screens
  api/auth.js   every /api/auth/* route, for franchise users (registration so far)
  api/_lib/     shared server code (not routes): database, auth, CORS, email
  src/          the React app (browser)
  vercel.json   sends /api/admin/* and /api/auth/* to their files, page URLs to index.html
```

**Routes that share a function go through one file and a rewrite**, not one
file each: Vercel's free plan allows 12 functions per deployment, and the FOFO
API will need more routes than that. Add a group the same way `admin` is done.

`api/` lives **inside** this folder, not at the repo root, because a Vercel
project only looks for functions inside its own Root Directory.

## Run it locally

```bash
cd partner-frontend
npm install
cp .env.example .env     # fill in, or leave blank for now
npm run dev              # app and /api both on http://localhost:5174
npm run build            # must pass before committing
```

`npm run dev` serves `api/` itself, applying the `/api` rewrites from
`vercel.json`, so no Vercel CLI or login is needed. It runs on **5174** because
the internal app's dev server takes 5173 and its admin screens call this API.

To use the internal app's **Franchise → FOFO Franchises** screen locally, run both dev
servers. The internal app finds this one at `http://localhost:5174` by default,
and `INTERNAL_APP_ORIGINS` here must include `http://localhost:5173`.

## Deploy on Vercel (free `.vercel.app` address)

There is no custom domain yet; the free address Vercel gives the project is
the site for now.

1. **Push this folder to GitHub.**
2. **Vercel → Add New → Project** → import `gastronomix-inventorymanagement`.
3. Before clicking Deploy, set **Root Directory** to `partner-frontend`.
   Framework is detected as Vite; leave build settings as they are.
4. **Deploy.** Vercel gives you an address like
   `https://gastronomix-partners.vercel.app` (you can rename the project to
   choose the name, under Settings → General).
5. **Check it:** open `https://<your-project>.vercel.app/api/health`.
   - JSON with `"ok": true` → working.
   - The React page instead → the rewrite is catching `/api`; check `vercel.json`.
6. **Add the secrets:** Settings → Environment Variables, the names in
   `.env.example`. **No `VITE_` prefix on any of them.** Then Deployments →
   ⋯ → Redeploy — variables only apply to deployments made after they are set.
7. **Check again:** the home page should now show *Server secrets configured*.
8. **Point the internal app at this one:** in the *internal* app's Vercel
   project, set `VITE_PARTNER_API_URL` to this project's production address
   (not secret), and redeploy it. Here, set `INTERNAL_APP_ORIGINS` to the
   internal app's production address.

### Things that behave differently on a `.vercel.app` address

- **Use the production address everywhere**, not a deployment URL. Every push
  also creates a preview address with a random suffix; those change each time.
- **Supabase → Authentication → URL Configuration:** set the production
  `.vercel.app` address as an allowed redirect URL, or invite and reset emails
  will not link back here. Change it when a domain is bought.
- **Razorpay webhook (Phase 4)** points at
  `https://<your-project>.vercel.app/api/orders/webhook`. Also updated when a
  domain is bought.

### Adding a domain later

Settings → Domains → add it → create the CNAME Vercel shows at your domain
provider. Then update the two addresses above. Nothing in the code changes.
