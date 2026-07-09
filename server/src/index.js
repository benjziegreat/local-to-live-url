const express = require('express');
const cors = require('cors');
const tunnelManager = require('./tunnelManager');
const sshTunnelManager = require('./sshTunnelManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

app.get('/api/ssh-tunnel/status', (req, res) => {
  res.json(sshTunnelManager.getStatus());
});

app.post('/api/ssh-tunnel/start', (req, res) => {
  const { localUrl, publicIp, sshUser, sshPort, remotePort, privateKeyPath } = req.body || {};
  if (!localUrl || !publicIp || !sshUser || !remotePort) {
    return res.status(400).json({ error: 'localUrl, publicIp, sshUser and remotePort are required' });
  }
  try {
    const status = sshTunnelManager.start({ localUrl, publicIp, sshUser, sshPort, remotePort, privateKeyPath });
    res.status(202).json(status);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/ssh-tunnel/stop', (req, res) => {
  try {
    const status = sshTunnelManager.stop();
    res.status(202).json(status);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Tunnel admin server listening on http://localhost:${PORT}`);
});
