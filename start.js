const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// 1. Start the main server
console.log('🚀 Starting Toing Pro Server...');
require('./src/server');

// 2. Start Cloudflare tunnel automatically
setTimeout(() => {
  const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
  if (!fs.existsSync(cloudflaredPath)) {
    console.log('[Tunnel] cloudflared.exe not found. Running in local-only mode on port 5000.');
    return;
  }

  console.log('🌐 Launching Cloudflare Tunnel...');
  const tunnel = spawn(cloudflaredPath, ['tunnel', '--url', 'http://127.0.0.1:5000']);

  let urlDetected = false;

  const handleOutput = async (data) => {
    const text = data.toString();
    const match = text.match(/https:\/\/(?!api\.)[a-zA-Z0-9\-]+\.trycloudflare\.com/);
    if (match && !urlDetected) {
      urlDetected = true;
      const tunnelUrl = match[0];
      console.log('====================================================');
      console.log('🎉 CLOUDFLARE TUNNEL LIVE!');
      console.log('🔗 URL:', tunnelUrl);
      console.log('====================================================');

      // Update runtime env & .env
      process.env.WEBAPP_URL = tunnelUrl;
      try {
        let envContent = fs.readFileSync('.env', 'utf8');
        envContent = envContent.replace(/WEBAPP_URL=.*(\r?\n|$)/, `WEBAPP_URL=${tunnelUrl}$1`);
        fs.writeFileSync('.env', envContent);
      } catch (e) {}

      // Update Telegram Bot Menu Button
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        try {
          await axios.post(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
            menu_button: {
              type: 'web_app',
              text: '🚀 Toing Pro',
              web_app: { url: tunnelUrl }
            }
          });
          console.log('📱 Telegram Bot Menu Button Updated to:', tunnelUrl);
          console.log('👉 Open your bot on Telegram and tap "🚀 Toing Pro"!');
        } catch (err) {
          console.error('Failed to update bot menu button:', err.message);
        }
      }
    }
  };

  tunnel.stdout.on('data', handleOutput);
  tunnel.stderr.on('data', handleOutput);

  tunnel.on('close', (code) => {
    console.log('[Tunnel] Tunnel process exited with code:', code);
  });
}, 1500);

