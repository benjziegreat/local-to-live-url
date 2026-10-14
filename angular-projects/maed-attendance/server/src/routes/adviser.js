const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../lib/auth');
const { asyncHandler, HttpError, fullName, rosterName } = require('../lib/http');
const { summarize, riskLevel, ATTENDED } = require('../lib/risk');
const { dateOnly, addDays, dayKey } = require('../lib/time');

const router = express.Router();
router.use(authenticate, requireRole('ADVISER'));

const RISK_ORDER = { CRITICAL: 0, MODERATE: 1, SAFE: 2 };
const OUTCOMES = ['GREEN', 'YELLOW', 'RED'];
const STATS_WINDOW_DAYS = 60;

/** Students in sections this adviser handles. */
const advisedWhere = (adviserId) => ({ section: { adviserId } });

async function assertAdvisee(adviserId, studentId) {
  const student = await prisma.student.findFirst({
    where: { id: Number(studentId), ...advisedWhere(adviserId) },
    include: { user: true, parents: { include: { parent: true } } },
  });
  if (!student) throw new HttpError(404, 'Student is not in your advisory class');
  return student;
}

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const since = addDays(dateOnly(), -STATS_WINDOW_DAYS);
    const [sections, students] = await Promise.all([
      prisma.section.findMany({ where: { adviserId: req.user.id }, select: { id: true, name: true } }),
      prisma.student.findMany({
        where: advisedWhere(req.user.id),
        include: {
          user: true,
          section: true,
          attendance: { where: { date: { gte: since } }, select: { status: true, date: true } },
          interventions: { orderBy: { date: 'desc' }, take: 1 },
        },
      }),
    ]);

    const profiles = students
      .map((st) => {
        const stats = summarize(st.attendance);
        return {
          id: st.id,
          name: rosterName(st.user),
          avatarHue: st.user.avatarHue,
          studentNo: st.studentNo,
          section: st.section.name,
          location: st.location,
          currentRoom: st.currentRoom,
          stats,
          risk: riskLevel(stats),
          lastIntervention: st.interventions[0] || null,
        };
      })
      .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.stats.rate - b.stats.rate);

    const counts = { SAFE: 0, MODERATE: 0, CRITICAL: 0 };
    for (const p of profiles) counts[p.risk] += 1;

    res.json({ sections, counts, windowDays: STATS_WINDOW_DAYS, students: profiles });
  }),
);

router.get(
  '/interventions',
  asyncHandler(async (req, res) => {
    const items = await prisma.intervention.findMany({
      where: { student: advisedWhere(req.user.id) },
      include: { adviser: true, student: { include: { user: true } } },
      orderBy: { date: 'desc' },
      take: 30,
    });
    res.json(
      items.map((i) => ({
        id: i.id,
        date: i.date,
        student: rosterName(i.student.user),
        studentId: i.studentId,
        actionTaken: i.actionTaken,
        notes: i.notes,
        conductedBy: fullName(i.adviser),
        outcome: i.outcome,
      })),
    );
  }),
);

router.post(
  '/interventions',
  asyncHandler(async (req, res) => {
    const { studentId, actionTaken, notes, outcome } = req.body || {};
    await assertAdvisee(req.user.id, studentId);
    if (!actionTaken || !String(actionTaken).trim()) throw new HttpError(400, 'Describe the action taken');
    if (!OUTCOMES.includes(outcome)) throw new HttpError(400, 'Outcome must be GREEN, YELLOW or RED');

    const created = await prisma.intervention.create({
      data: {
        studentId: Number(studentId),
        adviserId: req.user.id,
        actionTaken: String(actionTaken).trim().slice(0, 190),
        notes: notes ? String(notes).trim() : null,
        outcome,
      },
    });
    res.status(201).json(created);
  }),
);

/** Communication history: parent messages, interventions and teacher alerts for one student. */
router.get(
  '/students/:id/history',
  asyncHandler(async (req, res) => {
    const student = await assertAdvisee(req.user.id, req.params.id);
    const parentIds = student.parents.map((p) => p.parentId);

    const [messages, interventions, alerts] = await Promise.all([
      prisma.message.findMany({
        where: {
          OR: [
            { senderId: req.user.id, recipientId: { in: parentIds } },
            { recipientId: req.user.id, senderId: { in: parentIds } },
          ],
        },
        include: { sender: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.intervention.findMany({ where: { studentId: student.id }, orderBy: { date: 'desc' } }),
      prisma.alert.findMany({
        where: { studentId: student.id },
        include: { raisedBy: true, subject: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    res.json({
      student: { id: student.id, name: fullName(student.user) },
      parents: student.parents.map((p) => ({ id: p.parent.id, name: fullName(p.parent), relationship: p.relationship })),
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        mine: m.senderId === req.user.id,
        senderName: fullName(m.sender),
      })),
      interventions,
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        message: a.message,
        createdAt: a.createdAt,
        subject: a.subject?.name || null,
        raisedBy: a.raisedBy ? fullName(a.raisedBy) : 'System',
      })),
    });
  }),
);

/** Daily attendance rate across the adviser's students for the last ~26 weeks. */
router.get(
  '/heatmap',
  asyncHandler(async (req, res) => {
    const weeks = Math.min(Number(req.query.weeks) || 26, 52);
    const today = dateOnly();
    const since = addDays(today, -weeks * 7);

    const records = await prisma.attendanceRecord.findMany({
      where: { date: { gte: since }, student: advisedWhere(req.user.id) },
      select: { date: true, status: true },
    });

    const byDay = new Map();
    for (const r of records) {
      const key = dayKey(r.date);
      const entry = byDay.get(key) || { total: 0, attended: 0 };
      entry.total += 1;
      if (ATTENDED.has(r.status)) entry.attended += 1;
      byDay.set(key, entry);
    }

    res.json({
      from: dayKey(since),
      to: dayKey(today),
      days: [...byDay.entries()]
        .map(([date, e]) => ({ date, total: e.total, rate: Math.round((e.attended / e.total) * 100) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
  }),
);

router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const alerts = await prisma.alert.findMany({
      where: { acknowledged: false, student: advisedWhere(req.user.id) },
      include: { raisedBy: true, subject: true, student: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    res.json(
      alerts.map((a) => ({
        id: a.id,
        type: a.type,
        message: a.message,
        createdAt: a.createdAt,
        studentId: a.studentId,
        student: rosterName(a.student.user),
        subject: a.subject?.name || null,
        raisedBy: a.raisedBy ? fullName(a.raisedBy) : 'System',
      })),
    );
  }),
);

router.post(
  '/alerts/:id/ack',
  asyncHandler(async (req, res) => {
    const { count } = await prisma.alert.updateMany({
      where: { id: Number(req.params.id), student: advisedWhere(req.user.id) },
      data: { acknowledged: true },
    });
    if (!count) throw new HttpError(404, 'Alert not found');
    res.json({ ok: true });
  }),
);

router.get(
  '/excuse-notes',
  asyncHandler(async (req, res) => {
    const notes = await prisma.excuseNote.findMany({
      where: { status: 'PENDING', student: advisedWhere(req.user.id) },
      include: { student: { include: { user: true } }, submittedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      notes.map((n) => ({
        id: n.id,
        date: dayKey(n.date),
        reason: n.reason,
        attachmentName: n.attachmentName,
        createdAt: n.createdAt,
        studentId: n.studentId,
        student: rosterName(n.student.user),
        submittedBy: `${fullName(n.submittedBy)} (${n.submittedBy.role.toLowerCase()})`,
      })),
    );
  }),
);

/** Approving a note converts that day's unexcused absences into EXCUSED. */
router.post(
  '/excuse-notes/:id',
  asyncHandler(async (req, res) => {
    const decision = req.body?.decision;
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new HttpError(400, 'Decision must be APPROVED or REJECTED');

    const note = await prisma.excuseNote.findFirst({
      where: { id: Number(req.params.id), student: advisedWhere(req.user.id) },
    });
    if (!note) throw new HttpError(404, 'Excuse note not found');

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.excuseNote.update({
        where: { id: note.id },
        data: { status: decision, reviewedById: req.user.id },
      });
      let excused = 0;
      if (decision === 'APPROVED') {
        ({ count: excused } = await tx.attendanceRecord.updateMany({
          where: { studentId: note.studentId, date: note.date, status: 'ABSENT' },
          data: { status: 'EXCUSED', note: `Excused via note #${note.id}` },
        }));
      }
      return { note: updated, excusedRecords: excused };
    });
    res.json(result);
  }),
);

module.exports = router;
