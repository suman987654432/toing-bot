require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectDB } = require('./config/db');
const apiRoutes = require('./routes/api');
const { initBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 5000;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

// Middlewares
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('bypass-tunnel-reminder', 'true');
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../public')));

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

