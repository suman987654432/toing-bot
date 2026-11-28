const telegramModule = require('node-telegram-bot-api');
const BotClass = telegramModule.Bot || telegramModule;
const axios = require('axios');
const {
	AccountRepo
} = require('./models/Account');
const {
	WalletRepo
} = require('./models/Wallet');
const {
	SettingsRepo,
	isAdminUser
} = require('./models/Settings');
const BharatPeService = require('./services/bharatpeService');
const SwiggyService = require('./services/swiggyService');
let bot = null;
const adminPending = new Map(); // adminTgId -> { action, mode, targetUid }
const walletPending = new Map(); // tgUid -> { step: 'await_amount' }
const botDeposits = new Map(); // depId -> { uid, chatId, amount, createdAt }
const initBot = (webAppUrl) => {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	if (!token || token.trim() === '') {
		console.log('[Telegram Bot] TELEGRAM_BOT_TOKEN is not set in .env. Bot polling skipped.');
		console.log('[Telegram Bot] You can access the WebApp in browser at: ' + (webAppUrl || 'http://localhost:5000'));
		return null;
	}
	try {
		let currentWebAppUrl = webAppUrl || process.env.WEBAPP_URL || 'http://localhost:5000';
		const getLiveWebAppUrl = () => process.env.WEBAPP_URL || currentWebAppUrl;
		bot = new BotClass(token);
		const stripButtonStyles = (markup) => {
			if (!markup || !Array.isArray(markup.inline_keyboard)) return markup;
			return {
				...markup,
				inline_keyboard: markup.inline_keyboard.map((row) => row.map(({
					style,
					...rest
				}) => rest)),
			};
		};
		const tgApi = async (method, payload) => {
			try {
				const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, {
					timeout: 10000
				});
				return res.data;
			} catch (err) {
				if (err.response?.status === 400 && payload?.reply_markup?.inline_keyboard) {
					const fallback = {
						...payload,
						reply_markup: stripButtonStyles(payload.reply_markup)
					};
					const res2 = await axios.post(`https://api.telegram.org/bot${token}/${method}`, fallback, {
						timeout: 10000
					});
					return res2.data;
				}
				throw err;
			}
		};
		const sendOrEdit = async (chatId, messageId, text, inlineKeyboard, parseMode = 'Markdown') => {
			const reply_markup = {
				inline_keyboard: inlineKeyboard
			};
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
						web_app: {
							url
						},
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
				return {
					joined: true,
					cfg
				};
			}
			try {
				const res = await tgApi('getChatMember', {
					chat_id: cfg.forceJoinChannel,
					user_id: Number(uid) || uid,
				});
				const status = res?.result?.status;
				const isMember = ['member', 'administrator', 'creator'].includes(status) || (status === 'restricted' && res?.result?.is_member !== false);
				return {
					joined: Boolean(isMember),
					cfg,
					channelUrl: resolveChannelUrl(cfg)
				};
			} catch (e) {
				// If bot is not admin in channel or check fails, block only if channel is valid
				return {
					joined: false,
					cfg,
					channelUrl: resolveChannelUrl(cfg)
				};
			}
		};
		const sendForceJoinPrompt = async (chatId, messageId, cfg, channelUrl) => {
			const text = `🔒 *Channel Join Required*\n\n` + `Bot aur Mini App use karne ke liye pehle hamara official channel join karein:\n` + `📢 *Channel:* \`${cfg.forceJoinChannel}\`\n\n` + `Join karne ke baad neeche *✅ Maine Join Kar Liya* par tap karein.`;
			const rows = [];
			if (channelUrl) {
				rows.push([{
					text: '📢 Join Channel',
					url: channelUrl,
					style: 'primary'
				}]);
			}
			rows.push([{
				text: '✅ Maine Join Kar Liya',
				callback_data: 'fc_verify',
				style: 'success'
			}]);
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
			const welcomeText = `🚀 *WELCOME TO TOING PRO ORDER BOT !*\n\n` + `YOU CAN USE WEB MINI FOR ORDERS.\n\n` + `📊 *STATS*\n` + `• *TOTAL ACCOUNTS* : ${totalAccounts}\n` + `• *TOTAL ORDERS* : ${totalOrders}\n` + `• *BALANCE* : ₹${balance}\n` + `• *ORDER FEES* : ₹${orderFee}`;
			const keyboard = [
				[{
					text: '🚀 Open Toing Pro',
					web_app: {
						url: getLiveWebAppUrl()
					},
					style: 'success'
				}],
				[{
					text: '👥 Saved Accounts',
					callback_data: 'view_accounts',
					style: 'primary'
				}, {
					text: '⚡ Tools & Claims',
					callback_data: 'tools_menu',
					style: 'primary'
				}, ],
				[{
					text: '👛 Wallet',
					callback_data: 'wallet_home',
					style: 'primary'
				}, {
					text: '🛒 Buy Account',
					url: 'https://t.me/CodeAddabot',
					style: 'primary'
				}, ],
				[{
					text: '💬 Support',
					url: 'https://t.me/Shein_supportbot',
					style: 'primary'
				}],
			];
			if (isAdminUser(tgUid)) {
				keyboard.push([{
					text: '👑 Admin Panel',
					callback_data: 'adm_home',
					style: 'danger'
				}]);
			}
			await sendOrEdit(chatId, messageId, welcomeText, keyboard);
		};
		const sendTrackOrderCard = async (chatId, tgUid, orderId, messageId = null) => {
			try {
				let acc = await AccountRepo.getActive(tgUid);
				if (!acc || (!acc.tid && !acc.token)) {
					const allAccs = await AccountRepo.getAll(tgUid);
					acc = (allAccs || []).find((a) => a.tid || a.token) || acc;
				}
				let ord = null;
				let track = null;
				if (acc && (acc.tid || acc.token)) {
					try {
						const sRes = await SwiggyService.getSingleOrder(orderId, acc.tid, acc.token);
						ord = sRes.data?.data?.orders?.[0] || sRes.data?.data || null;
					} catch (e) {}
					try {
						const tRes = await SwiggyService.getTrackCard(orderId, acc.tid, acc.token);
						track = tRes.data?.data || tRes.data || null;
					} catch (e) {}
				}
				const status = String(track?.order_status || ord?.order_status || 'CHECKING').replace(/_/g, ' ').toUpperCase();
				const restName = ord?.restaurant_name || 'Toing Order';
				const total = ord?.order_total ?? ord?.net_total ?? '';
				const statusMsg = track?.message || track?.statusMessage || '';
				const ordDp = ord?.delivery_boy || {};
				const trackDp = track?.delivery_boy || track?.de_details || {};
				const dpName = ordDp.name || trackDp.name || '';
				const dpPhone = ordDp.mobile || ordDp.phone || trackDp.mobile || trackDp.phone || '';
				const dpLine = dpName ? `${dpName}${dpPhone ? ` (\`${dpPhone}\`)` : ''}` : (status === 'DELIVERED' ? 'Delivered' : 'Assigning partner...');
				const items = ord?.order_items || ord?.items || [];
				const itemLines = items.slice(0, 8).map((it) => `• ${it.name} × ${it.quantity || 1}`).join('\n');
				let text = `🛵 *LIVE ORDER TRACKING*\n\n` + `🆔 *Order ID:* \`#${orderId}\`\n` + `🍽 *Restaurant:* ${restName}\n` + `📍 *Status:* *${status}*\n` + `🚴 *Delivery Partner:* ${dpLine}\n`;
				if (total !== '') text += `💰 *Total:* ₹${total}\n`;
				if (statusMsg) text += `\n💬 _${statusMsg}_\n`;
				if (itemLines) text += `\n📦 *Items:*\n${itemLines}\n`;
				if (!acc || (!acc.tid && !acc.token)) {
					text += `\n⚠️ _Account session login nahi mila — live status ke liye Mini App me account login karein._`;
				}
				const liveBase = getLiveWebAppUrl();
				const trackMiniAppUrl = `${liveBase}${liveBase.includes('?') ? '&' : '?'}track=${encodeURIComponent(orderId)}`;
				const rawOfoToken = ord?.ofo_token
					|| ord?.user_flow_info?.flow_data?.message_id
					|| ord?.message_id;
				const isToken = rawOfoToken && !/^\d{14,18}$/.test(String(rawOfoToken).trim());
				const ofoToken = isToken ? String(rawOfoToken).trim() : null;
				const toingTrackUrl = (ord?.ofo_tracking_url && !/\/toing\/ofo\/track\/\d{14,18}/.test(ord.ofo_tracking_url))
					? ord.ofo_tracking_url
					: (ofoToken ? `https://www.swiggy.com/toing/ofo/track/${ofoToken}` : `https://www.swiggy.com/track-order/${orderId}`);
				const trackBtnText = ofoToken ? '🌐 Toing Tracking Link' : '🌐 Swiggy Tracking Link';
				const keyboard = [
					[{
						text: '🔄 Refresh Status',
						callback_data: `track_ref_${orderId}`,
						style: 'primary'
					}, {
						text: '🚀 Open in Mini App',
						web_app: {
							url: trackMiniAppUrl
						},
						style: 'success'
					}],
					[{
						text: trackBtnText,
						url: toingTrackUrl
					}],
					[{
						text: '🏠 Main Menu',
						callback_data: 'wallet_back_start',
						style: 'primary'
					}],
				];
				await sendOrEdit(chatId, messageId, text, keyboard);
			} catch (e) {
				await sendOrEdit(chatId, messageId, `❌ Tracking fetch karne me error aaya: ${e.message}`, [
					[{
						text: '🔄 Retry',
						callback_data: `track_ref_${orderId}`,
						style: 'primary'
					}],
					[{
						text: '🏠 Main Menu',
						callback_data: 'wallet_back_start',
						style: 'primary'
					}],
				]);
			}
		};
		const renderWalletHome = async (chatId, uid, messageId = null) => {
			const [wallet, txns, cfg] = await Promise.all([
				WalletRepo.getWallet(uid),
				WalletRepo.getTransactions(uid, 5),
				SettingsRepo.get(),
			]);
			const balance = Number(wallet?.balance || 0);
			const totalDeposits = Number(wallet?.totalDeposited || 0);
			const orderFee = Number(cfg?.orderFee ?? 3);
			let txnLines = 'NO TRANSACTIONS YET';
			if (txns && txns.length > 0) {
				txnLines = txns.map((t) => {
					const sign = t.type === 'CREDIT' ? '+' : '-';
					return `• ${sign}₹${t.amount} — ${t.description || t.type}`;
				}).join('\n');
			}
			const text = `👛 *WALLET*\n\n` + `*BALANCE* : ₹${balance}\n` + `*TOTAL DEPOSITS* : ₹${totalDeposits}\n` + `*ORDER FEES* : ₹${orderFee}\n\n` + `*RECENT TRANSACTIONS*\n${txnLines}`;
			const keyboard = [
				[{
					text: '⬅️ BACK',
					callback_data: 'wallet_back_start',
					style: 'primary'
				}, {
					text: '💰 DEPOSIT',
					callback_data: 'wallet_deposit',
					style: 'success'
				}, ],
			];
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const renderDepositPrompt = async (chatId, uid, messageId = null) => {
			const cfg = await SettingsRepo.get();
			const orderFee = Number(cfg?.orderFee ?? 3);
			const minDeposit = Number(cfg?.minDeposit ?? 15);
			walletPending.set(uid, {
				step: 'await_amount'
			});
			const text = `💰 *DEPOSIT*\n\n` + `*ORDER FEES* : ₹${orderFee} PER ORDER\n` + `*MINIMUM DEPOSIT* : ₹${minDeposit}\n\n` + `SEND THE AMOUNT YOU WANT TO DEPOSIT :`;
			const keyboard = [
				[{
					text: '⬅️ BACK',
					callback_data: 'wallet_home',
					style: 'primary'
				}],
			];
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const renderAdminHome = async (chatId, messageId = null) => {
			const [cfg, summary] = await Promise.all([
				SettingsRepo.get(),
				WalletRepo.listUsers(1, 1),
			]);
			const fjBadge = cfg.forceJoinEnabled ? '🟢 ON' : '🔴 OFF';
			const fjBtnStyle = cfg.forceJoinEnabled ? 'success' : 'danger';
			const chText = cfg.forceJoinChannel || 'Not Set';
			const text = `👑 *TOING PRO — ADMIN PANEL*\n\n` + `👥 *Total Users:* ${summary.totalUsers}\n` + `💰 *Total Wallet Balance:* ₹${summary.totalBalance}\n` + `📦 *Total Orders:* ${summary.totalOrders}\n\n` + `⚙️ *Order Fee:* ₹${cfg.orderFee}  |  *Min Deposit:* ₹${cfg.minDeposit}\n` + `📢 *Force Join:* ${fjBadge} (\`${chText}\`)`;
			const keyboard = [
				[{
					text: '📢 Channel Setup',
					callback_data: 'adm_channel',
					style: 'primary'
				}, {
					text: `Force Join: ${fjBadge}`,
					callback_data: 'adm_toggle_fj',
					style: fjBtnStyle
				}, ],
				[{
					text: '➕ Add Wallet ₹',
					callback_data: 'adm_wallet_add',
					style: 'success'
				}, {
					text: '➖ Deduct Wallet ₹',
					callback_data: 'adm_wallet_ded',
					style: 'danger'
				}, ],
				[{
					text: '⚙️ Fee & Min Deposit',
					callback_data: 'adm_fees',
					style: 'primary'
				}, {
					text: '👥 Users Status',
					callback_data: 'adm_users_1',
					style: 'primary'
				}, ],
				[{
					text: '📢 Broadcast',
					callback_data: 'adm_broadcast',
					style: 'primary'
				}, ],
				[{
					text: '🔄 Refresh',
					callback_data: 'adm_home',
					style: 'primary'
				}, {
					text: '🔙 Main Menu',
					callback_data: 'adm_to_start',
					style: 'danger'
				}, ],
			];
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const renderChannelSetup = async (chatId, messageId = null) => {
			const cfg = await SettingsRepo.get();
			const fjBadge = cfg.forceJoinEnabled ? '🟢 ON' : '🔴 OFF';
			const urlText = resolveChannelUrl(cfg) || 'Not Set';
			const text = `📢 *CHANNEL / FORCE JOIN SETUP*\n\n` + `• *Status:* ${fjBadge}\n` + `• *Channel ID / Username:* \`${cfg.forceJoinChannel || 'Not Set'}\`\n` + `• *Join Link:* ${urlText}\n\n` + `⚠️ *Note:* Force Join kaam karne ke liye bot ko channel me *Admin* banayein.`;
			const keyboard = [
				[{
					text: '📝 Set / Change Channel',
					callback_data: 'adm_set_channel',
					style: 'primary'
				}],
				[{
					text: cfg.forceJoinEnabled ? '🔴 Turn OFF Force Join' : '🟢 Turn ON Force Join',
					callback_data: 'adm_toggle_fj_from_ch',
					style: cfg.forceJoinEnabled ? 'danger' : 'success',
				}, ],
				[{
					text: '🔙 Back to Admin',
					callback_data: 'adm_home',
					style: 'danger'
				}],
			];
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const renderWalletUserPicker = async (chatId, messageId, mode) => {
			const isAdd = mode === 'add';
			const data = await WalletRepo.listUsers(1, 6);
			adminPending.set(String(chatId), {
				action: 'await_wallet_uid',
				mode
			});
			const text = `${isAdd ? '➕ *ADD WALLET BALANCE*' : '➖ *DEDUCT WALLET BALANCE*'}\n\n` + `Neeche kisi user par tap karein **YA** seedha chat me *Telegram User ID* bhejein:`;
			const rows = (data.users || []).map((u) => [{
				text: `👤 ${u.telegramUserId}  •  ₹${Number(u.balance || 0)}`,
				callback_data: `adm_w_user_${mode}_${u.telegramUserId}`,
				style: 'primary',
			}, ]);
			rows.push([{
				text: '🔙 Back to Admin',
				callback_data: 'adm_home',
				style: 'danger'
			}]);
			await sendOrEdit(chatId, messageId, text, rows);
		};
		const renderWalletAmountPicker = async (chatId, messageId, mode, targetUid) => {
			const isAdd = mode === 'add';
			const w = await WalletRepo.getWallet(targetUid);
			adminPending.set(String(chatId), {
				action: 'await_wallet_amount',
				mode,
				targetUid
			});
			const text = `${isAdd ? '➕ *ADD BALANCE*' : '➖ *DEDUCT BALANCE*'}\n\n` + `👤 *User ID:* \`${targetUid}\`\n` + `💰 *Current Balance:* ₹${Number(w?.balance || 0)}\n\n` + `Quick amount select karein **YA** chat me custom amount likh kar bhejein (e.g. \`35\`):`;
			const style = isAdd ? 'success' : 'danger';
			const sign = isAdd ? '+' : '-';
			const keyboard = [
				[{
					text: `${sign}₹15`,
					callback_data: `adm_w_amt_${mode}_${targetUid}_15`,
					style
				}, {
					text: `${sign}₹20`,
					callback_data: `adm_w_amt_${mode}_${targetUid}_20`,
					style
				}, ],
				[{
					text: `${sign}₹60`,
					callback_data: `adm_w_amt_${mode}_${targetUid}_60`,
					style
				}, {
					text: `${sign}₹100`,
					callback_data: `adm_w_amt_${mode}_${targetUid}_100`,
					style
				}, ],
				[{
					text: '🔙 Cancel',
					callback_data: 'adm_home',
					style: 'primary'
				}],
			];
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const executeWalletAdjust = async (chatId, messageId, mode, targetUid, rawAmt) => {
			const amt = Math.abs(Number(rawAmt || 0));
			if (!amt || isNaN(amt)) {
				await tgApi('sendMessage', {
					chat_id: chatId,
					text: '❌ Invalid amount. Please enter a positive number.'
				});
				return;
			}
			const delta = mode === 'add' ? amt : -amt;
			const res = await WalletRepo.adminAdjustBalance(targetUid, delta, mode === 'add' ? 'Admin Credit' : 'Admin Debit');
			adminPending.delete(String(chatId));
			if (!res.success) {
				await sendOrEdit(chatId, messageId, `❌ Error: ${res.error}`, [
					[{
						text: '🔙 Back',
						callback_data: 'adm_home',
						style: 'danger'
					}]
				]);
				return;
			}
			const verb = mode === 'add' ? 'Added' : 'Deducted';
			const emoji = mode === 'add' ? '✅' : '🔻';
			await sendOrEdit(chatId, messageId, `${emoji} *Wallet Updated!*\n\n• *User:* \`${targetUid}\`\n• *${verb}:* ₹${Math.abs(res.adjusted)}\n• *New Balance:* ₹${res.balance}`,
				[
					[{
						text: mode === 'add' ? '➕ Add More' : '➖ Deduct More',
						callback_data: `adm_w_user_${mode}_${targetUid}`,
						style: mode === 'add' ? 'success' : 'danger'
					}],
					[{
						text: '👑 Back to Admin Panel',
						callback_data: 'adm_home',
						style: 'primary'
					}],
				]);
			// Notify target user if numeric Telegram ID
			if (/^\d+$/.test(String(targetUid)) && String(targetUid) !== String(chatId)) {
				const userMsg = mode === 'add' ? `💰 *Wallet Credited!*\nAdmin ne aapke wallet me *₹${Math.abs(res.adjusted)}* add kiye hain.\nNew Balance: *₹${res.balance}*` : `ℹ️ *Wallet Updated*\nAdmin ne aapke wallet se *₹${Math.abs(res.adjusted)}* deduct kiye hain.\nNew Balance: *₹${res.balance}*`;
				tgApi('sendMessage', {
					chat_id: targetUid,
					text: userMsg,
					parse_mode: 'Markdown'
				}).catch(() => {});
			}
		};
		const renderUsersStatus = async (chatId, messageId, page = 1) => {
			const data = await WalletRepo.listUsers(page, 6, true);
			const userButtons = [];
			const lines = await Promise.all(
				(data.users || []).map(async (u, idx) => {
					const [accs, rep] = await Promise.all([
						AccountRepo.getAll(u.telegramUserId).catch(() => []),
						WalletRepo.getUserReport(u.telegramUserId).catch(() => null),
					]);
					const num = (data.page - 1) * 6 + idx + 1;
					const dep = rep ? rep.totalDeposited : Number(u.totalDeposited || 0);
					const spent = rep ? rep.totalSpent : 0;
					const latestUtr = rep?.deposits?.find((d) => d.utr)?.utr || '';
					userButtons.push({
						text: `🔍 ${num}. ${u.telegramUserId}`,
						callback_data: `adm_u_${u.telegramUserId}`,
						style: 'primary',
					});
					return (`${num}. \`${u.telegramUserId}\` — 💰Bal: *₹${Number(u.balance || 0)}* | 📥Dep: *₹${dep}* | 💸Spent: *₹${spent}* | 📦${Number(u.totalOrders || 0)} | 📱${(accs || []).length}` + (latestUtr ? `\n   🧾 Last UTR: \`${latestUtr}\`` : ''));
				}));
			const text = `👥 *ACTIVE / ORDERED USERS* (Page ${data.page}/${data.totalPages})\n` + `Showing: *${data.filteredCount}* / ${data.totalUsers} Users | Bal: *₹${data.totalBalance}* | Orders: *${data.totalOrders}*\n\n` + (lines.length ? lines.join('\n') : '_No active/ordered users yet._') + `\n\n_Tap any user or click Search User ID below._`;
			const navRow = [];
			if (data.page > 1) navRow.push({
				text: '◀️ Prev',
				callback_data: `adm_users_${data.page - 1}`,
				style: 'primary'
			});
			if (data.page < data.totalPages) navRow.push({
				text: 'Next ▶️',
				callback_data: `adm_users_${data.page + 1}`,
				style: 'primary'
			});
			const keyboard = [];
			for (let i = 0; i < userButtons.length; i += 2) {
				keyboard.push(userButtons.slice(i, i + 2));
			}
			if (navRow.length) keyboard.push(navRow);
			keyboard.push([{
				text: '🔎 Search User ID',
				callback_data: 'adm_search_user',
				style: 'primary'
			}, {
				text: '🔄 Refresh',
				callback_data: `adm_users_${data.page}`,
				style: 'success'
			}, ]);
			keyboard.push([{
				text: '🔙 Back to Admin',
				callback_data: 'adm_home',
				style: 'danger'
			}]);
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const renderUserDetail = async (chatId, messageId, targetUid) => {
			const [rep, accs] = await Promise.all([
				WalletRepo.getUserReport(targetUid),
				AccountRepo.getAll(targetUid).catch(() => []),
			]);
			const depLines = rep.deposits.slice(0, 8).map((d, i) => {
				const dt = d.createdAt ? new Date(d.createdAt).toLocaleString('en-IN', {
					timeZone: 'Asia/Kolkata',
					day: '2-digit',
					month: '2-digit',
					hour: '2-digit',
					minute: '2-digit'
				}) : '';
				const utrTxt = d.utr ? `UTR: \`${d.utr}\`` : (d.description || 'Admin Credit');
				return `${i + 1}. +₹${d.amount} — ${utrTxt}${dt ? ` (${dt})` : ''}`;
			});
			const spentLines = rep.debits.slice(0, 8).map((d, i) => {
				const dt = d.createdAt ? new Date(d.createdAt).toLocaleString('en-IN', {
					timeZone: 'Asia/Kolkata',
					day: '2-digit',
					month: '2-digit',
					hour: '2-digit',
					minute: '2-digit'
				}) : '';
				const ordTxt = d.orderId ? `Order \`#${d.orderId}\`` : (d.description || 'Debit');
				return `${i + 1}. −₹${d.amount} — ${ordTxt}${dt ? ` (${dt})` : ''}`;
			});
			const text = `👤 *USER WALLET & UTR DETAILS*\n` + `• *User ID:* \`${rep.telegramUserId}\`\n` + `• *Balance:* ₹${rep.balance}\n` + `• *Total Deposited:* ₹${rep.totalDeposited}\n` + `• *Total Spent (Fees):* ₹${rep.totalSpent}\n` + `• *Total Orders:* ${rep.totalOrders} | *Accounts:* ${(accs || []).length}\n\n` + `📥 *DEPOSITS & UTRs:*\n${depLines.length ? depLines.join('\n') : '_No deposits yet._'}\n\n` + `💸 *SPENT / ORDER FEES:*\n${spentLines.length ? spentLines.join('\n') : '_No orders/debits yet._'}`;
			const keyboard = [
				[{
					text: '🔄 Refresh',
					callback_data: `adm_u_${rep.telegramUserId}`,
					style: 'success'
				}, {
					text: '👥 All Users',
					callback_data: 'adm_users_1',
					style: 'primary'
				}, ],
				[{
					text: '🔙 Back to Admin',
					callback_data: 'adm_home',
					style: 'danger'
				}],
			];
			await sendOrEdit(chatId, messageId, text, keyboard);
		};
		const renderFeeSettings = async (chatId, messageId) => {
			const cfg = await SettingsRepo.get();
			adminPending.set(String(chatId), {
				action: 'await_fees'
			});
			const text = `⚙️ *ORDER FEE & MIN DEPOSIT*\n\n` + `• *Current Order Fee:* ₹${cfg.orderFee}\n` + `• *Current Min Deposit:* ₹${cfg.minDeposit}\n\n` + `Preset chunein **YA** chat me \`<orderFee> <minDeposit>\` likh kar bhejein (e.g. \`3 15\`):`;
			const keyboard = [
				[{
					text: 'Free (₹0 / ₹15)',
					callback_data: 'adm_setfee_0_15',
					style: 'success'
				}, {
					text: '₹3 / ₹15',
					callback_data: 'adm_setfee_3_15',
					style: 'primary'
				}, ],
				[{
					text: '₹5 / ₹20',
					callback_data: 'adm_setfee_5_20',
					style: 'primary'
				}, {
					text: '₹10 / ₹30',
					callback_data: 'adm_setfee_10_30',
					style: 'primary'
				}, ],
				[{
					text: '🔙 Back to Admin',
					callback_data: 'adm_home',
					style: 'danger'
				}],
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
				await tgApi('sendMessage', {
					chat_id: uid,
					text: `✅ WebApp URL updated to:\n${currentWebAppUrl}`
				});
			} else {
				await tgApi('sendMessage', {
					chat_id: uid,
					text: 'Usage: /seturl https://your-new-url'
				});
			}
		});
		bot.command('admin', async (ctx) => {
			const uid = String(ctx.from?.id || '');
			if (!isAdminUser(uid)) {
				await tgApi('sendMessage', {
					chat_id: uid,
					text: '❌ Admin access required.'
				});
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
			const updated = await SettingsRepo.update({
				orderFee: Number(parts[1]),
				minDeposit: Number(parts[2])
			});
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
			const rawText = String(ctx.message?.text || '');
			const startParam = String(ctx.match || rawText.split(/\s+/)[1] || '').trim();
			if (startParam.startsWith('track_')) {
				const trackOrderId = startParam.slice('track_'.length).trim();
				if (trackOrderId) {
					await sendTrackOrderCard(tgUid, tgUid, trackOrderId);
					return;
				}
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
							await ctx.answerCallbackQuery({
								text: '❌ Pehle channel join karein!',
								show_alert: true
							}).catch(() => {});
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
					await tgApi('sendMessage', {
						chat_id: chatId,
						text,
						parse_mode: 'Markdown'
					});
				} else if (data === 'wallet_home') {
					walletPending.delete(uid);
					await renderWalletHome(chatId, uid, messageId);
				} else if (data === 'wallet_back_start') {
					walletPending.delete(uid);
					await sendStartMenu(chatId, uid, messageId);
				} else if (data.startsWith('track_ref_')) {
					const trackOrderId = data.slice('track_ref_'.length).trim();
					if (trackOrderId) {
						await sendTrackOrderCard(chatId, uid, trackOrderId, messageId);
					}
					if (ctx.answerCallbackQuery) {
						await ctx.answerCallbackQuery({
							text: '🔄 Status updated!'
						}).catch(() => {});
					}
				} else if (data === 'wallet_deposit') {
					await renderDepositPrompt(chatId, uid, messageId);
				} else if (data.startsWith('dep_can_')) {
					const depId = data.slice('dep_can_'.length);
					botDeposits.delete(depId);
					if (messageId) {
						await tgApi('deleteMessage', {
							chat_id: chatId,
							message_id: messageId
						}).catch(() => {});
					}
					await renderWalletHome(chatId, uid, null);
				} else if (data.startsWith('dep_chk_')) {
					const depId = data.slice('dep_chk_'.length);
					const session = botDeposits.get(depId);
					if (!session) {
						if (ctx.answerCallbackQuery) {
							await ctx.answerCallbackQuery({
								text: '❌ Deposit session expired. Generate a new QR.',
								show_alert: true
							}).catch(() => {});
						}
						return;
					}
					const bpRes = await BharatPeService.fetchTransactions(2);
					if (!bpRes.success) {
						if (ctx.answerCallbackQuery) {
							await ctx.answerCallbackQuery({
								text: `⚠️ ${bpRes.error || 'BharatPe API error'}`,
								show_alert: true
							}).catch(() => {});
						}
						return;
					}
					let matched = null;
					for (const t of (bpRes.transactions || [])) {
						if (t.status === 'SUCCESS' && t.type === 'PAYMENT_RECV' && Number(t.amount) === Number(session.amount) && Number(t.paymentTimestamp || 0) >= session.createdAt - 15000) {
							const already = await WalletRepo.isUtrClaimed(t.bankReferenceNo);
							if (!already) {
								matched = t;
								break;
							}
						}
					}
					if (!matched) {
						if (ctx.answerCallbackQuery) {
							await ctx.answerCallbackQuery({
								text: `⏳ Payment not received yet. Pay exact ₹${session.amount} and tap Check Payment again.`,
								show_alert: true
							}).catch(() => {});
						}
						return;
					}
					const creditRes = await WalletRepo.creditByUtr(uid, Number(matched.amount), String(matched.bankReferenceNo), `BharatPe Deposit (${depId})`);
					if (!creditRes.success) {
						if (ctx.answerCallbackQuery) {
							await ctx.answerCallbackQuery({
								text: `❌ ${creditRes.error}`,
								show_alert: true
							}).catch(() => {});
						}
						return;
					}
					botDeposits.delete(depId);
					if (ctx.answerCallbackQuery) {
						await ctx.answerCallbackQuery({
							text: `✅ ₹${matched.amount} added to wallet!`
						}).catch(() => {});
					}
					if (messageId) {
						await tgApi('deleteMessage', {
							chat_id: chatId,
							message_id: messageId
						}).catch(() => {});
					}
					await tgApi('sendMessage', {
						chat_id: chatId,
						text: `✅ <b>DEPOSIT CONFIRMED!</b>\n\n• <b>AMOUNT</b> : ₹${matched.amount}\n• <b>ORDER ID</b> : <code>${depId}</code>\n• <b>UTR</b> : <code>${matched.bankReferenceNo}</code>\n• <b>NEW BALANCE</b> : ₹${creditRes.balance}`,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[{
									text: '🚀 Open Toing Pro',
									web_app: {
										url: currentWebAppUrl
									},
									style: 'success'
								}],
								[{
									text: '👛 Wallet',
									callback_data: 'wallet_home',
									style: 'primary'
								}],
							],
						},
					});
				} else if (data === 'tools_menu') {
					await tgApi('sendMessage', {
						chat_id: chatId,
						text: '⚡ *Tools Menu*\n\nPlease launch the Mini App using *🚀 Open Toing Pro* to access Referral Claimer, Scratch Cards, and Cart tools.',
						parse_mode: 'Markdown',
					});
				} else if (data.startsWith('adm_')) {
					if (!isAdminUser(uid)) {
						if (ctx.answerCallbackQuery) {
							await ctx.answerCallbackQuery({
								text: '❌ Admin only',
								show_alert: true
							}).catch(() => {});
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
							await SettingsRepo.update({
								forceJoinEnabled: !cur.forceJoinEnabled
							});
							if (data === 'adm_toggle_fj_from_ch') {
								await renderChannelSetup(chatId, messageId);
							} else {
								await renderAdminHome(chatId, messageId);
							}
						}
					} else if (data === 'adm_set_channel') {
						adminPending.set(uid, {
							action: 'await_channel'
						});
						await sendOrEdit(chatId, messageId, `📝 *SET FORCE JOIN CHANNEL*\n\nChat me apna channel bhejein:\n• Public channel: \`@mychannel\`\n• Private channel: \`-1001234567890 https://t.me/+InviteLink\`\n\n_(Bot ko channel me Admin banana na bhoolein)_`,
							[
								[{
									text: '🔙 Cancel',
									callback_data: 'adm_channel',
									style: 'danger'
								}]
							]);
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
						await SettingsRepo.update({
							orderFee: Number(fee),
							minDeposit: Number(minDep)
						});
						await renderAdminHome(chatId, messageId);
					} else if (data === 'adm_broadcast') {
						const ids = await WalletRepo.getAllUserIds();
						adminPending.set(uid, {
							action: 'await_broadcast'
						});
						await sendOrEdit(chatId, messageId, `📢 *BROADCAST MESSAGE*\n\nTotal Bot Users: *${ids.length}*\n\nAb woh message bhejein (Text, Photo, Video, ya Forward) jo aap sabhi users ko bhejna chahte hain:`, [
							[{
								text: '🔙 Cancel',
								callback_data: 'adm_home',
								style: 'danger'
							}]
						]);
					} else if (data === 'adm_search_user') {
						adminPending.set(uid, {
							action: 'await_user_search'
						});
						await sendOrEdit(chatId, messageId, '🔎 *SEARCH USER BY ID*\n\nTelegram User ID bhejein (e.g. `1649428638`):', [
							[{
								text: '🔙 Back to Users',
								callback_data: 'adm_users_1',
								style: 'danger'
							}],
						]);
					} else if (data.startsWith('adm_users_')) {
						adminPending.delete(uid);
						const page = Number(data.replace('adm_users_', '')) || 1;
						await renderUsersStatus(chatId, messageId, page);
					} else if (data.startsWith('adm_u_')) {
						adminPending.delete(uid);
						const targetUid = data.slice('adm_u_'.length);
						await renderUserDetail(chatId, messageId, targetUid);
					}
				}
			} catch (err) {
				console.error('[Telegram Bot Callback Error]:', err.message);
			}
			if (ctx.answerCallbackQuery) {
				await ctx.answerCallbackQuery().catch(() => {});
			}
		});
		// Interactive Wallet Deposit + Admin text input handler
		bot.on('message', async (ctx) => {
			const msg = ctx.message || ctx;
			const text = String(msg.text || '').trim();
			const uid = String(msg.from?.id || ctx.from?.id || '');
			const chatId = String(msg.chat?.id || uid);
			if (text.startsWith('/')) return;

			const admPending = isAdminUser(uid) ? adminPending.get(uid) : null;
			if (admPending && admPending.action === 'await_broadcast' && msg.message_id) {
				adminPending.delete(uid);
				const broadcastMsgId = msg.message_id;
				(async () => {
					try {
						const ids = await WalletRepo.getAllUserIds();
						await tgApi('sendMessage', {
							chat_id: chatId,
							text: `⏳ Broadcasting in background to *${ids.length}* users... (Bot fast rahega!)`,
							parse_mode: 'Markdown'
						});
						let sent = 0;
						let failed = 0;
						const BATCH_SIZE = 15;
						for (let i = 0; i < ids.length; i += BATCH_SIZE) {
							const batch = ids.slice(i, i + BATCH_SIZE);
							await Promise.all(batch.map(async (targetId) => {
								try {
									await tgApi('copyMessage', {
										chat_id: targetId,
										from_chat_id: chatId,
										message_id: broadcastMsgId,
									});
									sent++;
								} catch (e) {
									const retryAfter = e?.response?.data?.parameters?.retry_after;
									if (retryAfter) {
										await new Promise((r) => setTimeout(r, (Number(retryAfter) + 1) * 1000));
										try {
											await tgApi('copyMessage', {
												chat_id: targetId,
												from_chat_id: chatId,
												message_id: broadcastMsgId,
											});
											sent++;
											return;
										} catch (e2) {}
									}
									failed++;
								}
							}));
							if (i + BATCH_SIZE < ids.length) {
								await new Promise((r) => setTimeout(r, 550));
							}
						}
						await tgApi('sendMessage', {
							chat_id: chatId,
							text: `✅ *BROADCAST COMPLETE!*\n\n• *Total Users:* ${ids.length}\n• *Sent:* ${sent}\n• *Failed / Blocked:* ${failed}`,
							parse_mode: 'Markdown',
							reply_markup: {
								inline_keyboard: [[{ text: '🔙 Admin Panel', callback_data: 'adm_home', style: 'primary' }]]
							}
						});
					} catch (err) {
						console.error('[Telegram Bot Broadcast Error]:', err.message);
						await tgApi('sendMessage', { chat_id: chatId, text: '❌ Broadcast failed: ' + err.message }).catch(() => {});
					}
				})();
				return;
			}

			if (!text) return;
			const wPending = walletPending.get(uid);
			if (wPending && wPending.step === 'await_amount') {
				try {
					const cfg = await SettingsRepo.get();
					const minDeposit = Number(cfg?.minDeposit ?? 15);
					const amt = Math.round(Number(text));
					if (!amt || isNaN(amt) || amt < minDeposit) {
						await tgApi('sendMessage', {
							chat_id: chatId,
							text: `❌ Minimum deposit is ₹${minDeposit}. Please send a valid amount (e.g. ${minDeposit}).`,
						});
						return;
					}
					walletPending.delete(uid);
					const depId = 'DEP' + Date.now() + Math.random().toString(16).slice(2, 8).toUpperCase();
					const {
						upiUri,
						qrUrl
					} = BharatPeService.buildUpiPayment(amt, depId);
					if (!upiUri || !qrUrl) {
						await tgApi('sendMessage', {
							chat_id: chatId,
							text: '❌ BharatPe UPI ID is not configured on server.'
						});
						return;
					}
					botDeposits.set(depId, {
						uid,
						chatId,
						amount: amt,
						createdAt: Date.now()
					});
					await tgApi('sendPhoto', {
						chat_id: chatId,
						photo: qrUrl,
						caption: `<b>PAY ₹${amt}</b>\n<code>${depId}</code>\nPAY WITH ANY UPI APP, THEN TAP CHECK PAYMENT.`,
						parse_mode: 'HTML',
						reply_markup: {
							inline_keyboard: [
								[{
									text: '✅ CHECK PAYMENT',
									callback_data: `dep_chk_${depId}`,
									style: 'success'
								}, {
									text: '❌ CANCEL',
									callback_data: `dep_can_${depId}`,
									style: 'danger'
								}, ],
							],
						},
					});
				} catch (err) {
					console.error('[Telegram Bot Deposit Error]:', err.message);
					await tgApi('sendMessage', {
						chat_id: chatId,
						text: '❌ Failed to generate deposit QR. Please try again.'
					}).catch(() => {});
				}
				return;
			}
			if (!isAdminUser(uid)) return;
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
					await SettingsRepo.update({
						forceJoinChannel: ch,
						forceJoinUrl: url,
						forceJoinEnabled: true
					});
					adminPending.delete(uid);
					await renderChannelSetup(uid, null);
				} else if (pending.action === 'await_user_search') {
					const targetUid = text.replace(/[^a-zA-Z0-9_-]/g, '');
					if (!targetUid) {
						await tgApi('sendMessage', {
							chat_id: uid,
							text: '❌ Invalid User ID. Please send a valid Telegram User ID.'
						});
						return;
					}
					adminPending.delete(uid);
					await renderUserDetail(uid, null, targetUid);
				} else if (pending.action === 'await_wallet_uid') {
					const targetUid = text.replace(/[^a-zA-Z0-9_-]/g, '');
					if (!targetUid) {
						await tgApi('sendMessage', {
							chat_id: uid,
							text: '❌ Invalid User ID. Please send a valid Telegram User ID.'
						});
						return;
					}
					await renderWalletAmountPicker(uid, null, pending.mode, targetUid);
				} else if (pending.action === 'await_wallet_amount') {
					await executeWalletAdjust(uid, null, pending.mode, pending.targetUid, text);
				} else if (pending.action === 'await_fees') {
					const parts = text.split(/\s+/);
					if (parts.length < 2 || isNaN(Number(parts[0])) || isNaN(Number(parts[1]))) {
						await tgApi('sendMessage', {
							chat_id: uid,
							text: '❌ Format: `<orderFee> <minDeposit>` (e.g. `3 15`)',
							parse_mode: 'Markdown'
						});
						return;
					}
					await SettingsRepo.update({
						orderFee: Number(parts[0]),
						minDeposit: Number(parts[1])
					});
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
module.exports = {
	initBot,
	getBot: () => bot
};
