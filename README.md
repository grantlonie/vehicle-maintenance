# Vehicles

Self-hosted multi-vehicle maintenance tracker: seasonal + odometer/calendar reminders, service/repair logs with performer and USD costs (CAD→USD on entry), attachments, and owner export.

Hostname: `vehicles.grantlonie.com`

## Stack

| Layer    | Tech                                                       |
| -------- | ---------------------------------------------------------- |
| Monorepo | Bun workspaces                                             |
| API      | Hono on Bun, Drizzle, SQLite in `DATA_ROOT`                |
| Shared   | Zod schemas, due engine, unit helpers (`@vehicles/shared`) |
| Web      | React 19, Vite, Tailwind, TanStack Query                   |
| Auth     | `APP_TOKEN` bearer / query token                           |
| Deploy   | Docker Compose → `personal-infra-shared`, Caddy            |

## Layout

```text
apps/api/           API + SQLite + files + export
apps/web/           SPA
packages/shared/    Shared types and due logic
data/               Local SQLite + images + attachments (gitignored)
deploy/personal-infra/
```

## Local development

```bash
cp .env.example .env
# set APP_TOKEN
bun install
bun test
bun run dev
```

- API: http://127.0.0.1:3002
- Web (Vite proxy): http://127.0.0.1:5174

Unlock the UI with the same `APP_TOKEN`.

## Production (personal-infra)

1. DNS `A` record for `vehicles.grantlonie.com`
2. Add Caddy block from [deploy/personal-infra/Caddyfile.example](deploy/personal-infra/Caddyfile.example)
3. Clone to `/srv/apps/vehicles`, create `data/`, copy `.env` with `APP_TOKEN`
4. `docker compose up -d --build`
5. Optional: GitHub Actions secrets + [.github/workflows/deploy.yml](.github/workflows/deploy.yml)

Data lives in `/srv/apps/vehicles/data` (SQLite + images + attachments) and is covered by personal-infra Restic backups. Outbound HTTPS is required for Frankfurter CAD→USD rates.

## Email notifications

Optional weekly Gmail digest for schedules due within 7 days (or overdue) and vehicles with no odometer reading in 90+ days.

1. Create a [Gmail App Password](https://support.google.com/accounts/answer/185833) for the sending account
2. Set in `.env` (and restart the container):

```bash
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
# optional:
NOTIFY_TO=you@gmail.com          # defaults to SMTP_USER
NOTIFY_HOUR_UTC=14               # default 14 ≈ 8am Mountain
```

If `SMTP_USER` / `SMTP_PASS` are unset, notifications stay disabled. At most one digest per week is sent (state in `DATA_ROOT/notify-state.json`). Quiet weeks send nothing.

Force a run (same `APP_TOKEN` auth):

```bash
curl -X POST -H "Authorization: Bearer $APP_TOKEN" http://127.0.0.1:3002/api/notify/run
```

## Features

- Multiple vehicles with photos, mi/km display, archive
- Recurring schedules: year-round or seasonal (one or more seasons); interval or once-per-season
- Unified service + repair logs (self/shop, cost in USD, CAD convert, attachments)
- In-app due / soon / overdue / inactive
- Weekly email digest (Gmail) for upcoming due items and stale odometer
- Copy schedules from an existing vehicle when adding a new one
- Export zip: `history.pdf`, `vehicle.json`, `vehicle-image.*`, `attachments/`

## Spreadsheet import

To re-seed from the Google Sheets export mapping used for the first vehicle:

```bash
bun scripts/importSpreadsheet.ts
```

Requires the API on `:3002` and `APP_TOKEN` matching `.env`. Archives existing active vehicles first.
