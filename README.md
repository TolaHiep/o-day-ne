# Ở Đây Nè — quẹt là thấy nhà 🏠💚

Tinder-style room rental discovery for Hà Nội. Anonymous visitors land
directly on the swipe deck; login is only required when they need to **save**,
**review**, **report**, **contribute photos**, **post listings**, or do **owner /
admin actions**. Same login popup is shared across all roles (seeker, landlord,
admin) — role is inferred from the account.

- **Frontend:** React + Vite + TypeScript + Tailwind, custom postcard/"hợp gu"
  brand. Mobile (full-screen swipe), tablet (deck + shortlist), desktop
  (3-panel: filters / deck / shortlist).
- **Backend:** native `node:http` REST API on SQLite via `better-sqlite3`
  (WAL, FK, mmap). No external paid services.
- **Auth:** provider-style. Real Google OAuth if `GOOGLE_CLIENT_ID/SECRET` are
  configured; otherwise a demo provider (clearly labelled "Chế độ xem trước"
  in the UI) so you can preview every flow locally.
- **Docker:** single image runs both api + web on one port via a tiny
  supervisor. `BIND_HOST=0.0.0.0` inside the container so the Docker port
  proxy reaches it.

## Project layout

```
o-day-ne/
├── frontend/                 React + Vite + Tailwind UI
│   ├── src/                    components, pages, lib, types
│   ├── public/                 static assets served as-is
│   ├── index.html              Vite entry
│   ├── vite.config.ts          root = ./frontend, outDir = ../dist
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── tsconfig.app.json       app code (DOM lib)
│   └── tsconfig.node.json      vite.config.ts (Node lib)
│
├── backend/                  Native Node http API + SQLite
│   ├── src/
│   │   ├── api.mjs             REST handlers + routes
│   │   ├── storage.mjs         SQLite schema, prepared stmts, seed
│   │   ├── web.mjs             static dist + /api proxy
│   │   └── docker-entry.mjs    supervisor spawning api + web
│   ├── scripts/
│   │   └── db.mjs              backup / list / restore / vacuum CLI
│   ├── tests/
│   │   └── api.test.mjs        node:test integration suite
│   └── data/                   SQLite db + backups + uploads (gitignored)
│
├── docs/
│   ├── DEPLOY.md               production checklist
│   └── DESIGN_BRIEF.md         brand + UX brief for designer handoff
│
├── docker-compose.yml        one-container deploy
├── Dockerfile                multi-stage (builder → runtime)
├── tsconfig.json             root references frontend tsconfigs
├── package.json              single root, no workspaces
└── .env.example              every env var documented
```

Single `package.json` at root, no workspaces — keeps deps + lockfile + scripts
in one place. Frontend and backend share `node_modules/`.

## Local quick start

```bash
npm install

# Two terminals:
npm run dev:api   # backend API → http://127.0.0.1:8788
npm run dev       # Vite dev    → http://127.0.0.1:5174 (proxies /api → :8788)
```

Open <http://127.0.0.1:5174>. You'll land on the swipe deck with 18 seeded
Hanoi rooms.

### Built preview (production-style, one process)

```bash
npm install
npm run build                       # → ./dist
node backend/src/api.mjs &          # API   on :8788
PORT=4174 node backend/src/web.mjs  # Static dist + proxy on :4174
# → http://127.0.0.1:4174
```

`npm run start` (used inside Docker) supervises both via
`backend/src/docker-entry.mjs`.

## Docker

```bash
docker compose up -d --build
# Wait ~10s for healthcheck, then:
curl -fsS http://127.0.0.1:4174/healthz       # → "ok"
curl -fsS http://127.0.0.1:4174/api/health    # → {"ok":true,...}
```

Open <http://127.0.0.1:4174>.

The SQLite database lives in the `odn-data` named volume mounted at
`/app/backend/data/db.sqlite`. Backups are written to
`/app/backend/data/backups/` every `BACKUP_INTERVAL_MIN` minutes (default 360).

## Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4174` (`5174` in dev) | Public web port |
| `API_PORT` | `8788` | Internal API port |
| `BIND_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Web tier bind host. Inside Docker this must be `0.0.0.0`. |
| `PUBLIC_URL` | unset | Locks CORS + CSP `connect-src` in production. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | unset | When all three are set, real Google OAuth replaces the demo provider. |
| `ALLOW_DEMO_AUTH` | `true` | Set to `false` once real OAuth is wired to disable the demo provider. |
| `ADMIN_TOKEN` | unset | Optional shared secret for `/api/admin/*` (recovery channel — bypasses session). Send via `X-Admin-Token` header. |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | unset | When all three are set, uploads bypass the VPS and go directly to Cloudinary. See [docs/DEPLOY.md §3C](./docs/DEPLOY.md). |
| `CLOUDINARY_UPLOAD_FOLDER` | `odayne/rooms` | Folder inside your Cloudinary account where files land. |
| `BACKUP_INTERVAL_MIN` | `360` | SQLite backup cadence (minutes, set `0` to disable). |
| `BACKUP_KEEP` | `10` | How many backup snapshots to keep. |
| `ODN_DATA_DIR` | `./backend/data` | Where SQLite lives. Tests use a temp dir via this. |

Copy `.env.example` to `.env` and tweak — never commit a real `.env`.

## Accounts

- Seeded admin: `admin@odayne.local` — log in via the popup using **any**
  provider button (they share the email → upsert). The seed gives the account
  `is_admin = 1` automatically.
- Any other email you type becomes a fresh seeker. Pick "Chủ trọ" tab in the
  popup to be created as a landlord (or post a listing and the API auto-promotes
  you from seeker to landlord).

## Real Google OAuth (optional)

1. Create OAuth Client ID (type: Web) in Google Cloud Console.
2. Add `http://localhost:4174` (and your production origin) to **Authorized
   JavaScript origins**.
3. Add `http://localhost:4174/` (and prod equivalent) to **Authorized redirect
   URIs**.
4. Export env vars before starting Docker/Node:

   ```bash
   export GOOGLE_CLIENT_ID="…"
   export GOOGLE_CLIENT_SECRET="…"
   export GOOGLE_REDIRECT_URI="http://localhost:4174/"
   docker compose up -d --build
   ```

The login popup will swap the demo provider for a "Tiếp tục với Google (thật)"
button; the API exchanges the code server-side at `/api/auth/google/callback`.

## NPM scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server (`:5174`) — proxies `/api` to `:8788` |
| `npm run dev:api` | Run the backend API (`:8788`) for dev |
| `npm run build` | Type-check (`tsc -b`) + Vite production build to `./dist` |
| `npm run preview` | Vite preview of the built bundle |
| `npm run api` | Run the API in built mode |
| `npm run serve` | Serve `./dist` + proxy `/api` (web tier alone) |
| `npm run start` | Container supervisor (api + web together) |
| `npm run lint` | `tsc -b --noEmit` — type check only |
| `npm test` | Boots a fresh SQLite + API child and runs the integration suite |
| `npm run db:backup` | Take an online SQLite snapshot into `backend/data/backups/` |
| `npm run db:list` | List existing backups with size + mtime |
| `npm run db:restore <file>` | Replace live DB with a backup (API must be stopped, takes a safety snapshot first) |
| `npm run db:vacuum` | `VACUUM + ANALYZE` (API must be stopped) |

## Production deployment

See **[docs/DEPLOY.md](./docs/DEPLOY.md)** for the full production checklist:
TLS via Caddy / Cloudflare Tunnel, off-machine SQLite backup, update + restore
flow, hardening checklist before opening to real users.

## Test checklist (manual)

- [ ] Open `/` anonymously → see swipe deck with seed rooms, no login wall.
- [ ] Click "Bộ lọc" (mobile) or use left panel (desktop) → filters refine deck instantly.
- [ ] Swipe left or click ✕ → card flies off, next card slides in. Refresh — that room stays gone (anon local pass).
- [ ] Swipe right or click 💚 → login popup appears (anon). Sign in → swipe right again → ✓ saved.
- [ ] Open a card → photo gallery, amenities, contributed photos section, reviews, contact phone (hidden by default).
- [ ] "Báo cáo" without login → popup; with login → form opens, 409 on second submit (dedupe).
- [ ] "Đóng góp ảnh" → submit URL → card marked "Chờ duyệt", visible only to me + admin.
- [ ] `/post` → form validates required fields, posts a room, account promotes to landlord.
- [ ] `/owner` → my rooms list, can edit / close / reopen / share a listing.
- [ ] `/admin` (log in as `admin@odayne.local`) → stats tab, hide/feature/verify/delete rooms, resolve reports, approve photos, suspend users.
- [ ] `/profile`, `/inbox`, `/about` → new pages render and link from header / footer.
- [ ] Resize browser to mobile width → header collapses, bottom tabs visible, card fills width.

## Image uploads

The post form accepts three modes — they all funnel into the same `images`
array on the room record:

1. **Chọn nhiều ảnh** — `<input type="file" accept="image/*" multiple>` opens
   the OS picker / iOS Photos. Multi-select with Ctrl/Shift/long-press.
   Each file uploads in parallel with its own progress row.
2. **Chụp ảnh mới** — same input with `capture="environment"` so phones jump
   straight to the rear camera. Desktop browsers ignore `capture` and show the
   file picker either way.
3. **Dán URL** — kept for screenshots, social-media links, anything not on
   disk.

Plus a **drag-and-drop dropzone** on desktop that wraps the three buttons.

### Storage backend — local or Cloudinary

The frontend probes `/api/uploads/config` once per session. The backend
returns one of two providers:

- **`local`** (default) — `POST /api/uploads` accepts the file as a raw
  binary body (no multipart parser server-side, keeps server parsing to a
  Buffer concat). Stored under `backend/data/uploads/<random-hex>.<ext>` with
  random filenames so URLs are content-immutable (`Cache-Control: immutable`).
  Magic-byte sniff refuses files whose claimed Content-Type doesn't match
  their header bytes.
- **`cloudinary`** (when `CLOUDINARY_CLOUD_NAME` + `_API_KEY` + `_API_SECRET`
  are set) — frontend asks `/api/uploads/cloudinary-sign` for a short-lived
  signature, then POSTs the file directly to Cloudinary's edge. File never
  touches our VPS. Auto-converts HEIC, serves `f_auto`/`q_auto` WebP/AVIF.
  Free tier: 25 GB storage + 25 GB bandwidth/month. See
  [docs/DEPLOY.md §3C](./docs/DEPLOY.md) for setup.

Common constraints in both modes:

- Whitelist: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif`.
  HEIC/HEIF is rejected client-side in local mode (with a friendly hint to
  switch iPhone Camera setting); in Cloudinary mode it's auto-converted.
- Max **8 MB** per file (`UPLOAD_MAX_BYTES`).
- The web tier proxies `/uploads/*` to the API (single owner of the data dir).
  Vite's dev server proxies it too. Cloudinary URLs (`res.cloudinary.com/...`)
  are served directly by Cloudinary's CDN — no proxy.

## Known caveats

- The "Match score" is a lightweight rule-based heuristic (not ML). It boosts
  rooms that match the active filter and verified/featured flags.
- No paid map provider — detail page shows OSM permalink + cute compass card.
- Demo provider is allowed by default in production (`ALLOW_DEMO_AUTH=true`)
  so the live preview keeps working without OAuth setup. Set to `false` once
  you wire real OAuth.
- SQLite native module (`better-sqlite3`) requires either a prebuilt binary
  for your platform/Node combo, or a working C++ toolchain at `npm install`
  time. Docker handles this in the builder stage; local installs on Windows
  may need build tools if a prebuilt isn't available.
