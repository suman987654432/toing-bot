const telegramModule = require('node-telegram-bot-api');
const BotClass = telegramModule.Bot || telegramModule;
const axios = require('axios');
const { AccountRepo } = require('./models/Account');
const { WalletRepo } = require('./models/Wallet');
const { SettingsRepo, isAdminUser } = require('./models/Settings');

let bot = null;
const adminPending = new Map(); // adminTgId -> { action, mode, targetUid }

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

    const stripButtonStyles = (markup) => {
      if (!markup || !Array.isArray(markup.inline_keyboard)) return markup;
      return {
        ...markup,
        inline_keyboard: markup.inline_keyboard.map((row) =>
          row.map(({ style, ...rest }) => rest)
        ),
      };
    };

    const tgApi = async (method, payload) => {
      try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 10000 });
        return res.data;
      } catch (err) {
        if (err.response?.status === 400 && payload?.reply_markup?.inline_keyboard) {
          const fallback = { ...payload, reply_markup: stripButtonStyles(payload.reply_markup) };
          const res2 = await axios.post(`https://api.telegram.org/bot${token}/${method}`, fallback, { timeout: 10000 });
          return res2.data;
        }
        throw err;
      }
    };

    const sendOrEdit = async (chatId, messageId, text, inlineKeyboard, parseMode = 'Markdown') => {
      const reply_markup = { inline_keyboard: inlineKeyboard };
      if (messageId) {
        try {
          await tgApi('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: parseMode,
            disable_web_page_preview: true,
            reply_markup,
          });
          return;
        } catch (e) {
          // If edit fails (e.g. message unchanged or too old), send a fresh message
        }
      }
      await tgApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
        reply_markup,
      });
    };

    const syncMenuButton = async (url) => {
      try {
        await tgApi('setChatMenuButton', {
          menu_button: {
            type: 'web_app',
            text: '🚀 Toing Pro',
            web_app: { url },
          },
        });
        console.log('[Telegram Bot] Telegram Menu button successfully updated to:', url);
      } catch (e) {}
    };

    syncMenuButton(currentWebAppUrl);

    const resolveChannelUrl = (cfg) => {
      if (cfg.forceJoinUrl) return cfg.forceJoinUrl;
      const ch = String(cfg.forceJoinChannel || '').trim();
      if (ch.startsWith('@')) return `https://t.me/${ch.slice(1)}`;
      if (ch.startsWith('http')) return ch;
      return '';
    };

    const checkForceJoin = async (uid) => {
      const cfg = await SettingsRepo.get();
      if (!cfg.forceJoinEnabled || !cfg.forceJoinChannel || isAdminUser(uid)) {
        return { joined: true, cfg };
      }
      try {
        const res = await tgApi('getChatMember', {
          chat_id: cfg.forceJoinChannel,
          user_id: Number(uid) || uid,
        });
        const status = res?.result?.status;
        const isMember = ['member', 'administrator', 'creator'].includes(status)
          || (status === 'restricted' && res?.result?.is_member !== false);
        return { joined: Boolean(isMember), cfg, channelUrl: resolveChannelUrl(cfg) };
      } catch (e) {
        // If bot is not admin in channel or check fails, block only if channel is valid
        return { joined: false, cfg, channelUrl: resolveChannelUrl(cfg) };
      }
    };

    const sendForceJoinPrompt = async (chatId, messageId, cfg, channelUrl) => {
      const text =
        `🔒 *Channel Join Required*\n\n` +
        `Bot aur Mini App use karne ke liye pehle hamara official channel join karein:\n` +
        `📢 *Channel:* \`${cfg.forceJoinChannel}\`\n\n` +
        `Join karne ke baad neeche *✅ Maine Join Kar Liya* par tap karein.`;
      const rows = [];
      if (channelUrl) {
        rows.push([{ text: '📢 Join Channel', url: channelUrl, style: 'primary' }]);
      }
      rows.push([{ text: '✅ Maine Join Kar Liya', callback_data: 'fc_verify', style: 'success' }]);
      await sendOrEdit(chatId, messageId, text, rows);
    };

    const sendStartMenu = async (chatId, tgUid, messageId = null) => {
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

      const keyboard = [
        [{ text: '🚀 Open Toing Pro', web_app: { url: currentWebAppUrl }, style: 'success' }],
        [
          { text: '👥 Saved Accounts', callback_data: 'view_accounts', style: 'primary' },
          { text: '⚡ Tools & Claims', callback_data: 'tools_menu', style: 'primary' },
        ],
        [{ text: '🛒 Buy Account', url: 'https://t.me/CodeAddabot', style: 'primary' }],
      ];

      if (isAdminUser(tgUid)) {
        keyboard.push([{ text: '👑 Admin Panel', callback_data: 'adm_home', style: 'danger' }]);
      }

      await sendOrEdit(chatId, messageId, welcomeText, keyboard);
    };

    const renderAdminHome = async (chatId, messageId = null) => {
      const [cfg, summary] = await Promise.all([
        SettingsRepo.get(),
        WalletRepo.listUsers(1, 1),
      ]);

      const fjBadge = cfg.forceJoinEnabled ? '🟢 ON' : '🔴 OFF';
      const fjBtnStyle = cfg.forceJoinEnabled ? 'success' : 'danger';
      const chText = cfg.forceJoinChannel || 'Not Set';

      const text =
        `👑 *TOING PRO — ADMIN PANEL*\n\n` +
        `👥 *Total Users:* ${summary.totalUsers}\n` +
        `💰 *Total Wallet Balance:* ₹${summary.totalBalance}\n` +
        `📦 *Total Orders:* ${summary.totalOrders}\n\n` +
        `⚙️ *Order Fee:* ₹${cfg.orderFee}  |  *Min Deposit:* ₹${cfg.minDeposit}\n` +
        `📢 *Force Join:* ${fjBadge} (\`${chText}\`)`;

      const keyboard = [
        [
          { text: '📢 Channel Setup', callback_data: 'adm_channel', style: 'primary' },
          { text: `Force Join: ${fjBadge}`, callback_data: 'adm_toggle_fj', style: fjBtnStyle },
        ],
        [
          { text: '➕ Add Wallet ₹', callback_data: 'adm_wallet_add', style: 'success' },
          { text: '➖ Deduct Wallet ₹', callback_data: 'adm_wallet_ded', style: 'danger' },
        ],
        [
          { text: '⚙️ Fee & Min Deposit', callback_data: 'adm_fees', style: 'primary' },
          { text: '👥 Users Status', callback_data: 'adm_users_1', style: 'primary' },
        ],
        [
          { text: '🔄 Refresh', callback_data: 'adm_home', style: 'primary' },
          { text: '🔙 Main Menu', callback_data: 'adm_to_start', style: 'danger' },
        ],
      ];

      await sendOrEdit(chatId, messageId, text, keyboard);
    };

    const renderChannelSetup = async (chatId, messageId = null) => {
      const cfg = await SettingsRepo.get();
      const fjBadge = cfg.forceJoinEnabled ? '🟢 ON' : '🔴 OFF';
      const urlText = resolveChannelUrl(cfg) || 'Not Set';

      const text =
        `📢 *CHANNEL / FORCE JOIN SETUP*\n\n` +
        `• *Status:* ${fjBadge}\n` +
        `• *Channel ID / Username:* \`${cfg.forceJoinChannel || 'Not Set'}\`\n` +
        `• *Join Link:* ${urlText}\n\n` +
        `⚠️ *Note:* Force Join kaam karne ke liye bot ko channel me *Admin* banayein.`;

      const keyboard = [
        [{ text: '📝 Set / Change Channel', callback_data: 'adm_set_channel', style: 'primary' }],
        [
          {
            text: cfg.forceJoinEnabled ? '🔴 Turn OFF Force Join' : '🟢 Turn ON Force Join',
            callback_data: 'adm_toggle_fj_from_ch',
            style: cfg.forceJoinEnabled ? 'danger' : 'success',
          },
        ],
        [{ text: '🔙 Back to Admin', callback_data: 'adm_home', style: 'danger' }],
      ];

      await sendOrEdit(chatId, messageId, text, keyboard);
    };

    const renderWalletUserPicker = async (chatId, messageId, mode) => {
      const isAdd = mode === 'add';
      const data = await WalletRepo.listUsers(1, 6);
      adminPending.set(String(chatId), { action: 'await_wallet_uid', mode });

      const text =
        `${isAdd ? '➕ *ADD WALLET BALANCE*' : '➖ *DEDUCT WALLET BALANCE*'}\n\n` +
        `Neeche kisi user par tap karein **YA** seedha chat me *Telegram User ID* bhejein:`;

      const rows = (data.users || []).map((u) => [
        {
          text: `👤 ${u.telegramUserId}  •  ₹${Number(u.balance || 0)}`,
          callback_data: `adm_w_user_${mode}_${u.telegramUserId}`,
          style: 'primary',
        },
      ]);
      rows.push([{ text: '🔙 Back to Admin', callback_data: 'adm_home', style: 'danger' }]);

      await sendOrEdit(chatId, messageId, text, rows);
    };

    const renderWalletAmountPicker = async (chatId, messageId, mode, targetUid) => {
      const isAdd = mode === 'add';
      const w = await WalletRepo.getWallet(targetUid);
      adminPending.set(String(chatId), { action: 'await_wallet_amount', mode, targetUid });

      const text =
        `${isAdd ? '➕ *ADD BALANCE*' : '➖ *DEDUCT BALANCE*'}\n\n` +
        `👤 *User ID:* \`${targetUid}\`\n` +
        `💰 *Current Balance:* ₹${Number(w?.balance || 0)}\n\n` +
        `Quick amount select karein **YA** chat me custom amount likh kar bhejein (e.g. \`35\`):`;

      const style = isAdd ? 'success' : 'danger';
      const sign = isAdd ? '+' : '-';
      const keyboard = [
        [
          { text: `${sign}₹10`, callback_data: `adm_w_amt_${mode}_${targetUid}_10`, style },
          { text: `${sign}₹20`, callback_data: `adm_w_amt_${mode}_${targetUid}_20`, style },
        ],
        [
          { text: `${sign}₹50`, callback_data: `adm_w_amt_${mode}_${targetUid}_50`, style },
          { text: `${sign}₹100`, callback_data: `adm_w_amt_${mode}_${targetUid}_100`, style },
        ],
        [{ text: '🔙 Cancel', callback_data: 'adm_home', style: 'primary' }],
      ];

      await sendOrEdit(chatId, messageId, text, keyboard);
    };

    const executeWalletAdjust = async (chatId, messageId, mode, targetUid, rawAmt) => {
      const amt = Math.abs(Number(rawAmt || 0));
      if (!amt || isNaN(amt)) {
        await tgApi('sendMessage', { chat_id: chatId, text: '❌ Invalid amount. Please enter a positive number.' });
        return;
      }
      const delta = mode === 'add' ? amt : -amt;
      const res = await WalletRepo.adminAdjustBalance(targetUid, delta, mode === 'add' ? 'Admin Credit' : 'Admin Debit');
      adminPending.delete(String(chatId));

      if (!res.success) {
        await sendOrEdit(chatId, messageId, `❌ Error: ${res.error}`, [[{ text: '🔙 Back', callback_data: 'adm_home', style: 'danger' }]]);
        return;
      }

      const verb = mode === 'add' ? 'Added' : 'Deducted';
      const emoji = mode === 'add' ? '✅' : '🔻';
      await sendOrEdit(
        chatId,
        messageId,
        `${emoji} *Wallet Updated!*\n\n• *User:* \`${targetUid}\`\n• *${verb}:* ₹${Math.abs(res.adjusted)}\n• *New Balance:* ₹${res.balance}`,
        [
          [{ text: mode === 'add' ? '➕ Add More' : '➖ Deduct More', callback_data: `adm_w_user_${mode}_${targetUid}`, style: mode === 'add' ? 'success' : 'danger' }],
          [{ text: '👑 Back to Admin Panel', callback_data: 'adm_home', style: 'primary' }],
        ]
      );

      // Notify target user if numeric Telegram ID
      if (/^\d+$/.test(String(targetUid)) && String(targetUid) !== String(chatId)) {
        const userMsg = mode === 'add'
          ? `💰 *Wallet Credited!*\nAdmin ne aapke wallet me *₹${Math.abs(res.adjusted)}* add kiye hain.\nNew Balance: *₹${res.balance}*`
          : `ℹ️ *Wallet Updated*\nAdmin ne aapke wallet se *₹${Math.abs(res.adjusted)}* deduct kiye hain.\nNew Balance: *₹${res.balance}*`;
        tgApi('sendMessage', { chat_id: targetUid, text: userMsg, parse_mode: 'Markdown' }).catch(() => {});
      }
    };

    const renderUsersStatus = async (chatId, messageId, page = 1) => {
      const data = await WalletRepo.listUsers(page, 6);
      const lines = await Promise.all(
        (data.users || []).map(async (u, idx) => {
          const accs = await AccountRepo.getAll(u.telegramUserId).catch(() => []);
          const num = (data.page - 1) * 6 + idx + 1;
          return `${num}. \`${u.telegramUserId}\` — 💰₹${Number(u.balance || 0)} | 📦${Number(u.totalOrders || 0)} | 📱${(accs || []).length} acc`;
        })
      );

      const text =
        `👥 *USERS STATUS* (Page ${data.page}/${data.totalPages})\n` +
        `Total Users: *${data.totalUsers}* | Total Bal: *₹${data.totalBalance}* | Orders: *${data.totalOrders}*\n\n` +
        (lines.length ? lines.join('\n') : '_No users recorded yet._');

      const navRow = [];
      if (data.page > 1) navRow.push({ text: '◀️ Prev', callback_data: `adm_users_${data.page - 1}`, style: 'primary' });
      if (data.page < data.totalPages) navRow.push({ text: 'Next ▶️', callback_data: `adm_users_${data.page + 1}`, style: 'primary' });

      const keyboard = [];
      if (navRow.length) keyboard.push(navRow);
      keyboard.push([{ text: '🔄 Refresh', callback_data: `adm_users_${data.page}`, style: 'success' }]);
      keyboard.push([{ text: '🔙 Back to Admin', callback_data: 'adm_home', style: 'danger' }]);

      await sendOrEdit(chatId, messageId, text, keyboard);
    };

    const renderFeeSettings = async (chatId, messageId) => {
      const cfg = await SettingsRepo.get();
      adminPending.set(String(chatId), { action: 'await_fees' });

      const text =
        `⚙️ *ORDER FEE & MIN DEPOSIT*\n\n` +
        `• *Current Order Fee:* ₹${cfg.orderFee}\n` +
        `• *Current Min Deposit:* ₹${cfg.minDeposit}\n\n` +
        `Preset chunein **YA** chat me \`<orderFee> <minDeposit>\` likh kar bhejein (e.g. \`3 15\`):`;

      const keyboard = [
        [
          { text: 'Free (₹0 / ₹15)', callback_data: 'adm_setfee_0_15', style: 'success' },
          { text: '₹3 / ₹15', callback_data: 'adm_setfee_3_15', style: 'primary' },
        ],
        [
          { text: '₹5 / ₹20', callback_data: 'adm_setfee_5_20', style: 'primary' },
          { text: '₹10 / ₹30', callback_data: 'adm_setfee_10_30', style: 'primary' },
        ],
        [{ text: '🔙 Back to Admin', callback_data: 'adm_home', style: 'danger' }],
      ];

      await sendOrEdit(chatId, messageId, text, keyboard);
    };

    // Commands
    bot.command('seturl', async (ctx) => {
      const uid = String(ctx.from?.id || '');
      if (!isAdminUser(uid)) return;
      const parts = (ctx.message?.text || '').split(' ');
      if (parts.length > 1 && parts[1].startsWith('http')) {
        currentWebAppUrl = parts[1].trim();
        await syncMenuButton(currentWebAppUrl);
        await tgApi('sendMessage', { chat_id: uid, text: `✅ WebApp URL updated to:\n${currentWebAppUrl}` });
      } else {
        await tgApi('sendMessage', { chat_id: uid, text: 'Usage: /seturl https://your-new-url' });
      }
    });

    bot.command('admin', async (ctx) => {
      const uid = String(ctx.from?.id || '');
      if (!isAdminUser(uid)) {
        await tgApi('sendMessage', { chat_id: uid, text: '❌ Admin access required.' });
        return;
      }
      adminPending.delete(uid);
      await renderAdminHome(uid);
    });

    bot.command('setfee', async (ctx) => {
      const uid = String(ctx.from?.id || '');
      if (!isAdminUser(uid)) return;
      const parts = (ctx.message?.text || '').trim().split(/\s+/);
      if (parts.length < 3 || isNaN(Number(parts[1])) || isNaN(Number(parts[2]))) {
        await renderFeeSettings(uid, null);
        return;
      }
      const updated = await SettingsRepo.update({ orderFee: Number(parts[1]), minDeposit: Number(parts[2]) });
      await tgApi('sendMessage', {
        chat_id: uid,
        text: `✅ Settings Updated!\n• Order Fee: ₹${updated.orderFee}\n• Min Deposit: ₹${updated.minDeposit}`,
      });
    });

    bot.command('start', async (ctx) => {
      const tgUid = String(ctx.from?.id || 'default');
      adminPending.delete(tgUid);
      const fc = await checkForceJoin(tgUid);
      if (!fc.joined) {
        await sendForceJoinPrompt(tgUid, null, fc.cfg, fc.channelUrl);
        return;
      }
      await sendStartMenu(tgUid, tgUid);
    });

    // Callback query router
    bot.on('callback_query', async (ctx) => {
      const cq = ctx.callbackQuery || ctx;
      const data = String(cq.data || '');
      const uid = String(cq.from?.id || ctx.from?.id || '');
      const chatId = String(cq.message?.chat?.id || uid);
      const messageId = cq.message?.message_id || null;

      try {
        if (data === 'fc_verify') {
          const fc = await checkForceJoin(uid);
          if (!fc.joined) {
            if (ctx.answerCallbackQuery) {
              await ctx.answerCallbackQuery({ text: '❌ Pehle channel join karein!', show_alert: true }).catch(() => {});
            }
            return;
          }
          await sendStartMenu(chatId, uid, messageId);
        } else if (data === 'view_accounts') {
          const accounts = await AccountRepo.getAll(uid);
          let text = '📱 *Saved Accounts:*\n\n';
          if (!accounts || accounts.length === 0) {
            text = '❌ No accounts saved yet. Open Toing Pro to add your first account.';
          } else {
            accounts.forEach((acc, i) => {
              text += `${i + 1}. +91 ${acc.phone} ${acc.isActive ? '⭐ *(Active)*' : ''}\n`;
            });
          }
          await tgApi('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
        } else if (data === 'tools_menu') {
          await tgApi('sendMessage', {
            chat_id: chatId,
            text: '⚡ *Tools Menu*\n\nPlease launch the Mini App using *🚀 Open Toing Pro* to access Referral Claimer, Scratch Cards, and Cart tools.',
            parse_mode: 'Markdown',
          });
        } else if (data.startsWith('adm_')) {
          if (!isAdminUser(uid)) {
            if (ctx.answerCallbackQuery) {
              await ctx.answerCallbackQuery({ text: '❌ Admin only', show_alert: true }).catch(() => {});
            }
            return;
          }

          if (data === 'adm_home') {
            adminPending.delete(uid);
            await renderAdminHome(chatId, messageId);
          } else if (data === 'adm_to_start') {
            adminPending.delete(uid);
            await sendStartMenu(chatId, uid, messageId);
          } else if (data === 'adm_channel') {
            adminPending.delete(uid);
            await renderChannelSetup(chatId, messageId);
          } else if (data === 'adm_toggle_fj' || data === 'adm_toggle_fj_from_ch') {
            const cur = await SettingsRepo.get();
            if (!cur.forceJoinEnabled && !cur.forceJoinChannel) {
              await renderChannelSetup(chatId, messageId);
            } else {
              await SettingsRepo.update({ forceJoinEnabled: !cur.forceJoinEnabled });
              if (data === 'adm_toggle_fj_from_ch') {
                await renderChannelSetup(chatId, messageId);
              } else {
                await renderAdminHome(chatId, messageId);
              }
            }
          } else if (data === 'adm_set_channel') {
            adminPending.set(uid, { action: 'await_channel' });
            await sendOrEdit(
              chatId,
              messageId,
              `📝 *SET FORCE JOIN CHANNEL*\n\nChat me apna channel bhejein:\n• Public channel: \`@mychannel\`\n• Private channel: \`-1001234567890 https://t.me/+InviteLink\`\n\n_(Bot ko channel me Admin banana na bhoolein)_`,
              [[{ text: '🔙 Cancel', callback_data: 'adm_channel', style: 'danger' }]]
            );
          } else if (data === 'adm_wallet_add') {
            await renderWalletUserPicker(chatId, messageId, 'add');
          } else if (data === 'adm_wallet_ded') {
            await renderWalletUserPicker(chatId, messageId, 'ded');
          } else if (data.startsWith('adm_w_user_')) {
            const parts = data.split('_'); // adm_w_user_<mode>_<targetUid>
            const mode = parts[3];
            const targetUid = parts.slice(4).join('_');
            await renderWalletAmountPicker(chatId, messageId, mode, targetUid);
          } else if (data.startsWith('adm_w_amt_')) {
            const parts = data.split('_'); // adm_w_amt_<mode>_<targetUid>_<amt>
            const mode = parts[3];
            const amt = parts[parts.length - 1];
            const targetUid = parts.slice(4, -1).join('_');
            await executeWalletAdjust(chatId, messageId, mode, targetUid, amt);
          } else if (data === 'adm_fees') {
            await renderFeeSettings(chatId, messageId);
          } else if (data.startsWith('adm_setfee_')) {
            const [, , fee, minDep] = data.split('_');
            adminPending.delete(uid);
            await SettingsRepo.update({ orderFee: Number(fee), minDeposit: Number(minDep) });
            await renderAdminHome(chatId, messageId);
          } else if (data.startsWith('adm_users_')) {
            adminPending.delete(uid);
            const page = Number(data.replace('adm_users_', '')) || 1;
            await renderUsersStatus(chatId, messageId, page);
          }
        }
      } catch (err) {
        console.error('[Telegram Bot Callback Error]:', err.message);
      }

      if (ctx.answerCallbackQuery) {
        await ctx.answerCallbackQuery().catch(() => {});
      }
    });

    // Interactive Admin text input handler
    bot.on('message', async (ctx) => {
      const msg = ctx.message || ctx;
      const text = String(msg.text || '').trim();
      const uid = String(msg.from?.id || ctx.from?.id || '');
      if (!text || text.startsWith('/') || !isAdminUser(uid)) return;

      const pending = adminPending.get(uid);
      if (!pending) return;

      try {
        if (pending.action === 'await_channel') {
          const parts = text.split(/\s+/);
          let ch = parts[0];
          let url = parts[1] || '';
          if (ch.startsWith('https://t.me/') && !ch.includes('+')) {
            const uname = ch.replace('https://t.me/', '').split('/')[0];
            url = ch;
            ch = `@${uname}`;
          } else if (ch.startsWith('@') && !url) {
            url = `https://t.me/${ch.slice(1)}`;
          }
          await SettingsRepo.update({ forceJoinChannel: ch, forceJoinUrl: url, forceJoinEnabled: true });
          adminPending.delete(uid);
          await renderChannelSetup(uid, null);
        } else if (pending.action === 'await_wallet_uid') {
          const targetUid = text.replace(/[^a-zA-Z0-9_-]/g, '');
          if (!targetUid) {
            await tgApi('sendMessage', { chat_id: uid, text: '❌ Invalid User ID. Please send a valid Telegram User ID.' });
            return;
          }
          await renderWalletAmountPicker(uid, null, pending.mode, targetUid);
        } else if (pending.action === 'await_wallet_amount') {
          await executeWalletAdjust(uid, null, pending.mode, pending.targetUid, text);
        } else if (pending.action === 'await_fees') {
          const parts = text.split(/\s+/);
          if (parts.length < 2 || isNaN(Number(parts[0])) || isNaN(Number(parts[1]))) {
            await tgApi('sendMessage', { chat_id: uid, text: '❌ Format: `<orderFee> <minDeposit>` (e.g. `3 15`)', parse_mode: 'Markdown' });
            return;
          }
          await SettingsRepo.update({ orderFee: Number(parts[0]), minDeposit: Number(parts[1]) });
          adminPending.delete(uid);
          await renderAdminHome(uid, null);
        }
      } catch (err) {
        console.error('[Telegram Bot Admin Input Error]:', err.message);
      }
    });

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
