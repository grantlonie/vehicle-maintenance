# Vehicles

Self-hosted multi-vehicle maintenance tracker: seasonal + odometer/calendar reminders, service/repair logs with performer and USD costs (CAD→USD on entry), attachments, and owner export.

Hostname: `vehicles.grantlonie.com`

## Stack

| Layer | Tech |
|-------|------|
| Monorepo | Bun workspaces |
| API | Hono on Bun, Drizzle, SQLite in `DATA_ROOT` |
| Shared | Zod schemas, due engine, unit helpers (`@vehicles/shared`) |
| Web | React 19, Vite, Tailwind, TanStack Query |
| Auth | `APP_TOKEN` bearer / query token |
| Deploy | Docker Compose → `personal-infra-shared`, Caddy |

## Layout

```text
apps/api/           API + SQLite + files + export
apps/web/           SPA
packages/shared/    Shared types and due logic
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

## Features

- Multiple vehicles with photos, mi/km display, archive
- Recurring schedules: year-round / season / custom months; interval or once-per-season
- Unified service + repair logs (self/shop, cost in USD, CAD convert, attachments)
- In-app due / soon / overdue / inactive
- Schedule templates
- Export zip: `history.pdf`, `vehicle.json`, `vehicle-image.*`, `attachments/`
