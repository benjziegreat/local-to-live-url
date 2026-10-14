// Endpoints shared by several portals: geofence, messaging, excuse notes.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../lib/auth');
const { asyncHandler, HttpError, fullName } = require('../lib/http');
const { parseDay } = require('../lib/time');

const router = express.Router();
router.use(authenticate);

router.get(
  '/geofence',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.geofence.findFirst({ orderBy: { id: 'asc' } }));
  }),
);

/** Whether `userId` (a parent or adviser) may talk about / act for `studentId`. */
async function canActForStudent(user, studentId) {
  if (user.role === 'PARENT') {
    return !!(await prisma.parentLink.findFirst({ where: { parentId: user.id, studentId } }));
  }
  if (user.role === 'ADVISER') {
    return !!(await prisma.student.findFirst({ where: { id: studentId, section: { adviserId: user.id } } }));
  }
  if (user.role === 'STUDENT') {
    return !!(await prisma.student.findFirst({ where: { id: studentId, userId: user.id } }));
  }
  return false;
}

// ---- Messaging (parent <-> adviser) -------------------------------------

router.get(
  '/messages/thread',
  asyncHandler(async (req, res) => {
    const otherId = Number(req.query.with);
    if (!otherId) throw new HttpError(400, 'Missing "with" user id');
    const me = req.user.id;

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: me, recipientId: otherId },
          { senderId: otherId, recipientId: me },
        ],
      },
      include: { sender: true },
      orderBy: { createdAt: 'asc' },
    });

    await prisma.message.updateMany({
      where: { senderId: otherId, recipientId: me, readAt: null },
      data: { readAt: new Date() },
    });

    res.json(
      messages.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        mine: m.senderId === me,
        senderName: fullName(m.sender),
        studentId: m.studentId,
      })),
    );
  }),
);

router.post(
  '/messages',
  asyncHandler(async (req, res) => {
    const { recipientId, studentId, body } = req.body || {};
    if (!recipientId || !body || !String(body).trim()) throw new HttpError(400, 'Recipient and message are required');
    if (studentId && !(await canActForStudent(req.user, Number(studentId)))) {
      throw new HttpError(403, 'You cannot message about this student');
    }
    const recipient = await prisma.user.findUnique({ where: { id: Number(recipientId) } });
    if (!recipient) throw new HttpError(404, 'Recipient not found');

    const message = await prisma.message.create({
      data: {
        senderId: req.user.id,
        recipientId: recipient.id,
        studentId: studentId ? Number(studentId) : null,
        body: String(body).trim(),
      },
    });
    res.status(201).json({ id: message.id, body: message.body, createdAt: message.createdAt, mine: true });
  }),
);

// ---- Excuse notes (student or parent submits, adviser reviews) ------------

router.post(
  '/excuse-notes',
  asyncHandler(async (req, res) => {
    const { date, reason, attachmentName } = req.body || {};
    let studentId = Number(req.body?.studentId);

    if (req.user.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: req.user.id } });
      studentId = student?.id;
    }
    if (!studentId || !(await canActForStudent(req.user, studentId))) {
      throw new HttpError(403, 'You cannot submit an excuse note for this student');
    }
    if (!reason || String(reason).trim().length < 5) throw new HttpError(400, 'Please describe the reason (at least 5 characters)');

    const note = await prisma.excuseNote.create({
      data: {
        studentId,
        submittedById: req.user.id,
        date: parseDay(date),
        reason: String(reason).trim(),
        attachmentName: attachmentName ? String(attachmentName).slice(0, 190) : null,
      },
    });
    res.status(201).json(note);
  }),
);

module.exports = { router, canActForStudent };
