# AICSS: Attendance-Informed Competency Support System

A web app that links **daily attendance** with **competency mastery** and **assessment results**, then raises **instructional alerts** with recommended interventions. Two roles: **Teacher** and **Administrator**.

**Stack:** Angular 19 (standalone components, signals) · Express · Prisma ORM · MySQL 5.7+/8.
Forked from `maed-attendance`; it reuses that app's auth, API and Prisma setup with a new domain model and UI.

```
maed-aicss/
├── client/   Angular app (dev server :4210, proxies /api → http://localhost:4110)
└── server/   Express API + Prisma schema & seed (prisma/)
```

## Modules

| Module | What it does |
|---|---|
| **Dashboard** | Enrolment and average attendance (with trend vs the previous 20 school days), weekly/monthly attendance charts, competency progress by learning area, top instructional alerts, learner monitoring table with recommended actions (CSV export). Admins also see system activity and user/section counts. |
| **Attendance** | Daily time record **per class period**: pick a date and a period (subject, time, room, teacher), then mark each learner Present / Late / Absent / Excused with **time in** and remarks. Late is automatic past the grace period. Also: attendance trend, summary ring, daily records (incl. learners who missed periods) and monthly summaries. |
| **Competencies** | Mastery % per learning area and competency, On Track / Monitor / Needs Support breakdown, target coverage, per-learner learning gaps. |
| **Assessment Records** | Create quizzes, performance tasks and exams aligned to a competency; enter scores per learner; overall average, change vs previous quarter, performance distribution. |
| **Instructional Alerts** | High / Medium / Low alerts generated from the data, with recommended interventions and a follow-up log (Followed up → Resolved). |
| **Reports** | **Daily Time Record (DTR)** per section and date (time in for every period, with subject, time and room), SF2-inspired daily attendance grid, attendance summary (monthly or school year, with weekly rates), competency, assessment, learner performance, alerts and consolidated reports. Preview, **CSV/Excel** download, or **Print / Save as PDF**. |
| **Learners** | Directory with search and filters; learner profile with attendance history, competency mastery, assessment results and alerts. Admins add, edit and archive learners. |
| **Settings** | School configuration (name, ID, division, academic year, quarter), monitoring preferences and thresholds, sections with their allocated room and weekly class schedule, personal account and password. Teachers also see their own teaching schedule here. |
| **User Management** *(admin)* | Create, edit, deactivate accounts; reset passwords; role permission matrix. |
| **System Logs** *(admin)* | Searchable activity history (sign-ins, records saved, reports generated, settings changes). |

### Role permissions

| Module | Teacher | Administrator |
|---|---|---|
| Dashboard | View (assigned sections) | View all school data |
| Attendance | Record, view, edit | View, manage, correct |
| Competencies | View, update | Manage and monitor (incl. delete) |
| Assessment Records | Record, view, edit (own sections) | View and manage |
| Instructional Alerts | View, monitor, follow up | View and monitor |
| Reports | Generate, view (own sections) | Generate all reports |
| Learners | View assigned learners | Add, edit, archive |
| Settings | Limited personal settings | Full access |
| User Management | – | Create, edit, deactivate accounts |
| System Logs | – | View activity history |

Teachers see only the sections assigned to them (Settings → Sections). Scoping is enforced by the API, not just the UI.

## Setup

1. **Create the database.** The app uses its own database, `maed_aicss`. If the MySQL user in `server/.env` can't create databases, run this once as root:
   ```sql
   CREATE DATABASE maed_aicss CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   GRANT ALL PRIVILEGES ON maed_aicss.* TO 'maed'@'localhost';
   FLUSH PRIVILEGES;
   ```
   Then copy `server/.env.example` to `server/.env` (if you haven't already) and set `DATABASE_URL`.

2. **Install, create tables, seed demo data**
   ```bash
   npm run install:all
   npm run db:setup
   ```

3. **Run in development** (API on :4110, Angular on :4210)
   ```bash
   npm run dev
   ```
   Open http://localhost:4210.

For a single-port production run: `npm start` builds the Angular app and serves it from the API on :4110.

## Demo accounts

Password for all: `password123` (or use **Continue as Teacher / Admin** on the login page)

| Role | Email | Notes |
|---|---|---|
| Administrator | admin@aicss.edu | Antonio Reyes |
| Teacher | teacher@aicss.edu | Maria Santos: adviser of Grade 11 – STEM A; teaches Effective Communication to all sections |
| Teacher | juan.delacruz@aicss.edu · paolo.garcia@aicss.edu · liza.tan@aicss.edu · rosa.mendoza@aicss.edu · teresa.aquino@aicss.edu | Advisers of the other five sections (see table below) |
| Teacher | ramon.villanueva@ · carmela.bautista@ · jerome.castillo@ · elena.navarro@ · victor.ramos@aicss.edu | Elective teachers (Physics, Creative Composition, Programming, Chemistry, Accounting) |
| Teacher | grace.lim@aicss.edu | Deactivated (shows the inactive-account flow) |

The seed creates 174 learners across 6 sections, daily attendance from June 15 to today, 27 competencies across the 5 core subjects and the 6 electives in use, and quizzes, performance tasks and a Q1 exam with scores.

## Subjects

The **Subjects** catalog (`Subject` table, *Settings → Subjects*) lists every subject with its type and usual room:

| Type | Subjects |
|---|---|
| Core (every section) | General Mathematics · General Science · Effective Communication / Mabisang Komunikasyon · Life and Career Skills · Pag-aaral ng Kasaysayan |
| Elective, TechPro | SMAW · Programming · Visual Graphic Design · Agricultural Crop Production · Bakery Operation · Kitchen Operation · Food and Beverage Services · EIM |
| Elective, Academic | Physics · Finite Mathematics · Chemistry · Creative Composition · Accounting |
| Program | ARAL Program |

Each section takes the 5 core subjects plus **one elective (its specialization)**. Competencies are grouped by subject, and teachers only see the core subjects plus their sections' electives.

## Sections, rooms and class schedules

Each **section** has an allocated room (advisory / homeroom), an elective, and a weekly **class schedule** (`ClassSchedule` table): one row per class meeting with the day (Mon–Sat), start and end time (`HH:mm`), subject, subject teacher and room.

| Section | Room | Elective (room) | Adviser |
|---|---|---|---|
| Grade 11 – STEM A | Room 201 | Physics (Physics Laboratory) | Maria Santos |
| Grade 11 – HUMSS A | Room 202 | Creative Composition (Room 202) | Juan Dela Cruz |
| Grade 11 – TVL ICT A | Room 203 | Programming (ICT Laboratory) | Paolo Garcia |
| Grade 12 – STEM A | Room 301 | Chemistry (Chemistry Laboratory) | Liza Tan |
| Grade 12 – ABM A | Room 302 | Accounting (Room 302) | Rosa Mendoza |
| Grade 12 – TVL HE A | Room 303 | Bakery Operation (Bakery Laboratory) | Teresa Aquino |

**Bell schedule (Monday–Friday)**

| Time | Period |
|---|---|
| 7:30 – 8:30 AM | 1st subject |
| 8:30 – 9:30 AM | 2nd subject |
| 9:30 – 9:45 AM | Recess |
| 9:45 – 10:45 AM | 3rd subject |
| 10:45 – 11:45 AM | 4th subject |
| 11:45 AM – 12:30 PM | Lunch |
| 12:30 – 1:30 PM | ARAL Program (with the section adviser, in the section's room) |
| 1:30 – 2:30 PM | 5th subject |
| 2:30 – 3:30 PM | 6th subject |

The 6 subjects fill the 6 subject periods every day. The order is rotated by section and by day, so no two sections ever have the same core subject in the same period. As a result:
- each **room** holds at most one class per period (General Science shares the Science Laboratory across all six sections, one section per period);
- each **teacher** is in one place at a time;
- each **section** has one class per period.

The seed script checks every class against every other and refuses to run if it finds a conflict. The API applies the same check when admins add or edit a class (**Settings → Sections & Schedules → Schedule**), and **Settings → Room Schedule** shows, for each day, which section is in every room each period. Teachers can view the schedules of sections they advise or teach in, plus their own weekly teaching schedule.

## How monitoring works

Thresholds are set in **Settings → Monitoring Preferences** (defaults shown).

### Attendance is recorded per class period

Each `AttendanceRecord` is one learner in one class period (`ClassSchedule`: subject, time, room) on one date, with a status, optional **time in** (`HH:mm`) and remarks.

- **Who records:** the subject teacher of that period, the section's adviser (e.g. for the ARAL period or a substitute), or an admin. The date must fall on the period's weekday.
- **Late:** a Present learner whose time in is more than the grace period (default **15 min**, Settings → Monitoring Preferences) after the period starts is saved as **Late**.
- **Day status** is derived from the day's periods:
  | Day status | Rule |
  |---|---|
  | Absent | absent from every period |
  | Excused | every period absent or excused, at least one excused |
  | Late | attended, late to at least one period |
  | Present | attended |
  | *Partial day* | attended, but absent from at least one period (possible cutting); shown as **C** in SF2 |

**Attendance rate** = class periods attended (present + late) ÷ class periods recorded. A learner who skips 2 of 7 periods has a lower rate even though they were in school. Excused periods count as not attended (as in SF2).

**Learner status**
- **At Risk:** attendance < target − 10 (80%), or assessment average < mastery − 10 (65%), or ≥ 5 whole-day absences in the last 30 school days
- **Monitor:** attendance < target (90%), or assessment average < mastery (75%), or ≥ 3 partial days in the last 30 school days
- **On Track:** otherwise

**Competency mastery:** a learner has mastered a competency when their average on its assessments is ≥ 75%. Between 65% and 75% is *In Progress*; below that is *Needs Support*.

**Instructional alerts** are recalculated automatically (at most once a minute, and right after attendance or scores change):
| Level | Trigger | Recommended action |
|---|---|---|
| High | ≥ 5 whole-day absences in last 30 school days, or attendance < 80% | Contact parent/guardian, attendance plan |
| Medium | ≥ 3 partial days (in school but missed class periods) in last 30 school days | Verify with subject teachers, talk with the learner |
| Medium | Assessment average below the mastery target | Reteaching and additional practice |
| Medium | Passing overall but a competency average < 65% | Supplementary activities for those competencies |
| Low | A section's mastery rate on a competency < 70% | Whole-class reteaching, then reassess |

When the condition clears, the alert resolves itself. An alert a teacher resolves by hand stays resolved.

## Useful scripts

| Command | Where | Purpose |
|---|---|---|
| `npm run db:reset` | root | Drop all tables, recreate, reseed |
| `npm run db:studio` | server | Browse/edit data in Prisma Studio |
| `npm run db:migrate` | server | Create a versioned migration instead of `db push` |
