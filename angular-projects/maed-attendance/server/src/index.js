require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');

const app = express();
const PORT = Number(process.env.PORT) || 4100;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, database: 'connected' });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'unreachable', error: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/common').router);
app.use('/api/student', require('./routes/student'));
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/adviser', require('./routes/adviser'));
app.use('/api/parent', require('./routes/parent'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the production Angular build when it exists (npm run build in ../client).
const clientDist = path.resolve(__dirname, '../../client/dist/client/browser');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
});

app.listen(PORT, () => {
  console.log(`MAEd attendance API listening on http://localhost:${PORT}`);
});
