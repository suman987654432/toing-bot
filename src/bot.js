const telegramModule = require('node-telegram-bot-api');
const BotClass = telegramModule.Bot || telegramModule;
const axios = require('axios');
const { AccountRepo } = require('./models/Account');

let bot = null;

const initBot = (webAppUrl) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token.trim() === '') {
    console.log('[Telegram Bot] TELEGRAM_BOT_TOKEN is not set in .env. Bot polling skipped.');
    console.log('[Telegram Bot] You can access the WebApp in browser at: ' + (webAppUrl || 'http://localhost:5000'));
    return null;
  }

  try {
    let currentWebAppUrl = webAppUrl || process.env.WEBAPP_URL || 'http://localhost:5000';
    bot = new BotClass(token);

    // Helper to sync Telegram Menu Button directly via Telegram API
    const syncMenuButton = async (url) => {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
          menu_button: {
            type: 'web_app',
            text: '🚀 Toing Pro',
            web_app: { url },
          },
        });
        console.log('[Telegram Bot] Telegram Menu button successfully updated to:', url);
      } catch (e) {
        // Fallback to bot.api
        try {
          if (bot.api && typeof bot.api.setChatMenuButton === 'function') {
            await bot.api.setChatMenuButton({
              menu_button: {
                type: 'web_app',
                text: '🚀 Toing Pro',
                web_app: { url },
              },
            });
          }
        } catch (err2) {}
      }
    };

    // Set initial menu button
    syncMenuButton(currentWebAppUrl);

    // Register /url or /seturl command to update WebApp URL on the fly
    bot.command('seturl', async (ctx) => {
      const parts = (ctx.message?.text || '').split(' ');
      if (parts.length > 1 && parts[1].startsWith('http')) {
        currentWebAppUrl = parts[1].trim();
        await syncMenuButton(currentWebAppUrl);
        const reply = `✅ WebApp URL updated to:\n${currentWebAppUrl}\n\nType /start to open the new WebApp!`;
        if (ctx.reply) await ctx.reply(reply);
      } else {
        const reply = `Usage: /seturl https://your-new-tunnel-url`;
        if (ctx.reply) await ctx.reply(reply);
      }
    });

    // Register /start command
    bot.command('start', async (ctx) => {
      const firstName = ctx.from?.first_name || 'User';

      const welcomeText = `👋 Hello ${firstName}!\n\nWelcome to *Toing PRO* — Your automated multi-account manager & assistant for Swiggy Toing.\n\n✨ Features:\n• Multi-Account Manager (OTP & JSON import)\n• Live Address & Menu Search\n• Auto-Apply Best Coupons\n• Past Orders & Live Tracking\n• Referral & Reward Auto-Claim\n\nTap the button below to launch the Mini App!`;

      const options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Open Toing Pro',
                web_app: { url: currentWebAppUrl },
              },
            ],
            [
              {
                text: '👥 Saved Accounts',
                callback_data: 'view_accounts',
              },
              {
                text: '⚡ Tools & Claims',
                callback_data: 'tools_menu',
              },
            ],
          ],
        },
      };

      if (ctx.reply) {
        await ctx.reply(welcomeText, options);
      } else if (bot.sendMessage) {
        bot.sendMessage(ctx.chat?.id || ctx.chatId, welcomeText, options);
      }
    });

    // Handle button callbacks
    bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery?.data || ctx.data;
      if (data === 'view_accounts') {
        const accounts = await AccountRepo.getAll();
        let text = '📱 *Saved Accounts:*\n\n';
        if (!accounts || accounts.length === 0) {
          text = '❌ No accounts saved yet. Open Toing Pro to add your first account.';
        } else {
          accounts.forEach((acc, i) => {
            text += `${i + 1}. +91 ${acc.phone} ${acc.isActive ? '⭐ *(Active)*' : ''}\n`;
          });
        }
        if (ctx.reply) await ctx.reply(text, { parse_mode: 'Markdown' });
      } else if (data === 'tools_menu') {
        const text = '⚡ *Tools Menu*\n\nPlease launch the Mini App using the "🚀 Open Toing Pro" button to access Referral Claimer, Scratch Cards, and Cart tools.';
        if (ctx.reply) await ctx.reply(text, { parse_mode: 'Markdown' });
      }

      if (ctx.answerCallbackQuery) {
        await ctx.answerCallbackQuery().catch(() => {});
      }
    });

    // Start Polling
    if (typeof bot.startPolling === 'function') {
      bot.startPolling().catch((err) => {
        console.error('[Telegram Bot] Polling error:', err.message);
      });
    }

    console.log('[Telegram Bot] Bot is online and listening for messages!');
    return bot;
  } catch (err) {
    console.error('[Telegram Bot] Failed to initialize bot:', err.message);
    return null;
  }
};

module.exports = { initBot, getBot: () => bot };
