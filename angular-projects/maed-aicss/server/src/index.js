require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');

const app = express();
const PORT = Number(process.env.PORT) || 4110;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'unreachable', error: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard').router);
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/competencies', require('./routes/competencies'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/learners', require('./routes/learners'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/settings'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the production Angular build when it exists (npm run build in ../client).
const clientDist = path.resolve(__dirname, '../../client/dist/client/browser');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || 500;
  // Prisma "record not found" on update/delete
  if (err.code === 'P2025') status = 404;
  if (status >= 500) console.error(err);
  const message = status === 404 && err.code === 'P2025' ? 'Record not found' : status >= 500 ? 'Something went wrong on the server' : err.message;
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`AICSS API listening on http://localhost:${PORT}`);
});
