const telegramModule = require('node-telegram-bot-api');
const BotClass = telegramModule.Bot || telegramModule;
const axios = require('axios');
const { AccountRepo } = require('./models/Account');
const { WalletRepo } = require('./models/Wallet');
const { SettingsRepo, isAdminUser } = require('./models/Settings');

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

    // Admin /admin command to open separate Admin Panel
    bot.command('admin', async (ctx) => {
      const uid = String(ctx.from?.id || '');
      if (!isAdminUser(uid)) {
        if (ctx.reply) await ctx.reply('❌ Admin access required.');
        return;
      }
      const cur = await SettingsRepo.get();
      const adminUrl = `${currentWebAppUrl.replace(/\/$/, '')}/admin.html`;
      const msg = `⚙️ *Toing Pro Admin Panel*\n\n• Current Order Fee: *₹${cur.orderFee}*\n• Minimum Deposit: *₹${cur.minDeposit}*\n\nTap below to open Admin Settings, or use:\n\`/setfee ${cur.orderFee} ${cur.minDeposit}\``;
      const opts = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '⚙️ Open Admin Panel', web_app: { url: adminUrl } }]],
        },
      };
      if (ctx.reply) await ctx.reply(msg, opts);
    });

    // Admin /setfee <orderFee> <minDeposit> command
    bot.command('setfee', async (ctx) => {
      const uid = String(ctx.from?.id || '');
      if (!isAdminUser(uid)) {
        if (ctx.reply) await ctx.reply('❌ Admin access required.');
        return;
      }
      const parts = (ctx.message?.text || '').trim().split(/\s+/);
      if (parts.length < 3 || isNaN(Number(parts[1])) || isNaN(Number(parts[2]))) {
        const cur = await SettingsRepo.get();
        if (ctx.reply) await ctx.reply(`Current Settings:\n• Order Fee: ₹${cur.orderFee}\n• Min Deposit: ₹${cur.minDeposit}\n\nUsage: /setfee <orderFee> <minDeposit>\nExample: /setfee 3 15`);
        return;
      }
      const updated = await SettingsRepo.update({ orderFee: Number(parts[1]), minDeposit: Number(parts[2]) });
      if (ctx.reply) await ctx.reply(`✅ Settings Updated!\n• Order Fee: ₹${updated.orderFee} / order\n• Min Deposit: ₹${updated.minDeposit}`);
    });

    // Register /start command
    bot.command('start', async (ctx) => {
      const tgUid = String(ctx.from?.id || 'default');
      const [accounts, wallet, cfg] = await Promise.all([
        AccountRepo.getAll(tgUid),
        WalletRepo.getWallet(tgUid),
        SettingsRepo.get(),
      ]);

      const totalAccounts = (accounts || []).length;
      const totalOrders = Number(wallet?.totalOrders || 0);
      const balance = Number(wallet?.balance || 0);
      const orderFee = Number(cfg?.orderFee ?? 3);

      const welcomeText =
        `🚀 *WELCOME TO TOING PRO ORDER BOT !*\n\n` +
        `YOU CAN USE WEB MINI FOR ORDERS.\n\n` +
        `📊 *STATS*\n` +
        `• *TOTAL ACCOUNTS* : ${totalAccounts}\n` +
        `• *TOTAL ORDERS* : ${totalOrders}\n` +
        `• *BALANCE* : ₹${balance}\n` +
        `• *ORDER FEES* : ₹${orderFee}`;

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
        const tgUid = String(ctx.from?.id || 'default');
        const accounts = await AccountRepo.getAll(tgUid);
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
