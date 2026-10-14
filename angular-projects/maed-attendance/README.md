# MAEd Attendance — Geo-fenced Attendance Ecosystem

A responsive, glassmorphic web app with four role-based portals:

| Portal | What it does |
|---|---|
| **Student** (mobile-first) | Automated geofence check-in, entry/exit logs, school-premises map, today's classes, attendance-health donut, excuse-note upload, live GPS tracking and a demo location simulator |
| **Subject Teacher** | Subject/time pickers, live roster (in room / out of room → cutting flag / outside campus), one-tap marking, early alert to adviser, weekly attendance trend chart |
| **Adviser** | Safe / Moderate / Critical overview, dropout-risk profiles, teacher alerts inbox, excuse-note approvals, intervention log, communication history with parents, 26-week attendance heatmap |
| **Parent** (mobile-first) | Child tracking card + map, real-time entry/exit timeline, unexcused-absence alerts, adviser message preview, direct messaging, excuse-note submission |

**Stack:** Angular 19 (standalone components, signals) · Leaflet maps · Express · Prisma ORM · MySQL 5.7+/8.

```
maed-attendance/
├── client/   Angular app (proxies /api → http://localhost:4100 in dev)
└── server/   Express API + Prisma schema & seed (prisma/)
```

## Setup

1. **Configure the database** — copy `server/.env.example` to `server/.env` and set `DATABASE_URL`:
   ```
   DATABASE_URL="mysql://USER:PASSWORD@localhost:3306/maed_attendance"
   ```
   The database is created automatically if the user has permission.

2. **Install, create tables, seed demo data**
   ```bash
   npm run install:all
   npm run db:setup
   ```

3. **Run in development** (API on :4100, Angular on :4200)
   ```bash
   npm run dev
   ```
   Open http://localhost:4200.

For a single-port production run: `npm start` builds the Angular app and serves it from the API on :4100.

## Demo accounts

Password for all: `password123` (or tap a role on the login screen)

| Role | Email |
|---|---|
| Student | student@maed.edu |
| Teacher | teacher@maed.edu (Math 10, Science 10) · grace.lim@maed.edu (English, Filipino, AP) |
| Adviser | adviser@maed.edu |
| Parent | parent@maed.edu (Maria Santos) · parent.rivera@maed.edu (Alex Rivera) |

## How the geofence works

- The student's device posts its position to `POST /api/student/location`.
- The server compares it to the school `Geofence` (center + radius, haversine distance).
- Crossing the boundary writes a `GateLog` **ENTRY** or **EXIT**.
- When the student is detected **in the room of the class currently in session** (window: 15 min before start → end), they're marked **PRESENT** automatically (or **LATE** after a 10-minute grace).
- Teachers see students who are on campus but not in the class room as possible **cutting**; flagging it records a `CUTTING` mark and raises an alert to the adviser.

Room detection in a real deployment would come from BLE beacons or Wi-Fi access points; the student portal includes a **demo simulator** (enter room / hallway / leave campus) so the full flow can be shown anywhere. Edit the `Geofence` row (e.g. with `npm run db:studio --prefix server`) to point it at your campus.

## Risk scoring (adviser)

Computed over the last 60 days:

- **Critical** — ≥ 5 unexcused absent days, or cutting rate ≥ 20%, or attendance < 80%
- **Moderate** — ≥ 2 unexcused absent days, or cutting rate ≥ 10%, or attendance < 90%
- **Safe** — otherwise

Approving an excuse note converts that day's `ABSENT` marks to `EXCUSED`.

## Useful scripts

| Command | Where | Purpose |
|---|---|---|
| `npm run db:reset` | root | Drop all tables, recreate, reseed |
| `npm run db:studio` | server | Browse/edit data in Prisma Studio |
| `npm run db:migrate` | server | Create a versioned migration instead of `db push` |
