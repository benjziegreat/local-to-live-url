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
| **Dashboard** | Enrolment and average attendance (with trend vs the previous 20 school days), weekly/monthly attendance charts, assessment performance, **pre-test vs post-test comparison**, competency progress (by subject, or by competency when one subject is selected), top instructional alerts, learner monitoring table with recommended actions. Admins also see system activity and user/section counts. |
| **Attendance** | Daily time record **per class period**: pick a date and a period (subject, time, room, teacher), record the **competency taught**, then mark each learner Present / Late / Absent / Excused with **time in** and remarks. Late is automatic past the grace period. Also: trend, summary ring, daily, **weekly** and monthly summaries, and **attendance % per learner** with the lessons (competencies) each learner missed. |
| **Competencies** | Competencies per subject, organised by **term and learning period**, with code and description; add/edit (subject required); **coverage** (lessons logged, assessments, pre/post-tests) and **completion status**; mastery % and per-learner learning gaps. |
| **Assessment Records** | **Competency-level pre-test and post-test** per learner (scores, total items, percentages, learning gain, improved / maintained / declined, performance interpretation), class summaries and a pre/post comparison chart; plus quizzes, performance tasks and exams aligned to a competency. Excel export. |
| **Instructional Alerts** | High / Medium / Low alerts per learner, **subject and competency**: frequent absences (whole day or in one subject), missed lessons, low pre-test, limited or no improvement, enrichment candidates, competencies the class struggles with. Each has a reason, a recommended **intervention** (reteaching, remediation, enrichment, catch-up, attendance follow-up) and a follow-up log. |
| **Reports** | Daily / weekly / monthly / school-year attendance, **subject attendance summary**, SF2 grid and DTR (whole day or one subject's periods), **competency completion**, competency mastery, **pre-test vs post-test**, **learning gain analysis**, assessment, learner performance, **learners needing support**, alerts and consolidated reports. Preview, **Excel (.xlsx)**, CSV, or **Print / Save as PDF**. |
| **Learners** | Directory by section with the subject teacher; learner profile with a **summary per subject** (teacher, attendance, average, competencies mastered, pre→post gain, alerts) and subject tabs for attendance, competency progress, pre/post-tests and intervention history. Admins add, edit and archive learners. |
| **Settings** | School configuration (name, ID, division, academic year, current term: 1st, 2nd or 3rd Term), monitoring preferences and thresholds, sections with their allocated room and weekly class schedule, personal account and password. Teachers also see their own teaching schedule here. |
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

Teachers see the sections they advise and, when a subject is selected, the sections where they teach that subject. Scoping is enforced by the API, not just the UI (see [Subject-based filtering](#subject-based-filtering)).

The school year is divided into **three terms** (1st, 2nd and 3rd Term); competencies, assessments and pre/post-tests each belong to a term. (In the database the field is still named `quarter` / `currentQuarter`, so existing records keep their values.)

## Subject-based filtering

Every module (Dashboard, Attendance, Competencies, Assessment Records, Instructional Alerts, Reports, Learners) has the same **subject selector** at the top. It is one shared filter: switching subjects on one page applies everywhere, and the choice is remembered per user.

It is part of the data model, not only the UI:

| Record | Linked to its subject through |
|---|---|
| Attendance | the class period (`ClassSchedule.subjectId`); with a subject selected, only that subject's periods count, so "absent" means absent from that subject |
| Lessons | `ClassSession`: the competency taught in a class period on a date (recorded with attendance) |
| Competencies | `Competency.subjectId` (plus term and learning period) |
| Assessments, pre/post-tests | their competency |
| Instructional alerts | `Alert.subjectId` (whole-day attendance alerts have none and show under every subject of the learner) |

Server side, `server/src/lib/scope.js` builds every query from the same helpers (`sectionWhere`, `learnerWhere`, `competencyWhere` with `subjectId`), and every API endpoint accepts `?subjectId=`.

Who sees what:

| User | All Subjects | One subject |
|---|---|---|
| Administrator | whole school | every section that takes the subject |
| Adviser | their advisory section, all subjects | sections where they teach it, plus their advisory section if it takes it |
| Subject teacher (no advisory section) | not offered | the sections where they teach it |

Subject teachers can record attendance, pre/post-tests and assessments, view learner profiles and follow up alerts for the sections they teach.

## Competency-level pre-test and post-test

A pre-test/post-test (`PrePostTest`) belongs to one **section × competency × school year**. Each learner has a pre-test and a post-test score (`PrePostScore`); either may be blank until given.

- Encode the pre-test before instruction (**Assessment Records → Encode Pre/Post-test**), then return after the lesson or intervention to add the post-test.
- **Pre-test %** = pre-test score ÷ pre-test total items × 100 · **Post-test %** = post-test score ÷ post-test total items × 100
- **Learning gain** = post-test % − pre-test % (percentage points) → **Improved** (> 0), **Maintained** (= 0) or **Declined** (< 0)
- **Performance interpretation** from the post-test: Mastered (≥ mastery target), Nearly mastered (≥ target − 10), Needs remediation; before the post-test: Advanced (≥ 90%, enrichment), Low readiness (below the low pre-test threshold) or Developing.
- Post-test results count toward competency mastery; pre-test results do not (they measure readiness before instruction).

A competency is **Completed** when a post-test is recorded in every section (in view) that takes its subject; **In progress** once lessons are logged, a pre-test is given or assessments are recorded.

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

   **Stop everything** (from any terminal, even after closing the one running `npm run dev`):
   ```bash
   npm run stop
   ```
   This frees the API port (`PORT` in `server/.env`, default 4110) and the Angular port (4210) by stopping the whole `npm run dev` process tree, so `node --watch` can't restart the API. Extra ports: `npm run stop -- 3000 5000`.

For a single-port production run: `npm start` builds the Angular app and serves it from the API on :4110.

**Upgrading an existing database** (created before subject-based filtering): run `npm run db:push --prefix server` to add the new tables and columns, then restart the API. On start it links existing competencies to their subject by name, and the next alert sync recreates the alerts per subject (the old overall "below target" alerts resolve themselves, keeping any teacher notes). Stored attendance, assessments and scores are unchanged. To get the demo lesson logs and pre/post-tests instead, reseed with `npm run db:reset` (this replaces all data).

## Demo accounts

Password for all: `password123` (or use **Continue as Teacher / Admin** on the login page)

| Role | Email | Notes |
|---|---|---|
| Administrator | admin@aicss.edu | Antonio Reyes |
| Teacher | teacher@aicss.edu | Maria Santos: adviser of Grade 11 – STEM A; teaches Effective Communication to all sections |
| Teacher | juan.delacruz@aicss.edu · paolo.garcia@aicss.edu · liza.tan@aicss.edu · rosa.mendoza@aicss.edu · teresa.aquino@aicss.edu | Advisers of the other five sections (see table below) |
| Teacher | ramon.villanueva@ · carmela.bautista@ · jerome.castillo@ · elena.navarro@ · victor.ramos@aicss.edu | Elective teachers (Physics, Creative Composition, Programming, Chemistry, Accounting) |
| Teacher | grace.lim@aicss.edu | Deactivated (shows the inactive-account flow) |

The seed creates 174 learners across 6 sections, daily attendance from June 15 to today, 27 competencies (with learning periods) across the 5 core subjects and the 6 electives in use, a lesson log (competency taught in every class meeting), quizzes, performance tasks and a 1st Term exam with scores, and competency pre-tests/post-tests: complete for the 1st Term, and for the 2nd Term complete in half the sections and awaiting the post-test in the others.

## Subjects

The **Subjects** catalog (`Subject` table, *Settings → Subjects*) lists every subject with its type and usual room:

| Type | Subjects |
|---|---|
| Core (every section) | General Mathematics · General Science · Effective Communication / Mabisang Komunikasyon · Life and Career Skills · Pag-aaral ng Kasaysayan |
| Elective, TechPro | SMAW · Programming · Visual Graphic Design · Agricultural Crop Production · Bakery Operation · Kitchen Operation · Food and Beverage Services · EIM |
| Elective, Academic | Physics · Finite Mathematics · Chemistry · Creative Composition · Accounting |
| Program | ARAL Program |

Each section takes the 5 core subjects plus **one elective (its specialization)**. Every competency belongs to a subject (`Competency.subjectId`); the subject filter lists the subjects a teacher teaches plus those of their advisory section. To use other subjects (e.g. Oral Communication, Empowerment Technologies, Practical Research 1), add them in *Settings → Subjects*, schedule them for sections, and add their competencies.

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

**Competency mastery:** a learner has mastered a competency when their average on its assessments and post-test is ≥ 75%. Between 65% and 75% is *In Progress*; below that is *Needs Support*.

**Instructional alerts** are recalculated automatically (at most once a minute, and right after attendance or scores change). Each names the learner (or class), subject, competency, reason and intervention:
| Level | Trigger | Intervention |
|---|---|---|
| High | ≥ 5 whole-day absences in last 30 school days, or attendance < 80% (all subjects) | Attendance follow-up: contact parent/guardian, attendance plan |
| Medium | ≥ 3 partial days (in school but missed class periods) in last 30 school days | Attendance follow-up: verify with subject teachers |
| Medium | ≥ 5 absences from one subject's classes in last 30 school days (when not already a whole-day alert) | Catch-up |
| Medium | Absent from ≥ 2 (and ≥ 25%) of the lessons on a competency not yet mastered | Catch-up activities before the post-test |
| Medium | Subject average below the mastery target | Remediation |
| Medium | Passing the subject but a competency average < 65% | Remediation for those competencies |
| Medium | Post-test below target with a gain under the minimum learning gain (10 points), including no change or a decline | Remediation, then reassess |
| Low | Pre-test below the low pre-test threshold (40%), post-test not yet given | Remediation of prerequisite skills |
| Low | Pre-test ≥ 90% before instruction | Enrichment |
| Low | A section's mastery rate on a competency < 70% | Whole-class reteaching |
| Low | Class average gain under the minimum, or half the class low on a pre-test | Whole-class reteaching / scaffolded instruction |

When the condition clears, the alert resolves itself. An alert a teacher resolves by hand stays resolved.

## Useful scripts

| Command | Where | Purpose |
|---|---|---|
| `npm run db:reset` | root | Drop all tables, recreate, reseed |
| `npm run db:studio` | server | Browse/edit data in Prisma Studio |
| `npm run db:migrate` | server | Create a versioned migration instead of `db push` |
