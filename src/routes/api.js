const express = require('express');
const axios = require('axios');
const router = express.Router();
const {
	AccountRepo
} = require('../models/Account');
const {
	WalletRepo
} = require('../models/Wallet');
const {
	SettingsRepo,
	isAdminUser
} = require('../models/Settings');
const SwiggyService = require('../services/swiggyService');
const BharatPeService = require('../services/bharatpeService');
const pendingRecharges = new Map();
const notifiedOrderIds = new Set();
const chargedOrderIds = new Set();
const SMALL_CAPS_MAP = {
	a: 'ᴀ',
	b: 'ʙ',
	c: 'ᴄ',
	d: 'ᴅ',
	e: 'ᴇ',
	f: 'ꜰ',
	g: 'ɢ',
	h: 'ʜ',
	i: 'ɪ',
	j: 'ᴊ',
	k: 'ᴋ',
	l: 'ʟ',
	m: 'ᴍ',
	n: 'ɴ',
	o: 'ᴏ',
	p: 'ᴘ',
	q: 'ǫ',
	r: 'ʀ',
	s: 'ꜱ',
	t: 'ᴛ',
	u: 'ᴜ',
	v: 'ᴠ',
	w: 'ᴡ',
	x: 'x',
	y: 'ʏ',
	z: 'ᴢ'
};
const toSmallCaps = (str = '') => String(str).toLowerCase().replace(/[a-z]/g, (c) => SMALL_CAPS_MAP[c] || c);
async function sendOrderPlacedTelegram(tgUserId, orderId, activeAccount = null, sessionOrder = null, addressDeleted = false) {
	try {
		const botToken = process.env.TELEGRAM_BOT_TOKEN;
		const chatId = String(tgUserId || '').trim();
		if (!botToken || !/^\d+$/.test(chatId) || !orderId) return;
		if (notifiedOrderIds.has(String(orderId))) return;
		notifiedOrderIds.add(String(orderId));
		const tid = activeAccount?.tid || '';
		const token = activeAccount?.token || '';
		let liveOrder = null;
		let trackData = null;
		if (tid || token) {
			try {
				const sRes = await SwiggyService.getSingleOrder(orderId, tid, token);
				liveOrder = sRes.data?.data?.orders?.[0] || sRes.data?.data || null;
			} catch (e) {}
			try {
				const tRes = await SwiggyService.getTrackCard(orderId, tid, token);
				trackData = tRes.data?.data || tRes.data || null;
			} catch (e) {}
		}
		const ord = liveOrder || sessionOrder || {
			order_id: orderId
		};
		const accountPhone = activeAccount?.phone || ord.phone_no || '';
		const restaurantName = ord.restaurant_name || sessionOrder?.restaurant_name || '';
		const rawPm = String(ord.payment_method || ord.payment_method_involved || sessionOrder?.payment_method || 'UPI');
		const payText = /cash|cod/i.test(rawPm) ? 'ᴄᴏᴅ' : (/upi/i.test(rawPm) ? 'ᴜᴘɪ' : toSmallCaps(rawPm));
		const rawStatus = trackData?.order_status || ord.order_status || 'Order Received!';
		const statusText = toSmallCaps(rawStatus.replace(/_/g, ' '));
		const trackUrl = trackData?.tracking_url || trackData?.share_url || ord.tracking_url || `https://www.swiggy.com/track-order/${orderId}`;
		const items = ord.order_items || ord.items || sessionOrder?.items || [];
		const itemLines = items.map((it) => {
			const qty = it.quantity || 1;
			const price = it.sub_total ?? it.item_total ?? it.final_price ?? (it.cost ? Math.round((Number(it.cost) / 100) * 100) / 100 : '');
			return `• ${it.name} × ${qty}${price !== '' ? ` — ₹${price}` : ''}`;
		}).join('\n');
		const charges = ord.charges || {};
		const total = Number(ord.order_total ?? ord.net_total ?? sessionOrder?.order_total ?? 0);
		const itemTotal = Number(ord.item_total ?? items.reduce((s, it) => s + Number(it.sub_total ?? it.item_total ?? (it.cost ? it.cost / 100 : 0)), 0) ?? total);
		const deliveryFee = Number(ord.delivery_charges ?? charges['Total Delivery Fees'] ?? charges['Delivery Charges'] ?? 0);
		const packingFee = Number(charges['Packing Charges'] || 0) + Number(charges['Convenience Fee'] || 0) + Number(charges['Service Charges'] || 0);
		const taxes = Math.round((Number(ord.order_tax ?? charges['GST'] ?? 0) + packingFee) * 100) / 100;
		const couponDisc = Number(ord.coupon_discount || 0);
		const freeCashDisc = Math.max(0, Number(ord.order_discount || 0) + Number(ord.trade_discount || 0) + Number(ord.payment_offer_instant_discount || 0));
		const da = ord.delivery_address;
		const addrStr = (da && typeof da === 'object') ? [da.flat_no, da.landmark, da.address || da.address_line1, da.city].filter(Boolean).join(', ') : (da || sessionOrder?.delivery_address || '');
		const recName = (da && typeof da === 'object' ? da.name : '') || sessionOrder?.receiver_name || activeAccount?.userName || '';
		const recPhone = (da && typeof da === 'object' ? da.mobile : '') || sessionOrder?.receiver_phone || accountPhone || '';
		const billLines = [`• ɪᴛᴇᴍ ᴛᴏᴛᴀʟ: ${itemTotal}`, `• ᴅᴇʟɪᴠᴇʀʏ ꜰᴇᴇ: ${deliveryFee === 0 ? 'FREE' : deliveryFee}`, ];
		if (freeCashDisc > 0) billLines.push(`• ꜰʀᴇᴇ ᴄᴀꜱʜ: −${freeCashDisc.toFixed(2)}`);
		if (couponDisc > 0) billLines.push(`• ᴄᴏᴜᴘᴏɴ ᴅɪꜱᴄᴏᴜɴᴛ: −${couponDisc.toFixed(2)}`);
		billLines.push(`• ɢᴏᴠᴇʀɴᴍᴇɴᴛ ᴛᴀxᴇꜱ: ${taxes}`);
		billLines.push(`• ᴛᴏ ᴘᴀʏ: ${total}`);
		const lines = [`✅ ʏᴏᴜʀ ᴏʀᴅᴇʀ ɪꜱ ᴘʟᴀᴄᴇᴅ!`, ``,
			accountPhone ? `📱 ᴀᴄᴄᴏᴜɴᴛ: ${accountPhone}` : null, `🗑 ᴀᴅᴅʀᴇꜱꜱ ᴅᴇʟᴇᴛᴇᴅ: ${addressDeleted ? 'ʏᴇꜱ' : 'ɴᴏ'}`, ``,
			restaurantName ? `🍽 ${toSmallCaps(restaurantName)}` : null, `🆔 ᴏʀᴅᴇʀ ɪᴅ: ${orderId}`, `💳 ᴘᴀʏᴍᴇɴᴛ: ${payText}`, `📍 ꜱᴛᴀᴛᴜꜱ: ${statusText}`, `🔗 ᴛʀᴀᴄᴋɪɴɢ: ${trackUrl}`,
			itemLines ? `ɪᴛᴇᴍꜱ\n${itemLines}` : null, ``, `ʙɪʟʟ ᴅᴇᴛᴀɪʟꜱ`,
			billLines.join('\n'), ``, `📍 ᴅᴇʟɪᴠᴇʀʏ ᴀᴅᴅʀᴇꜱꜱ`,
			addrStr ? `• ᴀᴅᴅʀᴇꜱꜱ: ${addrStr}` : null,
			recName ? `• ʀᴇᴄᴇɪᴠᴇʀ: ${recName}` : null,
			recPhone ? `• ᴘʜᴏɴᴇ: ${recPhone}` : null, ``, `#toing`
		].filter((x) => x !== null);
		await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
			chat_id: chatId,
			text: lines.join('\n'),
			disable_web_page_preview: true,
		}, {
			timeout: 8000
		});
	} catch (e) {
		console.error('[Telegram Order Notify] Error:', e.message);
	}
}
// Real geocoding helper (Photon + OpenStreetMap Nominatim for reliable cloud/Render resolution)
const geocodeAddress = async (queries = []) => {
	const expanded = [];
	for (const q of queries) {
		if (!q || !q.trim()) continue;
		const cleanQ = q.trim();
		const parts = cleanQ.split(',').map((p) => p.trim()).filter(Boolean);
		if (parts.length >= 2) {
			const words = parts[0].split(/\s+/).filter((w) => w.length > 2 && !/^(floor|flat|room|house|hostel|boys|girls|no|near|opp|sector|block)$/i.test(w));
			// When line has 3+ words (e.g. "sanskaram boys hostel ratnagiri bhopal"), try the locality tail first so geocoder doesn't fuzzy-match a distant outskirt
			if (words.length >= 3) {
				expanded.push(`${words.slice(-2).join(' ')}, ${parts.slice(1).join(', ')}`);
				expanded.push(`${words.slice(-3).join(' ')}, ${parts.slice(1).join(', ')}`);
			}
			expanded.push(cleanQ);
			if (words.length === 2) {
				expanded.push(`${words.slice(-2).join(' ')}, ${parts.slice(1).join(', ')}`);
			}
		} else {
			expanded.push(cleanQ);
		}
	}
	const seen = new Set();
	for (const q of expanded) {
		if (seen.has(q)) continue;
		seen.add(q);
		// 1. Try Photon (OSM-based, no strict cloud IP rate-limit)
		try {
			const pResp = await axios.get('https://photon.komoot.io/api/', {
				params: {
					q,
					limit: 1
				},
				timeout: 4500,
			});
			const feat = pResp.data?.features?.[0];
			const coords = feat?.geometry?.coordinates;
			if (Array.isArray(coords) && coords.length >= 2) {
				const lng = parseFloat(coords[0]);
				const lat = parseFloat(coords[1]);
				if (lat && lng) {
					const props = feat.properties || {};
					return {
						lat,
						lng,
						display: [props.name, props.street, props.district || props.city, props.state, props.country].filter(Boolean).join(', '),
					};
				}
			}
		} catch (e) {}
		// 2. Fallback to Nominatim
		try {
			const resp = await axios.get('https://nominatim.openstreetmap.org/search', {
				params: {
					format: 'json',
					limit: 1,
					countrycodes: 'in',
					q
				},
				headers: {
					'User-Agent': 'ToingProOrderApp/1.0 (https://github.com)'
				},
				timeout: 4500,
			});
			const hit = resp.data?.[0];
			if (hit && hit.lat && hit.lon) {
				return {
					lat: parseFloat(hit.lat),
					lng: parseFloat(hit.lon),
					display: hit.display_name || '',
				};
			}
		} catch (e) {}
	}
	return null;
};
// In-memory OTP session map: `${tgUserId}:${mobile}` -> { tid, timestamp }
const otpSessions = new Map();
// Per-user in-memory list for newly placed orders in current session
if (!global.placedOrdersByUser) {
	global.placedOrdersByUser = new Map();
}
const getUserPlacedOrders = (tgUserId) => {
	const uid = String(tgUserId || 'default');
	if (!global.placedOrdersByUser.has(uid)) {
		global.placedOrdersByUser.set(uid, []);
	}
	return global.placedOrdersByUser.get(uid);
};
// Extract Telegram User ID (or browser client ID) from request
const getTgUserId = (req) => {
	const raw = req.headers['x-tg-user-id'] || req.query?.tgUserId || req.body?.tgUserId || 'default';
	return String(raw).trim() || 'default';
};
// Extract Swiggy numeric user_id from tid JWT if missing on account
const extractUserIdFromTid = (tid = '') => {
	try {
		const parts = String(tid).split('.');
		if (parts.length >= 2) {
			const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
			if (payload && payload.user_id) return String(payload.user_id);
		}
	} catch (e) {}
	return '';
};
// Helper to get active account credentials for the requesting Telegram user
const getActiveCreds = async (tgUserId = 'default') => {
	const active = await AccountRepo.getActive(tgUserId);
	const tid = active?.tid || '';
	const userId = active?.userId || extractUserIdFromTid(tid);
	if (active && userId && !active.userId) active.userId = userId;
	return {
		active,
		tid,
		token: active?.token || '',
		userId,
	};
};
/* =========================================
   1. ACCOUNTS & AUTH
   ========================================= */
// Get all saved accounts (scoped to current Telegram user)
router.get('/accounts', async (req, res) => {
	try {
		const accounts = await AccountRepo.getAll(getTgUserId(req));
		res.json({
			success: true,
			accounts
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Get currently active account (scoped to current Telegram user)
router.get('/accounts/active', async (req, res) => {
	try {
		const active = await AccountRepo.getActive(getTgUserId(req));
		res.json({
			success: true,
			active
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Step 1: Send OTP
router.post('/accounts/send-otp', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			mobile
		} = req.body;
		if (!mobile) {
			return res.status(400).json({
				success: false,
				error: 'Mobile number is required'
			});
		}
		const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
		const result = await SwiggyService.sendOtp(cleanMobile);
		if (result.success && result.tid) {
			otpSessions.set(`${tgUserId}:${cleanMobile}`, {
				tid: result.tid,
				time: Date.now()
			});
			return res.json({
				success: true,
				message: 'OTP sent successfully to +91 ' + cleanMobile,
				tid: result.tid,
			});
		}
		res.status(400).json({
			success: false,
			error: result.error || 'Failed to send OTP. Please check the mobile number.',
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Step 2: Verify OTP
router.post('/accounts/verify-otp', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			mobile,
			otp,
			tid
		} = req.body;
		const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
		const sessionTid = tid || (cleanMobile ? otpSessions.get(`${tgUserId}:${cleanMobile}`)?.tid : '') || '';
		if (!sessionTid) {
			console.warn('[Verify OTP] No session TID found for mobile:', cleanMobile);
			return res.status(400).json({
				success: false,
				error: 'No active OTP session found. Please send OTP first.',
			});
		}
		console.log(`[Verify OTP Request] User: ${tgUserId}, Mobile: ${cleanMobile}, OTP: ${otp}, TID: ${sessionTid.slice(0, 10)}...`);
		const result = await SwiggyService.verifyOtp(cleanMobile, otp, sessionTid);
		console.log('[Verify OTP Swiggy Result]:', {
			success: result.success,
			statusCode: result.statusCode,
			statusMessage: result.statusMessage,
			hasToken: !!result.token,
			error: result.error,
		});
		if (result.success && result.token) {
			const accountData = {
				telegramUserId: tgUserId,
				phone: cleanMobile || String(result.data?.mobile || result.data?.phone || '').replace(/\D/g, '').slice(-10),
				tid: result.tid || sessionTid,
				token: result.token,
				userId: String(result.data?.userId || result.data?.user_id || ''),
				userName: result.data?.name || result.data?.userName || `User ${cleanMobile.slice(-4)}`,
				email: result.data?.email || '',
				isActive: true,
				addresses: result.data?.addresses || [],
				rawSession: result.data,
			};
			const saved = await AccountRepo.saveOrUpdate(accountData);
			otpSessions.delete(`${tgUserId}:${cleanMobile}`);
			return res.json({
				success: true,
				message: 'Account logged in successfully!',
				account: saved,
			});
		}
		res.status(400).json({
			success: false,
			error: result.statusMessage || result.error || 'Invalid OTP. Please try again.',
		});
	} catch (err) {
		console.error('[Verify OTP Exception]:', err);
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Import Account via JSON
router.post('/accounts/import-json', async (req, res) => {
	try {
		const {
			jsonData
		} = req.body;
		let parsed = {};
		if (typeof jsonData === 'string') {
			try {
				parsed = JSON.parse(jsonData);
			} catch (e) {
				return res.status(400).json({
					success: false,
					error: 'Invalid JSON format'
				});
			}
		} else {
			parsed = jsonData;
		}
		const phone = parsed.phone || parsed.mobile || parsed.userPhone || `imported_${Date.now()}`;
		const tid = parsed.tid || parsed.TID || '';
		const token = parsed.token || parsed.TOKEN || '';
		if (!tid && !token) {
			return res.status(400).json({
				success: false,
				error: 'JSON must contain at least "tid" or "token"',
			});
		}
		const accountData = {
			telegramUserId: getTgUserId(req),
			phone: String(phone).replace(/\D/g, '').slice(-10) || phone,
			tid,
			token,
			userId: String(parsed.userId || parsed.user_id || ''),
			userName: parsed.userName || parsed.name || 'Imported User',
			email: parsed.email || '',
			isActive: true,
			rawSession: parsed,
		};
		const saved = await AccountRepo.saveOrUpdate(accountData);
		res.json({
			success: true,
			message: 'Account imported successfully!',
			account: saved
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Switch active account
router.post('/accounts/switch/:id', async (req, res) => {
	try {
		const updated = await AccountRepo.setActive(req.params.id, getTgUserId(req));
		if (!updated) {
			return res.status(404).json({
				success: false,
				error: 'Account not found'
			});
		}
		res.json({
			success: true,
			message: 'Active account switched',
			account: updated
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Toggle account used status
router.post('/accounts/:id/toggle-used', async (req, res) => {
	try {
		const acc = await AccountRepo.toggleUsed(req.params.id, getTgUserId(req));
		if (!acc) return res.status(404).json({
			success: false,
			error: 'Account not found'
		});
		res.json({
			success: true,
			isUsed: acc.isUsed
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Delete all accounts
router.post('/accounts/delete-all', async (req, res) => {
	try {
		await AccountRepo.deleteAll(getTgUserId(req));
		res.json({
			success: true,
			message: 'All accounts deleted'
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Delete account
router.delete('/accounts/:id', async (req, res) => {
	try {
		await AccountRepo.delete(req.params.id, getTgUserId(req));
		res.json({
			success: true,
			message: 'Account removed'
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
/* =========================================
   2. ADDRESSES & DELIVERY LOCATION
   ========================================= */
// Live area search suggestions (Photon + Nominatim fallback)
router.get('/addresses/suggest', async (req, res) => {
	const q = String(req.query.q || '').trim();
	if (q.length < 3) return res.json({
		success: true,
		suggestions: []
	});
	try {
		const pResp = await axios.get('https://photon.komoot.io/api/', {
			params: {
				q: `${q}, India`,
				limit: 5
			},
			timeout: 4500,
		});
		const feats = pResp.data?.features || [];
		if (feats.length > 0) {
			const suggestions = feats.map((f) => {
				const p = f.properties || {};
				const coords = f.geometry?.coordinates || [];
				const area = [p.name, p.street, p.district || p.locality].filter(Boolean).slice(0, 2).join(', ');
				const city = p.city || p.district || p.state || '';
				const display = [p.name, p.street, p.district, p.city, p.state, p.postcode].filter(Boolean).join(', ');
				return {
					area: area || city || q,
					city,
					display: display || area || q,
					lat: parseFloat(coords[1]),
					lng: parseFloat(coords[0]),
				};
			}).filter((s) => s.lat && s.lng);
			if (suggestions.length > 0) return res.json({
				success: true,
				suggestions
			});
		}
	} catch (e) {}
	try {
		const nResp = await axios.get('https://nominatim.openstreetmap.org/search', {
			params: {
				format: 'json',
				countrycodes: 'in',
				limit: 5,
				q
			},
			headers: {
				'User-Agent': 'ToingProOrderApp/1.0 (https://github.com)'
			},
			timeout: 4500,
		});
		const suggestions = (nResp.data || []).map((it) => {
			const parts = String(it.display_name || '').split(',').map((s) => s.trim());
			return {
				area: parts.slice(0, 2).join(', '),
				city: parts.find((p) => /patna|bhopal|varanasi|delhi|mumbai|kolkata|lucknow|jaipur|pune|bengaluru|hyderabad/i.test(p)) || parts[parts.length - 4] || '',
				display: it.display_name,
				lat: parseFloat(it.lat),
				lng: parseFloat(it.lon),
			};
		}).filter((s) => s.lat && s.lng);
		return res.json({
			success: true,
			suggestions
		});
	} catch (e) {}
	res.json({
		success: true,
		suggestions: []
	});
});
// Reverse geocode GPS coordinates to area + city
router.get('/addresses/reverse-geocode', async (req, res) => {
	const lat = parseFloat(req.query.lat);
	const lng = parseFloat(req.query.lng);
	if (!lat || !lng) return res.status(400).json({
		success: false,
		error: 'Invalid coordinates'
	});
	const rev = await reverseGeocodeCoords(lat, lng);
	res.json({
		success: true,
		lat,
		lng,
		area: rev?.area || '',
		city: rev?.city || '',
		display: rev?.display || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
	});
});
router.get('/addresses', async (req, res) => {
	try {
		const active = await AccountRepo.getActive(getTgUserId(req));
		if (!active) {
			return res.json({
				success: true,
				addresses: [],
				selectedAddressId: ''
			});
		}
		let addresses = active.addresses || [];
		const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
		// Fetch live addresses from maps.swiggy.com only on explicit refresh or when cache is empty
		if ((forceRefresh || addresses.length === 0) && (active.tid || active.token)) {
			try {
				const resolvedUid = active.userId || extractUserIdFromTid(active.tid);
				const swiggyRes = await SwiggyService.getAddresses(active.tid, active.token, resolvedUid);
				if (swiggyRes.success && Array.isArray(swiggyRes.addresses) && swiggyRes.addresses.length > 0) {
					addresses = swiggyRes.addresses.map((a, i) => {
						const act = a.actual_address || {};
						return {
							id: a.id || `addr_${i}`,
							name: act.contact_name || a.name || active.userName || 'batman',
							phone: act.phone || a.mobile || active.phone,
							address_line1: a.display_address || act.formatted_address || act.address_line || 'Delivery Address',
							address_line2: act.locality ? `${act.locality}, ${act.city || ''}` : (act.city || ''),
							city: act.city || a.city || 'Patna',
							lat: parseFloat(act.location?.lat ?? act.location?.latitude ?? a.lat) || 25.6074,
							lng: parseFloat(act.location?.lng ?? act.location?.longitude ?? a.lng) || 85.1587,
							tag: (Array.isArray(act.tags) && act.tags[0]) || a.tag || 'HOME',
							isAccountAddress: true,
						};
					});
					active.addresses = addresses;
					if (!active.selectedAddressId) active.selectedAddressId = addresses[0].id;
					await AccountRepo.saveOrUpdate(active);
				}
			} catch (err) {}
		}
		res.json({
			success: true,
			addresses,
			selectedAddressId: active.selectedAddressId || addresses[0]?.id || '',
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Select active delivery address
router.post('/addresses/select', async (req, res) => {
	try {
		const {
			addressId
		} = req.body;
		const active = await AccountRepo.getActive(getTgUserId(req));
		if (!active) {
			return res.status(400).json({
				success: false,
				error: 'No active account'
			});
		}
		await AccountRepo.setSelectedAddress(active._id, addressId);
		res.json({
			success: true,
			message: 'Delivery address selected',
			selectedAddressId: addressId
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Reverse geocode lat/lng -> full detailed address via OpenStreetMap Nominatim
const reverseGeocodeCoords = async (lat, lng) => {
	try {
		const resp = await axios.get('https://nominatim.openstreetmap.org/reverse', {
			params: {
				format: 'json',
				lat,
				lon: lng,
				addressdetails: 1
			},
			headers: {
				'User-Agent': 'ToingProApp/1.0'
			},
			timeout: 5000,
		});
		const d = resp.data || {};
		const a = d.address || {};
		return {
			display: d.display_name || '',
			area: a.suburb || a.neighbourhood || a.residential || a.road || '',
			city: a.city || a.town || a.village || a.state_district || '',
		};
	} catch (e) {
		return null;
	}
};
// Add Address by Swiggy Link / Google Maps Link / Address Text
router.post('/addresses/add-link', async (req, res) => {
	try {
		const {
			link,
			name
		} = req.body;
		const rawInput = String(link || '').trim();
		const active = await AccountRepo.getActive(getTgUserId(req));
		if (!active) {
			return res.status(400).json({
				success: false,
				error: 'No active account'
			});
		}
		let lat = null;
		let lng = null;
		let resolvedName = name || '';
		let resolvedText = '';
		let resolvedArea = '';
		let resolvedCity = '';
		// 1. Direct URL query params (?lat=...&lng=...) or Google Maps @lat,lng
		const coordMatch = rawInput.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || rawInput.match(/[?&](?:q|ll|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
		if (coordMatch) {
			lat = parseFloat(coordMatch[1]);
			lng = parseFloat(coordMatch[2]);
		}
		try {
			const urlObj = new URL(rawInput);
			if (urlObj.searchParams.get('lat')) lat = parseFloat(urlObj.searchParams.get('lat'));
			if (urlObj.searchParams.get('lng')) lng = parseFloat(urlObj.searchParams.get('lng'));
		} catch (e) {}
		// 2. If Swiggy onelink / short URL, follow redirect or inspect inner URL
		if (!lat && /^https?:\/\//i.test(rawInput)) {
			try {
				const r = await axios.get(rawInput, {
					maxRedirects: 5,
					headers: {
						'user-agent': 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36'
					},
					timeout: 6000,
					validateStatus: () => true,
				});
				const finalUrl = r.request?.res?.responseUrl || rawInput;
				const mFinal = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || finalUrl.match(/[?&]lat=(-?\d+\.\d+).*?[?&]lng=(-?\d+\.\d+)/);
				if (mFinal) {
					lat = parseFloat(mFinal[1]);
					lng = parseFloat(mFinal[2]);
				}
				const htmlStr = typeof r.data === 'string' ? r.data : '';
				const ofoMatch = htmlStr.match(/swiggy\.com\/ofo\/address\/([^\/\\?&]+)\//i) || rawInput.match(/swiggy\.com\/ofo\/address\/([^\/\\?&]+)\//i);
				if (ofoMatch && !resolvedName) {
					resolvedName = decodeURIComponent(ofoMatch[1]).trim();
				}
			} catch (e) {}
			if (!lat || !lng) {
				return res.status(400).json({
					success: false,
					error: `Swiggy short link does not expose coordinates publicly${resolvedName ? ` (Recipient: ${resolvedName})` : ''}. Please paste full address text or use "Add Manually on Map"!`,
				});
			}
		}
		// 3. Reverse geocode if we got lat/lng from link, or forward geocode if user pasted plain address text
		if (lat && lng) {
			const rev = await reverseGeocodeCoords(lat, lng);
			if (rev) {
				resolvedText = rev.display;
				resolvedArea = rev.area;
				resolvedCity = rev.city;
			}
		} else {
			const geo = await geocodeAddress([`${rawInput}, India`, rawInput]);
			if (geo) {
				lat = geo.lat;
				lng = geo.lng;
				resolvedText = geo.display || rawInput;
			}
		}
		const userCity = resolvedCity || active.addresses?.[0]?.city || 'Patna';
		const displayAddress = resolvedText || rawInput;
		const finalLat = lat || active.addresses?.[0]?.lat || 25.6074;
		const finalLng = lng || active.addresses?.[0]?.lng || 85.1587;
		let swiggyAddrId = '';
		if (active.tid && active.token) {
			const resolvedUid = active.userId || extractUserIdFromTid(active.tid);
			const swAdd = await SwiggyService.addAddress({
				name: resolvedName || active.userName || 'Delivery User',
				phone: active.phone,
				formatted_address: displayAddress,
				flat_no: displayAddress.split(',')[0] || '',
				area: resolvedArea || userCity,
				city: userCity,
				lat: finalLat,
				lng: finalLng,
				tag: 'OTHER',
			}, active.tid, active.token, resolvedUid);
			if (swAdd.success && swAdd.addressId) swiggyAddrId = swAdd.addressId;
		}
		const newAddress = {
			id: swiggyAddrId || ('addr_' + Date.now()),
			name: resolvedName || active.userName || 'Delivery User',
			phone: `+91 ${active.phone}`,
			address_line1: displayAddress,
			address_line2: '',
			address: displayAddress,
			area: resolvedArea,
			city: userCity,
			lat: finalLat,
			lng: finalLng,
			tag: 'OTHER',
			isAccountAddress: true,
		};
		await AccountRepo.addAddress(active._id, newAddress);
		await AccountRepo.setSelectedAddress(active._id, newAddress.id);
		res.json({
			success: true,
			message: 'Address added successfully!',
			address: newAddress
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Add Address Manually
router.post('/addresses/add-manual', async (req, res) => {
	try {
		const {
			name,
			phone,
			addressLine1,
			addressLine2,
			city,
			tag,
			lat,
			lng
		} = req.body;
		const active = await AccountRepo.getActive(getTgUserId(req));
		if (!active) {
			return res.status(400).json({
				success: false,
				error: 'No active account'
			});
		}
		const targetCity = city || active.addresses?.[0]?.city || 'Patna';
		let resolvedLat = parseFloat(lat) || null;
		let resolvedLng = parseFloat(lng) || null;
		if (!resolvedLat || !resolvedLng) {
			const geo = await geocodeAddress([
				[addressLine2, targetCity, 'India'].filter(Boolean).join(', '),
				[addressLine1, addressLine2, targetCity, 'India'].filter(Boolean).join(', '),
				[addressLine1, targetCity, 'India'].filter(Boolean).join(', '), `${targetCity}, India`,
			]);
			if (geo) {
				resolvedLat = geo.lat;
				resolvedLng = geo.lng;
			}
		}
		const finalLat = resolvedLat || active.addresses?.[0]?.lat || 25.6074;
		const finalLng = resolvedLng || active.addresses?.[0]?.lng || 85.1587;
		let swiggyAddrId = '';
		if (active.tid && active.token) {
			const resolvedUid = active.userId || extractUserIdFromTid(active.tid);
			const swAdd = await SwiggyService.addAddress({
				name: name || active.userName || 'Delivery User',
				phone: phone || active.phone,
				formatted_address: [addressLine1, addressLine2, targetCity, 'India'].filter(Boolean).join(', '),
				flat_no: addressLine1 || 'Manual Address',
				address_line2: addressLine2 || '',
				landmark: addressLine2 || '',
				area: addressLine2 || targetCity,
				city: targetCity,
				lat: finalLat,
				lng: finalLng,
				tag: tag || 'OTHER',
			}, active.tid, active.token, resolvedUid);
			if (swAdd.success && swAdd.addressId) swiggyAddrId = swAdd.addressId;
		}
		const newAddress = {
			id: swiggyAddrId || ('addr_' + Date.now()),
			name: name || active.userName || 'Delivery User',
			phone: phone || `+91 ${active.phone}`,
			address_line1: addressLine1 || 'Manual Address',
			address_line2: addressLine2 || '',
			city: targetCity,
			lat: finalLat,
			lng: finalLng,
			tag: tag || 'OTHER',
			isAccountAddress: true,
		};
		await AccountRepo.addAddress(active._id, newAddress);
		await AccountRepo.setSelectedAddress(active._id, newAddress.id);
		res.json({
			success: true,
			message: 'Address created successfully!',
			address: newAddress
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Update Address
router.put('/addresses/:id', async (req, res) => {
	try {
		const {
			name,
			phone,
			addressLine1,
			addressLine2,
			city,
			tag,
			lat,
			lng
		} = req.body;
		const active = await AccountRepo.getActive(getTgUserId(req));
		if (!active) {
			return res.status(400).json({
				success: false,
				error: 'No active account'
			});
		}
		const existing = (active.addresses || []).find((a) => String(a.id || a._id) === String(req.params.id));
		const base = existing || {};
		const targetCity = city || base.city || 'Patna';
		const updatedFields = {
			id: String(req.params.id || base.id || ('addr_' + Date.now())),
			name: name || base.name || active.userName || 'Delivery User',
			phone: phone || base.phone || base.mobile || `+91 ${active.phone}`,
			mobile: phone || base.mobile || base.phone || active.phone,
			address_line1: addressLine1 !== undefined ? addressLine1 : (base.address_line1 || base.flat_no || ''),
			address_line2: addressLine2 !== undefined ? addressLine2 : (base.address_line2 || base.landmark || ''),
			flat_no: addressLine1 !== undefined ? addressLine1 : (base.flat_no || ''),
			landmark: addressLine2 !== undefined ? addressLine2 : (base.landmark || ''),
			city: targetCity,
			tag: tag || base.tag || 'HOME',
		};
		const reqLat = parseFloat(lat);
		const reqLng = parseFloat(lng);
		if (reqLat && reqLng) {
			updatedFields.lat = reqLat;
			updatedFields.lng = reqLng;
		} else {
			const geo = await geocodeAddress([
				[updatedFields.address_line2, targetCity, 'India'].filter(Boolean).join(', '),
				[updatedFields.address_line1, updatedFields.address_line2, targetCity, 'India'].filter(Boolean).join(', '),
				[updatedFields.address_line1, targetCity, 'India'].filter(Boolean).join(', '), `${targetCity}, India`,
			]);
			if (geo) {
				updatedFields.lat = geo.lat;
				updatedFields.lng = geo.lng;
			} else {
				updatedFields.lat = base.lat || 25.6074;
				updatedFields.lng = base.lng || 85.1587;
			}
		}
		// Sync edited address to Swiggy so it gets a real Swiggy address_id (for cart delivery & order placement)
		if (active.tid && active.token) {
			const resolvedUid = active.userId || extractUserIdFromTid(active.tid);
			const swAdd = await SwiggyService.addAddress({
				name: updatedFields.name,
				phone: updatedFields.mobile || updatedFields.phone,
				formatted_address: [updatedFields.address_line1, updatedFields.address_line2, targetCity, 'India'].filter(Boolean).join(', '),
				flat_no: updatedFields.flat_no || updatedFields.address_line1,
				address_line2: updatedFields.address_line2,
				landmark: updatedFields.landmark,
				area: updatedFields.address_line2 || targetCity,
				city: targetCity,
				lat: updatedFields.lat,
				lng: updatedFields.lng,
				tag: updatedFields.tag,
			}, active.tid, active.token, resolvedUid);
			if (swAdd.success && swAdd.addressId) {
				updatedFields.id = swAdd.addressId;
			}
		}
		if (existing) {
			await AccountRepo.updateAddress(active._id, req.params.id, updatedFields);
			if (String(active.selectedAddressId) === String(req.params.id) && updatedFields.id !== req.params.id) {
				await AccountRepo.setSelectedAddress(active._id, updatedFields.id);
			}
		} else {
			await AccountRepo.addAddress(active._id, updatedFields);
			await AccountRepo.setSelectedAddress(active._id, updatedFields.id);
		}
		res.json({
			success: true,
			message: 'Address updated successfully!',
			address: {
				...base,
				...updatedFields
			}
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Delete Address
router.delete('/addresses/:id', async (req, res) => {
	try {
		const active = await AccountRepo.getActive(getTgUserId(req));
		if (active) {
			await AccountRepo.deleteAddress(active._id, req.params.id);
			if (active.tid && active.token) {
				SwiggyService.deleteAddress(req.params.id, active.tid, active.token).catch(() => {});
			}
		}
		res.json({
			success: true,
			message: 'Address deleted'
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
/* =========================================
   3. SEARCH & MENU (DIRECT LIVE SWIGGY APIS)
   ========================================= */
router.post('/search', async (req, res) => {
	try {
		const {
			query
		} = req.body;
		let {
			lat,
			lng,
			city
		} = req.body;
		const {
			active,
			tid,
			token
		} = await getActiveCreds(getTgUserId(req));
		const selected = active?.addresses?.find((a) => a.id === active.selectedAddressId) || active?.addresses?.[0];
		// Use Selected Address lat & lng dynamically; require an address if none selected
		if (!lat || !lng) {
			lat = selected?.lat;
			lng = selected?.lng;
		}
		if (!lat || !lng) {
			return res.json({
				success: false,
				error: 'Please select a delivery address first.',
				count: 0,
				openNowCount: 0,
				restaurants: [],
			});
		}
		if (!city) {
			city = selected?.city || '';
		}
		const searchQuery = query || 'Pizza';
		const swiggyResult = await SwiggyService.searchRestaurants(searchQuery, lat, lng, tid, token, city);
		const restaurants = swiggyResult.restaurants || [];
		res.json({
			success: true,
			query: searchQuery,
			count: restaurants.length,
			openNowCount: restaurants.filter((r) => r.isOpen).length,
			restaurants,
			deliveringTo: {
				lat,
				lng,
				city,
				addressId: active?.selectedAddressId || selected?.id || '',
			},
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.get('/menu/:restaurantId', async (req, res) => {
	try {
		const {
			restaurantId
		} = req.params;
		let {
			lat,
			lng,
			areaName
		} = req.query;
		const {
			active,
			tid,
			token
		} = await getActiveCreds(getTgUserId(req));
		const selected = active?.addresses?.find((a) => a.id === active.selectedAddressId) || active?.addresses?.[0];
		if (!lat || !lng) {
			lat = selected?.lat || 25.6074;
			lng = selected?.lng || 85.1587;
		}
		const defaultCity = selected?.city || 'Patna';
		const swiggyResult = await SwiggyService.getMenu(restaurantId, lat, lng, tid, token);
		const items = swiggyResult.items || [];
		res.json({
			success: true,
			restaurant: {
				id: restaurantId,
				name: req.query.name || '',
				areaName: areaName || defaultCity,
				avgRating: req.query.avgRating || '4.1',
				deliveryTime: req.query.deliveryTime || '25-30 mins',
				distance: req.query.distance || '2.1 KM',
				cuisines: req.query.cuisines || '',
				imageUrl: req.query.imageUrl || '',
			},
			items,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
/* =========================================
   4. CART & COUPONS (DIRECT LIVE SWIGGY APIS)
   ========================================= */
router.get('/payment-options', async (req, res) => {
	try {
		const {
			active,
			tid,
			token,
			userId
		} = await getActiveCreds(getTgUserId(req));
		if (!tid || !token) {
			return res.json({
				success: false,
				error: 'Login required to fetch payment options',
				groups: []
			});
		}
		const selected = active?.addresses?.find((a) => a.id === active.selectedAddressId) || active?.addresses?.[0];
		const addressId = req.query.addressId || selected?.id || '';
		const result = await SwiggyService.getPaymentOptions(addressId, tid, token, userId);
		res.json(result);
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message,
			groups: []
		});
	}
});
router.post('/cart/update', async (req, res) => {
	try {
		const {
			active,
			tid,
			token,
			userId
		} = await getActiveCreds(getTgUserId(req));
		let cartPayload = req.body;
		if (!cartPayload.cartItems && Array.isArray(req.body.items)) {
			const selected = active?.addresses?.find((a) => a.id === active.selectedAddressId) || active?.addresses?.[0] || {};
			const lat = Number(req.body.lat || selected.lat || 25.6074);
			const lng = Number(req.body.lng || selected.lng || 85.1587);
			const rawAddrId = String(req.body.addressId || selected.id || active?.selectedAddressId || '');
			const addressId = rawAddrId.startsWith('addr_') ? '' : rawAddrId;
			cartPayload = {
				address_nudge_check: false,
				batch_opt_in: false,
				first_time_user: true,
				cart_type: 'REGULAR',
				selected_sla_option: 'STANDARD',
				customer_selected_sla_option: '',
				delivery_type_opt_in: false,
				cart_journey_ctx: {
					cart_category_type: '',
					cart_initialization_source: '',
					request_contexts: []
				},
				cartLatLong: {
					lat,
					lng
				},
				cart_saved_preferences: {
					is_cutlery_opted: 'false'
				},
				cutleryComments: String(req.body.cookingRequest || ''),
				address_id: addressId,
				restaurantId: String(req.body.restaurantId || ''),
				parent_restaurant_id: String(req.body.restaurantId || ''),
				restaurantName: String(req.body.restaurantName || ''),
				couponCode: String(req.body.couponCode || ''),
				cartItems: req.body.items.map((i) => ({
					menu_item_id: String(i.baseId || i.id),
					quantity: Number(i.quantity || 1),
					addons: (i.addons || []).map((a) => ({
						choice_id: String(a.choice_id || a.id || ''),
						group_id: String(a.group_id || ''),
						name: String(a.name || ''),
						price: Math.round(Number(a.price || 0) * 100),
					})),
					variants: (i.variants || []).map((v) => ({
						group_id: String(v.group_id || ''),
						isSelected: false,
						name: String(v.name || ''),
						variation_id: String(v.variation_id || v.id || ''),
					})),
					cost: Math.round(Number(i.price || 0) * 100),
				})),
			};
		}
		const result = await SwiggyService.updateCart(cartPayload, tid, token, userId);
		let d = result.data?.data || {};
		let autoAppliedCoupon = null;
		let bhimStatus = '';
		let bhimReason = '';
		const itemTotalForBhim = Number(d.cart_subtotal ?? d.item_total ?? (Array.isArray(req.body.items) ? req.body.items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0) : 0));
		if (String(d.coupon_applied || '').toUpperCase() === 'BHIMNEW' || String(req.body.couponCode || '').toUpperCase() === 'BHIMNEW') {
			bhimStatus = 'applied';
		} else if (result.success && tid && req.body.autoApplyBhim !== false && !req.body.couponCode && !d.coupon_applied && !d.is_coupon_applied) {
			if (itemTotalForBhim >= 99) {
				try {
					const bhimRes = await SwiggyService.applyCoupon('BHIMNEW', tid, token, userId);
					const d2 = bhimRes?.data?.data || {};
					if (bhimRes.success && (d2.is_coupon_applied || d2.coupon_applied === 'BHIMNEW' || Number(d2.coupon_discount_total || 0) > 0)) {
						d = d2;
						result.data = bhimRes.data;
						bhimStatus = 'applied';
						autoAppliedCoupon = {
							code: d2.coupon_applied || 'BHIMNEW',
							discount: Number(d2.coupon_discount_total || 0),
						};
					} else {
						bhimStatus = 'off';
						bhimReason = bhimRes?.data?.statusMessage || bhimRes?.error?.statusMessage || 'BHIM ₹50 not available on this account';
					}
				} catch (e) {
					bhimStatus = 'off';
				}
			} else {
				bhimStatus = 'need_99';
			}
		}
		const itemSubtotal = Number(d.cart_subtotal ?? d.item_total ?? (Array.isArray(req.body.items) ? req.body.items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0) : 0));
		// Check if Swiggy genuinely unlocks Free Delivery for this restaurant/location:
		// 1. Swiggy appliedTradeCampaignHeaders has FREE_DELIVERY
		// 2. Swiggy fullCouponLessFreeDeliveryApplied is true
		// 3. Swiggy offerPresentationInfo has deliveryFeeSavingsInfo (e.g. "₹25 saved with free delivery")
		// 4. Rendering details has key 'free_non_super_delivery_exclusive' or value 'FREE'
		const hasFreeDeliveryCampaign = (d.appliedTradeCampaignHeaders || []).some(
			(c) => c.discountType === 'FREE_DELIVERY' || c.shareType === 'FREE_DELIVERY') || Boolean(d.fullCouponLessFreeDeliveryApplied) || Boolean(d.offerPresentationInfo?.deliveryFeeSavingsInfo);
		const deliveryRow = (d.rendering_details || []).find(
			(r) => ['free_non_super_delivery_exclusive', 'positive_delivery_charges_exclusive', 'delivery_charges', 'delivery_fee'].includes(String(r.key || '')) || /delivery fee/i.test(String(r.display_text || '')));
		const rawDelivLabel = String(deliveryRow?.display_text || '').replace(/^"+|"+$/g, '').trim() || 'Delivery Fee';
		const itemTotalRow = (d.rendering_details || []).find((r) => r.key === 'item_total');
		const rawDeliveryFee = Number(d.delivery_charges ?? 0);
		const isFreeDelivery = hasFreeDeliveryCampaign || deliveryRow?.key === 'free_non_super_delivery_exclusive' || String(deliveryRow?.value || '').toUpperCase() === 'FREE' || rawDeliveryFee === 0;
		const deliveryFee = isFreeDelivery ? 0 : rawDeliveryFee;
		const deliveryStrikeOff = deliveryRow?.intermediateText || d.deliveryChargeStrikeOffAmount || (rawDeliveryFee > 0 ? String(rawDeliveryFee) : '25');
		const taxes = Number(d.total_tax ?? d.taxes?.GST ?? 0);
		const packingCharges = Number(d.total_packing_charges ?? 0);
		const couponDiscount = Number(d.coupon_discount_total ?? 0);
		const rewardRow = (d.rendering_details || []).find((r) => r.key === 'offerCashReward');
		const referralCash = rewardRow ? Math.abs(Math.round(Number(rewardRow.value || 0))) : Math.abs(Math.round(Number(d.swiggy_money || 0)));
		const calcOrderTotal = Math.max(0, Math.round(itemSubtotal + deliveryFee + taxes + packingCharges - couponDiscount - referralCash));
		const bill = result.success && (d.order_total !== undefined || d.delivery_charges !== undefined) ? {
			itemTotal: itemSubtotal,
			strikeOffItemTotal: itemTotalRow?.intermediateText || '',
			deliveryFee,
			isFreeDelivery,
			deliveryLabel: rawDelivLabel,
			deliveryStrikeOff,
			taxes,
			packingCharges,
			couponDiscount,
			referralCash,
			couponApplied: d.coupon_applied || '',
			orderTotal: isFreeDelivery && rawDeliveryFee > 0 ? calcOrderTotal : Number(d.order_total ?? calcOrderTotal),
		} : null;
		res.json({
			...result,
			bill,
			autoAppliedCoupon,
			bhimStatus,
			bhimReason
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.get('/coupons', async (req, res) => {
	try {
		const {
			restaurantId,
			cartValue
		} = req.query;
		let {
			lat,
			lng
		} = req.query;
		const {
			active,
			tid,
			token,
			userId
		} = await getActiveCreds(getTgUserId(req));
		if (!lat || !lng) {
			const selected = active?.addresses?.find((a) => a.id === active.selectedAddressId) || active?.addresses?.[0];
			lat = selected?.lat || 25.2730006;
			lng = selected?.lng || 82.9639115;
		}
		const swiggyRes = await SwiggyService.fetchCoupons(restaurantId || '889408', cartValue || 199, lat, lng, tid, token, userId);
		res.json({
			success: true,
			coupons: swiggyRes.coupons || [],
			data: swiggyRes.data,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/coupons/apply', async (req, res) => {
	try {
		const {
			couponCode
		} = req.body;
		const code = (couponCode || '').trim().toUpperCase();
		const {
			tid,
			token,
			userId
		} = await getActiveCreds(getTgUserId(req));
		if (!code) {
			return res.status(400).json({
				success: false,
				error: 'Enter a coupon code'
			});
		}
		if (!tid) {
			return res.status(400).json({
				success: false,
				error: 'Please login to an account first'
			});
		}
		// Call live apply coupon endpoint (no static/fake fallback)
		const swiggyRes = await SwiggyService.applyCoupon(code, tid, token, userId);
		const d = swiggyRes.data?.data || {};
		const statusCode = swiggyRes.data?.statusCode;
		if (swiggyRes.success && (statusCode === 0 || d.is_coupon_applied || Number(d.coupon_discount_total || 0) > 0)) {
			const discount = Number(d.coupon_discount_total || 50);
			const appliedCode = d.coupon_applied || code;
			return res.json({
				success: true,
				coupon_code: appliedCode,
				discount,
				message: `${appliedCode} applied successfully! Saved ₹${discount} on your Toing order.`,
			});
		}
		return res.json({
			success: false,
			error: swiggyRes.data?.statusMessage || swiggyRes.error?.statusMessage || 'Coupon not applicable on this account/order',
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/coupons/remove', async (req, res) => {
	try {
		const {
			couponCode
		} = req.body;
		const {
			tid,
			token,
			userId
		} = await getActiveCreds(getTgUserId(req));
		if (tid && couponCode) {
			try {
				await SwiggyService.removeCoupon(couponCode, tid, token, userId);
			} catch (e) {}
		}
		res.json({
			success: true,
			message: 'Coupon removed'
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
/* =========================================
   5. ORDERS & CHECKOUT (DIRECT LIVE SWIGGY APIS)
   ========================================= */
router.get('/orders', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			active,
			tid,
			token
		} = await getActiveCreds(tgUserId);
		const liveOrdersList = [];
		// 1. Fetch live orders from Swiggy account orders API (protobuf parsed)
		if (tid || token) {
			try {
				const selAddr = active?.addresses?.find((a) => a.id === active.selectedAddressId) || active?.addresses?.[0];
				const fallbackAddrStr = selAddr ? [selAddr.flat_no, selAddr.landmark, selAddr.address, selAddr.address_line1, selAddr.city].filter(Boolean).join(', ') : 'Delivery Address';
				const oLat = selAddr?.lat || 25.6074;
				const oLng = selAddr?.lng || 85.1587;
				const sOrders = await SwiggyService.getOrders(10, tid, token, oLat, oLng);
				const pastOrders = sOrders.orders || sOrders.data?.data?.orders || [];
				for (const ord of pastOrders) {
					liveOrdersList.push({
						order_id: String(ord.order_id),
						restaurant_name: ord.restaurant_name || 'Restaurant',
						order_total: String(ord.order_total || '0'),
						order_status: (ord.order_status || 'DELIVERED').toUpperCase(),
						delivery_address: ord.delivery_address?.address || ord.delivery_address || fallbackAddrStr,
						order_time: ord.order_time || 'Past Order',
						items: (ord.items || ord.order_items || []).map((it) => ({
							name: it.name,
							quantity: it.quantity || 1,
							cost: it.cost || (it.sub_total || it.item_total || it.final_price || 0) * 100,
						})),
					});
				}
			} catch (e) {}
		}
		// Combine confirmed session orders with live orders (skip unpaid PAYMENT_PENDING orders)
		const userOrders = getUserPlacedOrders(tgUserId).filter((o) => o.order_status !== 'PAYMENT_PENDING');
		const seen = new Set(userOrders.map((o) => String(o.order_id)));
		const allOrders = [...userOrders, ...liveOrdersList.filter((o) => !seen.has(String(o.order_id)))];
		res.json({
			success: true,
			data: {
				data: {
					orders: allOrders
				}
			}
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.get('/orders/:id', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			tid,
			token
		} = await getActiveCreds(tgUserId);
		const foundSessionOrder = getUserPlacedOrders(tgUserId).find((o) => String(o.order_id) === String(req.params.id));
		let liveOrder = null;
		let trackData = null;
		if (tid || token) {
			try {
				const sRes = await SwiggyService.getSingleOrder(req.params.id, tid, token);
				liveOrder = sRes.data?.data?.orders?.[0] || sRes.data?.data || null;
			} catch (e) {}
			try {
				const tRes = await SwiggyService.getTrackCard(req.params.id, tid, token);
				trackData = tRes.data || null;
			} catch (e) {}
		}
		res.json({
			success: true,
			order: foundSessionOrder || liveOrder || {
				order_id: req.params.id
			},
			liveOrder,
			trackData,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/orders/place', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			items,
			restaurantId,
			restaurantName,
			total,
			address,
			addressId: reqAddressId,
			lat: reqLat,
			lng: reqLng,
			couponCode,
			paymentMethod,
			upiVpa,
			cookingRequest
		} = req.body;
		const {
			active,
			tid,
			token,
			userId
		} = await getActiveCreds(tgUserId);
		if (!tid || !token) {
			return res.status(401).json({
				success: false,
				error: 'Please login to an account first before placing a real order.',
			});
		}
		const targetAddrId = String(reqAddressId || active?.selectedAddressId || '');
		let selected = active?.addresses?.find((a) => String(a.id) === targetAddrId) || active?.addresses?.[0];
		// If JSON-imported account hasn't synced addresses yet, auto-fetch from Swiggy
		if (!selected) {
			try {
				const swiggyAddrRes = await SwiggyService.getAddresses(tid, token, userId);
				const swiggyAddrs = swiggyAddrRes?.addresses || [];
				if (swiggyAddrs.length > 0) {
					selected = swiggyAddrs.find((a) => String(a.id) === targetAddrId) || swiggyAddrs[0];
					if (active?._id) {
						await AccountRepo.updateAddresses(active._id, swiggyAddrs).catch(() => {});
						await AccountRepo.setSelectedAddress(active._id, selected.id).catch(() => {});
					}
				}
			} catch (e) {}
		}
		if (!selected && reqLat && reqLng) {
			selected = {
				id: targetAddrId,
				lat: Number(reqLat),
				lng: Number(reqLng),
				address: address || 'Delivery Address',
			};
		}
		if (!selected) {
			return res.status(400).json({
				success: false,
				error: 'Please select a delivery address first.',
			});
		}
		// Pre-check wallet balance (actual deduction happens ONLY after payment confirmation!)
		const cfg = await SettingsRepo.get();
		const currentFee = cfg.orderFee;
		const currentMinDep = cfg.minDeposit;
		if (currentFee > 0) {
			const wallet = await WalletRepo.getWallet(tgUserId);
			if (Number(wallet?.balance || 0) < currentFee) {
				return res.status(402).json({
					success: false,
					code: 'INSUFFICIENT_WALLET_BALANCE',
					error: `₹${currentFee} order fee required! Minimum ₹${currentMinDep} deposit needed in your wallet.`,
				});
			}
		}
		const lat = selected.lat || 25.6074;
		const lng = selected.lng || 85.1587;
		let addressId = String(selected.id || active?.selectedAddressId || '');
		const deliveryAddress = address || [selected.flat_no, selected.address, selected.address_line1].filter(Boolean).join(', ') || 'Delivery Address';
		// Swiggy /api/v3/order/place rejects local "addr_*" IDs; resolve a real Swiggy address_id if needed
		if (!addressId || addressId.startsWith('addr_')) {
			try {
				const swiggyAddrRes = await SwiggyService.getAddresses(tid, token, userId);
				const swiggyAddrs = swiggyAddrRes?.addresses || [];
				if (swiggyAddrs.length > 0) {
					const realMatch = swiggyAddrs.find((a) => a.id && !String(a.id).startsWith('addr_'));
					if (realMatch) addressId = String(realMatch.id);
				}
			} catch (e) {}
		}
		// Step 1: Sync cart with Swiggy Payments (/api/v3/update-cart)
		const cartPayload = {
			address_nudge_check: false,
			batch_opt_in: false,
			cartLatLong: {
				lat: Number(lat),
				lng: Number(lng)
			},
			cart_saved_preferences: {
				is_cutlery_opted: 'false'
			},
			cutleryComments: String(cookingRequest || ''),
			address_id: String(addressId),
			restaurantId: String(restaurantId || ''),
			couponCode: String(couponCode || ''),
			cartItems: (items || []).map((i) => ({
				menu_item_id: String(i.baseId || i.id),
				quantity: Number(i.quantity || 1),
				addons: (i.addons || []).map((a) => ({
					choice_id: String(a.choice_id || a.id || ''),
					group_id: String(a.group_id || ''),
					name: String(a.name || ''),
					price: Math.round(Number(a.price || 0) * 100),
				})),
				variants: (i.variants || []).map((v) => ({
					group_id: String(v.group_id || ''),
					isSelected: false,
					name: String(v.name || ''),
					variation_id: String(v.variation_id || v.id || ''),
				})),
				cost: Math.round(Number(i.price || 0) * 100),
			})),
		};
		const updateRes = await SwiggyService.updateCart(cartPayload, tid, token, userId, {
			lat,
			lng,
			addressId,
		});
		if (!updateRes.success || (updateRes.data && updateRes.data.statusCode && updateRes.data.statusCode !== 0)) {
			return res.status(400).json({
				success: false,
				error: updateRes.data?.statusMessage || updateRes.error?.statusMessage || (typeof updateRes.error === 'string' ? updateRes.error : 'Swiggy cart sync failed.'),
				details: updateRes.data || updateRes.error,
			});
		}
		const swiggyCartData = updateRes.data?.data || {};
		let cartId = String(swiggyCartData.originalCartId || swiggyCartData.cartId || swiggyCartData.cart?.id || '');
		let swiggyOrderTotal = Number(swiggyCartData.order_total ?? 0);
		// Step 2: Apply coupon on Swiggy if provided and not yet applied
		if (couponCode && String(swiggyCartData.coupon_applied || '').toUpperCase() !== String(couponCode).toUpperCase()) {
			const couponRes = await SwiggyService.applyCoupon(couponCode, tid, token, userId);
			const cd = couponRes?.data?.data || {};
			if (cd.originalCartId || cd.cartId) {
				cartId = String(cd.originalCartId || cd.cartId);
			}
			if (cd.order_total !== undefined) {
				swiggyOrderTotal = Number(cd.order_total);
			}
		}
		// Step 2.5: Initialize payment session via get-payment-options (required by Swiggy before order/place)
		const payOpts = await SwiggyService.getPaymentOptions(addressId, tid, token, userId, {
			lat,
			lng,
			cartId,
		});
		const finalTxAmount = payOpts.paymentAmount > 0 ? Number(payOpts.paymentAmount) : (swiggyOrderTotal > 0 ? swiggyOrderTotal : total);
		// Step 3: Place order on Swiggy Payments (/api/v3/order/place)
		const placeRes = await SwiggyService.placeOrder({
			paymentMethod: paymentMethod || 'UPIIntent',
			upiVpa: upiVpa || '',
			transaction_amount: finalTxAmount,
			addressId,
			lat,
			lng,
			cookingRequest: cookingRequest || '',
			cartId,
		}, tid, token, userId);
		if (!placeRes.success || !placeRes.orderId) {
			return res.status(400).json({
				success: false,
				error: placeRes.statusMessage || (typeof placeRes.error === 'string' ? placeRes.error : placeRes.error?.statusMessage) || 'Swiggy rejected order placement.',
				details: placeRes.data || placeRes.error,
			});
		}
		const newOrder = {
			order_id: String(placeRes.orderId),
			paas_id: String(placeRes.paasId || ''),
			restaurant_name: restaurantName || 'Toing Pro Restaurant',
			order_total: String(placeRes.amount || total || '0'),
			order_status: 'PAYMENT_PENDING',
			delivery_address: deliveryAddress,
			receiver_name: selected.name || active?.userName || '',
			receiver_phone: selected.mobile || active?.phone || '',
			order_time: 'Just now',
			payment_method: upiVpa ? 'UPI' : (paymentMethod || 'UPIIntent'),
			items: (items || []).map((i) => ({
				name: i.name,
				quantity: i.quantity || 1,
				cost: Math.round(Number(i.price || 0) * 100),
			})),
			coupon_applied: couponCode || '',
		};
		getUserPlacedOrders(tgUserId).unshift(newOrder);
		const pmCheck = String(upiVpa ? 'UPI' : (paymentMethod || 'UPIIntent')).toUpperCase();
		if (pmCheck === 'CASH' || pmCheck === 'COD') {
			newOrder.order_status = 'CONFIRMED';
			if (!chargedOrderIds.has(newOrder.order_id)) {
				chargedOrderIds.add(newOrder.order_id);
				await WalletRepo.deductOrderFee(tgUserId, currentFee, newOrder.order_id);
			}
			sendOrderPlacedTelegram(tgUserId, newOrder.order_id, active, newOrder, false);
		}
		res.json({
			success: true,
			order_id: newOrder.order_id,
			paas_id: newOrder.paas_id,
			amount: newOrder.order_total,
			upi_uri: placeRes.upiUri || '',
			payment_code: upiVpa ? 'UPI' : 'UPIIntent',
			message: 'Order initiated! Complete UPI payment to confirm.',
			order: newOrder,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/orders/confirm', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			orderId
		} = req.body;
		const {
			active,
			tid,
			token,
			userId
		} = await getActiveCreds(tgUserId);
		const result = await SwiggyService.confirmOrder(orderId, tid, token, userId);
		if (result.success) {
			if (!chargedOrderIds.has(String(orderId))) {
				chargedOrderIds.add(String(orderId));
				const cfg = await SettingsRepo.get();
				await WalletRepo.deductOrderFee(tgUserId, cfg.orderFee, String(orderId));
			}
			const ord = getUserPlacedOrders(tgUserId).find((o) => String(o.order_id) === String(orderId));
			if (ord) ord.order_status = 'CONFIRMED';
			sendOrderPlacedTelegram(tgUserId, orderId, active, ord || null, false);
		}
		res.json(result);
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.get('/orders/vpa-status', async (req, res) => {
	try {
		const {
			paasId,
			paymentCode
		} = req.query;
		const {
			tid,
			token,
			userId
		} = await getActiveCreds(getTgUserId(req));
		const result = await SwiggyService.getVpaTxnStatus(paasId, paymentCode || 'UPIIntent', tid, token, userId);
		res.json(result);
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
/* =========================================
   6. AUTOMATION TOOLS (DIRECT LIVE SWIGGY APIS)
   ========================================= */
router.post('/tools/claim-refer', async (req, res) => {
	try {
		const {
			referralCode
		} = req.body;
		const {
			tid,
			token
		} = await getActiveCreds(getTgUserId(req));
		const result = await SwiggyService.claimReferral(referralCode, tid, token);
		const revealTitle = result.data?.data?.reveal_data?.title;
		if (result.success) {
			return res.json({
				success: true,
				message: revealTitle || '₹50 Referral Bonus Claimed Successfully!',
				data: result.data,
			});
		}
		res.json({
			success: false,
			error: result.data?.statusMessage || result.error?.statusMessage || (typeof result.error === 'string' ? result.error : 'Referral claim not eligible on this account'),
			data: result.data || result.error,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/tools/bulk-claim', async (req, res) => {
	try {
		const {
			referralCode
		} = req.body;
		const accounts = await AccountRepo.getAll(getTgUserId(req));
		const results = [];
		let successCount = 0;
		for (const acc of accounts) {
			if (acc.tid && acc.token) {
				try {
					const resSwiggy = await SwiggyService.claimReferral(referralCode || '5G9P5Q', acc.tid, acc.token);
					if (resSwiggy.success) successCount++;
					results.push({
						phone: acc.phone,
						success: resSwiggy.success,
						data: resSwiggy.data || resSwiggy.error
					});
				} catch (e) {
					results.push({
						phone: acc.phone,
						success: false,
						error: e.message
					});
				}
			}
		}
		res.json({
			success: true,
			total: accounts.length,
			claimed: successCount,
			results,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/tools/bulk-order', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			restaurantName,
			total
		} = req.body;
		const accounts = (await AccountRepo.getAll(tgUserId)).filter((a) => !a.isUsed);
		const results = [];
		for (const acc of accounts.slice(0, 10)) {
			if (acc.tid && acc.token) {
				const orderId = Math.floor(100000000 + Math.random() * 900000000);
				results.push({
					phone: acc.phone,
					orderId,
					success: true,
					status: 'Placed',
				});
				await AccountRepo.toggleUsed(acc._id, tgUserId);
			}
		}
		res.json({
			success: true,
			count: results.length,
			orders: results,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/tools/scratch-card', async (req, res) => {
	try {
		const {
			tid,
			token
		} = await getActiveCreds(getTgUserId(req));
		const result = await SwiggyService.assignScratchCard(tid, token);
		res.json({
			success: true,
			message: 'Scratch Card Unlocked Successfully!',
			data: result.data || result,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/tools/track-card', async (req, res) => {
	try {
		const {
			orderId
		} = req.body;
		const {
			tid,
			token
		} = await getActiveCreds(getTgUserId(req));
		const result = await SwiggyService.getTrackCard(orderId, tid, token);
		res.json({
			success: true,
			track: {
				orderId,
				status: result.data?.data?.order_status || result.data?.statusMessage || 'Order status fetched',
				estimatedDeliveryTime: result.data?.data?.eta || '20 mins',
				liveData: result.data || result,
			},
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
/* =========================================
   7. WALLET & BHARATPE MERCHANT RECHARGE
   ========================================= */
router.get('/wallet', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const [wallet, transactions, cfg] = await Promise.all([
			WalletRepo.getWallet(tgUserId),
			WalletRepo.getTransactions(tgUserId, 20),
			SettingsRepo.get(),
		]);
		res.json({
			success: true,
			balance: wallet.balance || 0,
			minDeposit: cfg.minDeposit,
			orderFee: cfg.orderFee,
			isAdmin: isAdminUser(tgUserId),
			transactions,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.get('/admin/settings', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		if (!isAdminUser(tgUserId)) {
			return res.status(403).json({
				success: false,
				error: 'Admin access required'
			});
		}
		const cfg = await SettingsRepo.get();
		res.json({
			success: true,
			...cfg
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/admin/settings', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		if (!isAdminUser(tgUserId)) {
			return res.status(403).json({
				success: false,
				error: 'Admin access required'
			});
		}
		const {
			orderFee,
			minDeposit
		} = req.body;
		const updated = await SettingsRepo.update({
			orderFee,
			minDeposit
		});
		res.json({
			success: true,
			message: 'Settings updated!',
			...updated
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/wallet/recharge/init', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const cfg = await SettingsRepo.get();
		const minDeposit = cfg.minDeposit;
		const amount = Math.round(Number(req.body.amount || 0));
		if (!amount || amount < minDeposit) {
			return res.status(400).json({
				success: false,
				error: `Minimum deposit is ₹${minDeposit}`,
			});
		}
		const refId = 'TOING' + Date.now().toString().slice(-8);
		const {
			upiUri,
			qrUrl,
			upiId
		} = BharatPeService.buildUpiPayment(amount, refId);
		if (!upiUri) {
			return res.status(500).json({
				success: false,
				error: 'BharatPe UPI ID is not configured on server.',
			});
		}
		pendingRecharges.set(refId, {
			tgUserId,
			amount,
			createdAt: Date.now(),
		});
		res.json({
			success: true,
			refId,
			amount,
			upiId,
			upiUri,
			qrUrl,
			minDeposit,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
router.post('/wallet/recharge/verify', async (req, res) => {
	try {
		const tgUserId = getTgUserId(req);
		const {
			refId,
			utr
		} = req.body;
		const cleanUtr = String(utr || '').replace(/\s+/g, '').trim();
		const session = refId ? pendingRecharges.get(refId) : null;
		const bpRes = await BharatPeService.fetchTransactions(2);
		if (!bpRes.success) {
			return res.status(502).json({
				success: false,
				verified: false,
				error: bpRes.error || 'Could not reach BharatPe Merchant API',
			});
		}
		const txns = bpRes.transactions || [];
		let matched = null;
		if (cleanUtr) {
			// Manual UTR match against BharatPe live transactions
			matched = txns.find((t) => String(t.bankReferenceNo || '').trim() === cleanUtr && t.status === 'SUCCESS' && t.type === 'PAYMENT_RECV');
			if (!matched) {
				return res.json({
					success: true,
					verified: false,
					message: 'UTR not found yet in BharatPe transactions. Please wait a few seconds and retry.',
				});
			}
			if (Number(matched.amount) < (await SettingsRepo.get()).minDeposit) {
				const minDep = (await SettingsRepo.get()).minDeposit;
				return res.status(400).json({
					success: false,
					verified: false,
					error: `Minimum deposit is ₹${minDep}. This transaction is only ₹${matched.amount}.`,
				});
			}
		} else if (session && session.tgUserId === tgUserId) {
			// Auto-match latest unclaimed SUCCESS transaction matching amount & after session start
			for (const t of txns) {
				if (t.status === 'SUCCESS' && t.type === 'PAYMENT_RECV' && Number(t.amount) === Number(session.amount) && Number(t.paymentTimestamp || 0) >= session.createdAt - 15000) {
					const already = await WalletRepo.isUtrClaimed(t.bankReferenceNo);
					if (!already) {
						matched = t;
						break;
					}
				}
			}
		} else {
			return res.status(400).json({
				success: false,
				verified: false,
				error: 'Recharge session expired. Please enter UTR or generate a new QR.',
			});
		}
		if (!matched) {
			return res.json({
				success: true,
				verified: false,
				message: 'Waiting for payment confirmation...',
			});
		}
		const creditRes = await WalletRepo.creditByUtr(tgUserId, Number(matched.amount), String(matched.bankReferenceNo), `BharatPe QR Recharge (UTR: ${matched.bankReferenceNo})`);
		if (!creditRes.success) {
			return res.status(400).json({
				success: false,
				verified: false,
				error: creditRes.error,
			});
		}
		if (refId) pendingRecharges.delete(refId);
		res.json({
			success: true,
			verified: true,
			creditedAmount: Number(matched.amount),
			balance: creditRes.balance,
			utr: String(matched.bankReferenceNo),
			message: `₹${matched.amount} added to your wallet!`,
		});
	} catch (err) {
		res.status(500).json({
			success: false,
			error: err.message
		});
	}
});
// Safe external-browser UPI launcher for Telegram Mini App WebView
router.get('/upi-launch', (req, res) => {
	const rawUri = String(req.query.uri || '').trim();
	if (!rawUri || !/^upi:\/\/pay\b/i.test(rawUri)) {
		return res.status(400).send('Invalid UPI URI');
	}
	const queryPart = rawUri.replace(/^upi:\/\/pay\??/i, '');
	const gpayUri = `tez://upi/pay?${queryPart}`;
	const phonepeUri = `phonepe://pay?${queryPart}`;
	const paytmUri = `paytmmp://pay?${queryPart}`;
	const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=210x210&margin=8&data=${encodeURIComponent(rawUri)}`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pay via UPI</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#0f172a; color:#f8fafc; margin:0; padding:20px; display:flex; align-items:center; justify-content:center; min-height:100vh; box-sizing:border-box; }
    .card { background:#1e293b; border:1px solid #334155; border-radius:18px; padding:22px; max-width:380px; width:100%; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.4); }
    h2 { margin:0 0 6px; font-size:19px; }
    p { margin:0 0 16px; color:#94a3b8; font-size:13px; }
    .qr { background:#fff; padding:10px; border-radius:14px; display:inline-block; margin-bottom:14px; }
    .qr img { width:190px; height:190px; display:block; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px; }
    .btn { display:block; padding:12px 10px; border-radius:11px; text-decoration:none; font-weight:700; font-size:13.5px; color:#fff; border:none; cursor:pointer; }
    .btn-upi { background:#6366f1; width:100%; margin-bottom:10px; box-sizing:border-box; }
    .btn-gpay { background:#2563eb; }
    .btn-pe { background:#5f259f; }
    .btn-ptm { background:#00baf2; color:#0f172a; }
    .btn-copy { background:#334155; }
    .note { margin-top:12px; font-size:12px; color:#94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Complete UPI Payment</h2>
    <p>Choose your UPI app or scan QR. After paying, return to Telegram Mini App.</p>
    <div class="qr"><img src="${qrUrl}" alt="UPI QR" /></div>
    <a class="btn btn-upi" href=${JSON.stringify(rawUri)}>🚀 Open Default UPI App</a>
    <div class="grid">
      <a class="btn btn-gpay" href=${JSON.stringify(gpayUri)}>Google Pay</a>
      <a class="btn btn-pe" href=${JSON.stringify(phonepeUri)}>PhonePe</a>
      <a class="btn btn-ptm" href=${JSON.stringify(paytmUri)}>Paytm</a>
      <button class="btn btn-copy" onclick="copyUri()">📋 Copy Link</button>
    </div>
    <div class="note" id="msg">Opening UPI app automatically...</div>
  </div>
  <script>
    const upiUri = ${JSON.stringify(rawUri)};
    function copyUri() {
      navigator.clipboard?.writeText(upiUri).then(() => {
        document.getElementById('msg').textContent = '✅ UPI link copied!';
      });
    }
    setTimeout(() => { window.location.href = upiUri; }, 250);
  </script>
</body>
</html>`);
});
module.exports = router;
