require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const zlib = require('zlib');
const { connectDB } = require('./config/db');
const apiRoutes = require('./routes/api');
const { initBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 5000;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

// Built-in lightweight Gzip compression for fast mobile loading over tunnels
app.use((req, res, next) => {
  const acceptEnc = req.headers['accept-encoding'] || '';
  if (!acceptEnc.includes('gzip')) return next();

  const origSend = res.send.bind(res);
  res.send = (body) => {
    if (res.headersSent || !body) return origSend(body);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    if (buf.length < 1024) return origSend(body);
    if (!Buffer.isBuffer(body) && typeof body !== 'string' && !res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    zlib.gzip(buf, (err, compressed) => {
      if (err) return origSend(body);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.removeHeader('Content-Length');
      res.end(compressed);
    });
    return res;
  };
  next();
});

// Middlewares
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('bypass-tunnel-reminder', 'true');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files with fresh JS/HTML (no stale Telegram WebView cache)
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// API Routes
app.use('/api', apiRoutes);

// Fallback for SPA routing (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start Server
const startServer = async () => {
  // Start HTTP Server immediately so tunnels (localtunnel/ngrok) don't get 502 Bad Gateway
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`🚀 Toing Pro Server running on port ${PORT}`);
    console.log(`📱 WebApp URL: ${WEBAPP_URL}`);
    console.log(`🛠️ API Base: http://localhost:${PORT}/api`);
    console.log(`===============================================`);
  });

  // Connect MongoDB Atlas asynchronously
  connectDB().catch((err) => {
    console.log('[MongoDB] Running with local fallback.');
  });

  // Initialize Telegram Bot
  initBot(WEBAPP_URL);
};

startServer();

