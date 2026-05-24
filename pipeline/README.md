# Ở Đây Nè — data pipeline

Stand-alone ingestion pipeline for rental listings. It lives outside
`frontend/` and `backend/` on purpose: it has its own runtime, its own data
shape, and changes here must never block the swipe UI from deploying.

The pipeline pulls candidate listings from three sources and emits review
JSON files that a human (or, later, an admin tool) approves before anything
is written to the app's SQLite database.

```
pipeline/
├── README.md                you are here
├── config.example.json      review thresholds + live-mode placeholders
├── lib/
│   ├── contract.mjs         candidate shape + validator
│   ├── normalize.mjs        Vietnamese rental-text heuristics
│   ├── dedupe.mjs           duplicate-key + grouping
│   ├── csv.mjs              dependency-free CSV parser
│   ├── xlsx.mjs             dependency-free XLSX reader (keeps hyperlinks)
│   └── sheet-row-mapper.mjs sheet row → room shape, dedupe key, notes
├── sources/
│   ├── sheet-drive.mjs      Google Sheet rows + Drive image links
│   ├── zalo-forward.mjs     Forwarded/exported Zalo group messages
│   └── facebook-group.mjs   FB group posts (Graph export / pasted JSON)
├── scripts/
│   ├── import.mjs           CLI runner for review-JSON sources
│   └── sync-sheet-to-db.mjs live Google Sheet → backend/data/db.sqlite
├── samples/                 small, safe inputs for every source
└── out/                     review JSONs + downloaded xlsx (gitignored)
```

## Why a separate folder

- The pipeline boots independently — no SQLite, no Vite, no Tailwind.
- Connectors evolve faster than the UI; we don't want a Drive API outage
  to block a `npm run build`.
- It's a deliberate cordon between "data we trust" (the app's DB) and
  "data we haven't reviewed yet" (anything from a Zalo/FB group post).

## Runtime

- Node ESM, same Node 20 runtime as the rest of the project.
- No new dependencies. Everything uses `node:*` built-ins plus our own
  helpers in `pipeline/lib/`.
- Works on the host. The Docker image also bundles `pipeline/` so the
  live-sheet sync (`scripts/sync-sheet-to-db.mjs`) can be invoked via
  `docker compose exec` and write into the container's `odn-data` volume.
  The other connectors are still operator-driven on the host: collect an
  export locally, run the CLI, feed the review JSON to the admin.

## Quick start

```bash
# dry-run against each bundled sample
npm run pipeline:dry-run:sheet
npm run pipeline:dry-run:zalo
npm run pipeline:dry-run:fb

# or call the CLI directly
node pipeline/scripts/import.mjs \
  --source sheet-drive \
  --file pipeline/samples/sheet-drive.json \
  --pretty
```

Default mode is dry-run — the CLI prints a summary and the first three
parsed candidates. Add `--write` (timestamped output) or `--out <path>` to
emit the full review JSON to disk.

```bash
# write a full review file
node pipeline/scripts/import.mjs \
  --source zalo-forward \
  --file pipeline/samples/zalo-forward.json \
  --write
# → pipeline/out/zalo-forward-2026-05-21T....json
```

CLI flags:

| flag             | what it does                                                |
|------------------|-------------------------------------------------------------|
| `--source <n>`   | `sheet-drive` \| `zalo-forward` \| `facebook-group`         |
| `--file <path>`  | local CSV / JSON / TXT input (see each connector below)     |
| `--out <path>`   | write review JSON to this exact path                        |
| `--write`        | write to `pipeline/out/<source>-<ISO>.json`                 |
| `--dry-run`      | force dry-run even if `--out`/`--write` is set              |
| `--limit <n>`    | cap records processed                                       |
| `--pretty`       | pretty-print the dry-run summary on stdout                  |

## Data contract

Every connector returns records that match this shape (see
`lib/contract.mjs` for the validator):

```ts
{
  source:       'sheet-drive' | 'zalo-forward' | 'facebook-group',
  sourceId:     string,                  // stable id within the source
  sourceUrl:    string | null,           // link back to the post if known
  rawText:      string,                  // verbatim text we parsed
  title:        string | null,
  priceVnd:     number | null,
  areaM2:       number | null,
  district:     string | null,           // matched against Hà Nội district list
  address:      string | null,
  phone:        string | null,           // 0XXXXXXXXX, normalized
  images:       string[],                // image URLs (Drive rewritten to uc?)
  amenities:    string[],                // backend amenity keys
  postedAt:     number | null,           // epoch ms
  confidence:   number,                  // 0..1, average of signal hits
  status:       'review' | 'duplicate' | 'approved' | 'rejected',
  duplicateKey: string,                  // phone+title or text hash
  notes:        string[]                 // parser warnings ("no-price", …)
}
```

`status` is always `review` when the pipeline outputs it. The reviewer
(or a future approve script) flips it to `approved`/`rejected` and, only
then, the record is allowed to become a row in `rooms` (see
`backend/src/storage.mjs`).

## Source notes

### sheet-drive

- Local input: `.csv` or `.json` export of a Google Sheet.
- Drive URLs in any column get rewritten to
  `https://drive.google.com/uc?export=view&id=<ID>` so the app can render
  them without re-resolving the redirect.
- Column names are flexible — see `pipeline/sources/sheet-drive.mjs` for
  the accepted aliases (Vietnamese + English).
- Live-mode wiring: Sheets API v4 + a service account with read-only
  access to the sheet, plus Drive API to fetch thumbnails. Drop a real
  caller into `readLocal()` and the rest of the pipeline doesn't change.

### zalo-forward

- Zalo has **no first-party group-chat API for third parties.** Don't
  scrape Zalo Web — it violates ToS and the session cookies break weekly.
- Realistic operator workflow:
  1. Operator runs a "collector" Zalo account that the group admins
     forward listings to.
  2. The collector account exports its chat (.txt) periodically.
  3. We ingest that .txt with this connector.
- Local input: `.txt` (blank-line / `---` / `===` separated message
  blocks) or `.json` with `{ id?, author?, text, ts? }` records.

### facebook-group

- Local input: `.json` array of post objects.
- Live mode is only realistic for groups the operator administers (Meta
  Graph API requires app installation in the target group). For groups
  we don't own, the legitimate path is asking the group admin to share
  an export.
- **We do not browser-scrape facebook.com.** It's against Meta ToS, the
  selectors change weekly, and accounts get banned.

## Vietnamese text parsing — what we look for

`lib/normalize.mjs` recognises:

- **Price**: `3.5 triệu`, `3tr5`, `3500k`, `5.000.000đ`, etc.
- **Area**: `25m2`, `25 m²`, `diện tích 25m2`.
- **Phone**: 10-digit `0…` numbers, `+84` prefix, any separators.
- **District**: matched against the full Hà Nội list (longest-first so
  "Bắc Từ Liêm" wins over "Từ Liêm").
- **Address line**: first line containing `ngõ / ngách / hẻm / phố /
  đường / khu / tòa / kđt`.
- **Drive URLs** in any of `/file/d/{id}/view`, `?id={id}`, `uc?id={id}`.
- **Amenities** keywords (`điều hoà → ac`, `wc riêng / khép kín →
  private_wc`, `ban công → balcony`, `thang máy → elevator`, `máy giặt
  → washer`, `máy sấy → dryer`, `bếp → kitchen`, `gửi xe → parking`,
  `camera → security_cam`, `pet ok → pet_ok`, `nội thất → furnished`,
  `tự do giờ giấc → curfew_free`, `pccc → fire_safety`).

It is intentionally regex-based and conservative — false negatives are
fine because every record passes through review.

## Dedupe

Each record gets a `duplicateKey`:

- If phone is present: `phone:<digits>:<short-hash-of-title>`.
- Otherwise: `text:<short-hash-of(address+title+raw[:200])>`.

The CLI runs `groupByDuplicateKey()` and marks repeats as
`status: 'duplicate'` with a `dup-of:<sourceId>` note, so reviewers see
the relationship instead of just the survivor.

## Live Google Sheet sync

`scripts/sync-sheet-to-db.mjs` is the one connector that writes directly to
SQLite — it downloads the public sheet as `.xlsx`, keeps the Drive
hyperlinks in `Ảnh phòng`, filters to `Tình trạng = "Còn trống"`, and
upserts rooms via `pipeline_source_map` so repeated runs are idempotent.

```bash
# host dry-run (writes a host db.sqlite if not careful — keep --write off)
npm run pipeline:sheet:dry-run

# write into the running container's odn-data volume
docker compose exec web \
  node pipeline/scripts/sync-sheet-to-db.mjs \
    --sheet-url 'https://docs.google.com/spreadsheets/d/<id>/edit?gid=0' \
    --write
```

The script needs no extracted xlsx folders — `lib/xlsx.mjs` reads ZIP
entries directly out of `pipeline/out/sheet-live.xlsx`.

## Safety

- **No secrets** in this folder. `config.example.json` carries only
  placeholders. The real config lives at `pipeline/config.json` (added to
  `.gitignore`).
- **DB writes are opt-in.** The legacy `import.mjs` runner never opens
  `backend/data/db.sqlite`; only `sync-sheet-to-db.mjs --write` does, and
  only when explicitly invoked.
- **No live scraping.** Every connector reads local files today. Live
  callers will be added in separate PRs with explicit auth wiring.

## What's next

- A small admin page in the app that imports a reviewed JSON and creates
  rooms (mapping `priceVnd / areaM2 / district / address → addressHint /
  contactPhone / images → images_json` etc., using `rooms.insert` from
  `backend/src/storage.mjs`).
- A Google Sheets live caller behind a service-account JSON.
- A Zalo collector spec + the JSON export schema we expect from the
  on-device companion.
