const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../lib/auth');
const { asyncHandler, HttpError, fullName } = require('../lib/http');
const { summarize, healthLabel } = require('../lib/risk');
const { dateOnly, addDays, dayKey } = require('../lib/time');

const router = express.Router();
router.use(authenticate, requireRole('PARENT'));

const ALERT_WINDOW_DAYS = 14;

router.get(
  '/children',
  asyncHandler(async (req, res) => {
    const links = await prisma.parentLink.findMany({
      where: { parentId: req.user.id },
      include: { student: { include: { user: true, section: true } } },
    });
    res.json(
      links.map((l) => ({
        id: l.student.id,
        name: fullName(l.student.user),
        firstName: l.student.user.firstName,
        avatarHue: l.student.user.avatarHue,
        section: l.student.section.name,
        relationship: l.relationship,
        location: l.student.location,
      })),
    );
  }),
);

router.get(
  '/children/:id/dashboard',
  asyncHandler(async (req, res) => {
    const studentId = Number(req.params.id);
    const link = await prisma.parentLink.findFirst({ where: { parentId: req.user.id, studentId } });
    if (!link) throw new HttpError(404, 'This student is not linked to your account');

    const today = dateOnly();
    const since = addDays(today, -ALERT_WINDOW_DAYS);
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { user: true, section: { include: { adviser: true } } },
    });
    const adviser = student.section.adviser;

    const [geofence, gateLogs, absences, alerts, history, latestFromAdviser, excuseNotes] = await Promise.all([
      prisma.geofence.findFirst({ orderBy: { id: 'asc' } }),
      prisma.gateLog.findMany({ where: { studentId }, orderBy: { timestamp: 'desc' }, take: 10 }),
      prisma.attendanceRecord.findMany({
        where: { studentId, status: { in: ['ABSENT', 'CUTTING'] }, date: { gte: since } },
        include: { schedule: { include: { subject: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.alert.findMany({
        where: { studentId, createdAt: { gte: since } },
        include: { subject: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.attendanceRecord.findMany({ where: { studentId, date: { gte: addDays(today, -90) } }, select: { status: true, date: true } }),
      adviser
        ? prisma.message.findFirst({
            where: { senderId: adviser.id, recipientId: req.user.id },
            orderBy: { createdAt: 'desc' },
          })
        : null,
      prisma.excuseNote.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 5 }),
    ]);

    const unreadFromAdviser = adviser
      ? await prisma.message.count({ where: { senderId: adviser.id, recipientId: req.user.id, readAt: null } })
      : 0;
    const health = summarize(history);

    res.json({
      child: {
        id: student.id,
        name: fullName(student.user),
        firstName: student.user.firstName,
        avatarHue: student.user.avatarHue,
        studentNo: student.studentNo,
        section: student.section.name,
        location: student.location,
        currentRoom: student.currentRoom,
        lastLat: student.lastLat,
        lastLng: student.lastLng,
        lastSeenAt: student.lastSeenAt,
      },
      geofence,
      gateLogs,
      absences: absences.map((a) => ({
        id: a.id,
        date: dayKey(a.date),
        status: a.status,
        subject: a.schedule.subject.name,
        startTime: a.schedule.startTime,
      })),
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        message: a.message,
        subject: a.subject?.name || null,
        createdAt: a.createdAt,
      })),
      health: { ...health, label: healthLabel(health.rate) },
      adviser: adviser ? { id: adviser.id, name: fullName(adviser) } : null,
      latestMessage: latestFromAdviser ? { body: latestFromAdviser.body, createdAt: latestFromAdviser.createdAt } : null,
      unreadFromAdviser,
      excuseNotes: excuseNotes.map((n) => ({ ...n, date: dayKey(n.date) })),
    });
  }),
);

module.exports = router;
