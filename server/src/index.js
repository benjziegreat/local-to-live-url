const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const auth = require('./auth');
const tunnelManager = require('./tunnelManager');
const dnsTunnelManager = require('./dnsTunnelManager');

const app = express();
const PORT = process.env.PORT || 3050;

app.use(cors());
app.use(express.json());

app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.use('/api', auth.requireAuth);

app.get('/api/tunnel/status', (req, res) => {
  res.json(tunnelManager.getStatus());
});

app.post('/api/tunnel/start', (req, res) => {
  const { localUrl } = req.body || {};
  if (!localUrl) {
    return res.status(400).json({ error: 'localUrl is required' });
  }
  try {
    const status = tunnelManager.start(localUrl);
    res.status(202).json(status);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/tunnel/stop', (req, res) => {
  try {
    const status = tunnelManager.stop();
    res.status(202).json(status);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/dns-tunnel/status', (req, res) => {
  res.json(dnsTunnelManager.getAllStatus());
});

app.post('/api/dns-tunnel/:id/start', (req, res) => {
  const { localUrl, subdomain } = req.body || {};
  if (!localUrl || !subdomain) {
    return res.status(400).json({ error: 'localUrl and subdomain are required' });
  }
  try {
    const status = dnsTunnelManager.start(req.params.id, { localUrl, subdomain });
    res.status(202).json(status);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/dns-tunnel/:id/stop', (req, res) => {
  try {
    const status = dnsTunnelManager.stop(req.params.id);
    res.status(202).json(status);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// In a packaged build the compiled dashboard sits in ../public; serve it from the same port.
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Tunnel admin server listening on http://localhost:${PORT}`);
});
