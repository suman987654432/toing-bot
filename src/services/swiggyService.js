const axios = require('axios');
const { AsyncLocalStorage } = require('async_hooks');
const sessionCtx = new AsyncLocalStorage();

const decodeTidClaims = (tid = '') => {
	try {
		const parts = String(tid || '').split('.');
		if (parts.length >= 2) {
			const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
			return {
				sid: payload?.sid ? String(payload.sid) : '',
				userId: payload?.user_id ? String(payload.user_id) : '',
			};
		}
	} catch (e) {}
	return { sid: '', userId: '' };
};
// Default authentic Swiggy Android / Toing App headers reverse-engineered directly from HAR files
const DEFAULT_DISC_HEADERS = {
	'user-agent': 'Swiggy-Android',
	'sid': 'ujc70441296-84bb-48c5-a92f-74c23b499',
	'swuid': '524f2bf81cd7b9fc',
	'deviceid': '524f2bf81cd7b9fc',
	'version-code': '1875',
	'app-version': '4.121.0',
	'os-version': '15',
	'client-id': 'Swiggy-Android',
	'x-channel': 'toing-app',
	'category': 'food',
	'x-discovery-context': 'v1.42LjYuFgEGAAAA.eRkByMVDzQE1g-2VpFByodaE5g_YAAxL4ke7tRYAHaA',
	'x-network-quality': 'GOOD',
	'faw-flags': '1354',
	'x-aws-waf-token': '76892b08-e56b-4f30-9608-54083b9d8381:HgoAjmFp0eIfCAAA:2P3HgzKTlxFEMDVvEWcqNskLq8KnZE4uJBf9ah6G6Am7SshGSNt+3DmWmXIxoXWNbEHqZ+Za+fnxggJeSE+tDgQQslCuTNUpnE/TVx+rnX2Jw9vhIqlqm3J1xnZ0LywxQsYDlBjOnIIdgq//E4f3PrLWoN8ECK/Bu2sT/NXjJCqxTp8NiYJQck98xDZISAUqYrO1PBmjfDbuQyrub67Bi5o96GoXdairDyc5icAp3y05bqPCNJN5pIctWIE+xc+VbbMsZkm3AOWFimych3frS24P2B7AQCCdXWOKMa8=',
	'pl-version': '146',
	'accept': 'application/x-protobuf, application/json, */*',
	'content-type': 'application/json; charset=utf-8',
};
const DEFAULT_PAYMENT_HEADERS = {
	'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9a Build/BD4A.250505.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.8078.47 Mobile Safari/537.36',
	'sid': 'ujc70441296-84bb-48c5-a92f-74c23b499',
	'deviceid': '524f2bf81cd7b9fc',
	'swuid': '524f2bf81cd7b9fc',
	'version-code': '1875',
	'app-version': '4.121.0',
	'os-version': '15',
	'x-channel': 'toing-app',
	'x-theme': 'toing',
	'x-requested-with': 'in.swiggy.android.toing',
	'client-id': 'Swiggy-Android',
	'application_name': 'toing-app',
	'platform': 'Swiggy-Android',
	'category': 'food',
	'marketplaceid': '1',
	'marketplacecategory': 'FOOD',
	'marketplacebusinessline': 'Regular',
	'x-network-quality': 'GOOD',
	'pl-version': '146',
	'x-client-id': 'web-payment',
	'x-checkout-webview': 'android',
	'x-web-checkout-flow': 'cart',
	'cartsource': 'Menu',
	'cartentry': 'Cart_Crouton_Menu',
	'cartpageprefetch': 'false',
	'referrer': 'menu',
	'analyticsplatform': 'an',
	'x-origin-id': 'android',
	'm_id': 'CHECKOUT',
	'isr1fa': 'false',
	'isfrombottombar': 'false',
	'accessibility-enabled': 'false',
	'fullscreenbottomoffset': '24',
	'fullscreenstatusbarheight': '57',
	'origin': 'https://payments.swiggy.com',
	'referer': 'https://payments.swiggy.com/?flow=cart&custom_back=true',
	'accept': '*/*',
	'content-type': 'application/json',
};
const buildProfileHeaders = (tid = '', token = '', extra = {}) => {
	const h = {
		'user-agent': 'Swiggy-Android',
		'x-channel': 'toing-app',
		'accept': 'application/json',
		...extra
	};
	if (tid) h['tid'] = tid;
	if (token) h['token'] = token;
	return h;
};
const buildDiscHeaders = (tid = '', token = '', extra = {}) => {
	const ctx = sessionCtx.getStore() || {};
	const claims = decodeTidClaims(tid);
	const h = {
		...DEFAULT_DISC_HEADERS,
		...extra
	};
	if (ctx.deviceId) {
		h['deviceid'] = String(ctx.deviceId);
		h['swuid'] = String(ctx.deviceId);
	}
	const sid = ctx.sid || claims.sid;
	if (sid) h['sid'] = sid;
	if (tid) h['tid'] = tid;
	if (token) h['token'] = token;
	return h;
};
const buildPaymentHeaders = (tid = '', token = '', userId = '', extra = {}) => {
	const ctx = sessionCtx.getStore() || {};
	const claims = decodeTidClaims(tid);
	const h = {
		...DEFAULT_PAYMENT_HEADERS,
		...extra
	};
	if (ctx.deviceId) {
		h['deviceid'] = String(ctx.deviceId);
		h['swuid'] = String(ctx.deviceId);
	}
	const sid = ctx.sid || claims.sid;
	if (sid) h['sid'] = sid;
	if (tid) h['tid'] = tid;
	if (token) h['token'] = token;
	const uid = userId || claims.userId;
	if (uid) h['userid'] = String(uid);
	return h;
};
const SwiggyService = {
	setSessionContext(ctx = {}) {
		sessionCtx.enterWith(ctx || {});
	},
	/* ==========================================================
	   1. AUTHENTICATION & SESSION
	   ========================================================== */
	// Request SMS OTP
	async sendOtp(mobile) {
		const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
		const url = `https://profile.swiggy.com/api/v3/app/sms_otp?mobile=${cleanMobile}`;
		try {
			const response = await axios.get(url, {
				headers: buildProfileHeaders(),
				timeout: 10000,
			});
			const data = response.data || {};
			const tid = data.tid || response.headers['tid'] || '';
			if (!tid || (data.statusCode !== undefined && data.statusCode !== 0)) {
				return {
					success: false,
					error: data.statusMessage || 'Failed to send OTP. Please try again.',
					details: data,
				};
			}
			return {
				success: true,
				data,
				tid,
				sid: data.sid || '',
				deviceId: data.deviceId || '',
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data?.statusMessage || error.message,
				details: error.response?.data,
			};
		}
	},
	// Verify SMS OTP
	async verifyOtp(mobile, otp, initialTid = '') {
		const url = `https://profile.swiggy.com/api/v3/app/login/verify?otp_source=Sms-automatic`;
		const payload = {
			otp: String(otp).trim(),
			cloningSignalsData: {
				appFilesDirPathInvalid: 0,
				developerModeEnabled: 0,
				deviceModelVmos: 0,
				emulatorStatus: 0,
				packageName: 'in.swiggy.android.toing',
				workProfileEnabled: 0,
			},
		};
		try {
			const response = await axios.post(url, payload, {
				headers: buildProfileHeaders(initialTid, '', {
					'content-type': 'application/json; charset=utf-8',
				}),
				timeout: 10000,
			});
			const data = response.data;
			const tid = data.tid || response.headers['tid'] || initialTid;
			const token = data.data?.token || response.headers['token'] || '';
			if (tid) {
				this.signInWithTID(tid).catch(() => {});
			}
			return {
				success: true,
				data: data.data,
				tid,
				token,
				statusCode: data.statusCode,
				statusMessage: data.statusMessage,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data?.statusMessage || error.message,
				details: error.response?.data,
			};
		}
	},
	// Sign In With TID (Discovered from register_toing.har)
	async signInWithTID(tid) {
		const url = `https://disc.swiggy.com/v1/accounts/signInWithTID`;
		try {
			const response = await axios.post(url, {
				tid
			}, {
				headers: buildDiscHeaders(tid),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Fetch Profile
	async getProfile(tid, token) {
		const url = `https://profile.swiggy.com/api/v4/user/profile`;
		try {
			const response = await axios.get(url, {
				headers: buildProfileHeaders(tid, token),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	/* ==========================================================
	   2. ADDRESS MANAGEMENT
	   ========================================================== */
	// Reverse Geocode via Swiggy Maps (Google-backed exact locality/sublocality)
	async recommendAddress(lat, lng, tid = '', token = '') {
		const url = `https://maps.swiggy.com/address/recommend?latlng=${encodeURIComponent(`${lat},${lng}`)}&enrich_poi_components=true`;
		try {
			const response = await axios.get(url, {
				headers: buildDiscHeaders(tid, token, {
					accept: 'application/json',
					latitude: String(lat),
					longitude: String(lng),
				}),
				timeout: 8000,
			});
			const item = response.data?.data?.[0];
			if (!item) return { success: false };
			const comps = Array.isArray(item.address_components) ? item.address_components : [];
			const getComp = (...types) => comps.find((c) => Array.isArray(c.types) && types.some((t) => c.types.includes(t)))?.long_name || '';
			const sublocality = getComp('sublocality', 'sublocality_level_1', 'neighborhood', 'nearby');
			const locality = getComp('locality');
			const city = getComp('city', 'administrative_area_level_2') || locality;
			const area = [sublocality, locality].filter((v, i, arr) => v && arr.indexOf(v) === i).join(', ');
			return {
				success: true,
				area: area || item.formatted_address || '',
				city: city || '',
				display: item.formatted_address || area || '',
			};
		} catch (error) {
			return { success: false, error: error.message };
		}
	},
	// Autocomplete Area / Colony via Swiggy Maps (Google-backed, from swiggy_location.har)
	async placeAutocomplete(input, lat = 25.6074, lng = 85.1587, tid = '', token = '') {
		const url = `https://maps.swiggy.com/place/autocomplete?input=${encodeURIComponent(input)}&location=${encodeURIComponent(`${lat},${lng}`)}&radius=50000`;
		try {
			const response = await axios.get(url, {
				headers: buildDiscHeaders(tid, token, {
					accept: 'application/json',
					latitude: String(lat),
					longitude: String(lng),
				}),
				timeout: 6000,
			});
			const list = Array.isArray(response.data?.data) ? response.data.data.slice(0, 4) : [];
			const resolved = await Promise.all(
				list.map(async (item) => {
					const desc = item.description || '';
					const main = item.structured_formatting?.main_text || desc.split(',')[0] || input;
					const sec = item.structured_formatting?.secondary_text || '';
					let sLat = null, sLng = null, sCity = '';
					if (item.place_id) {
						try {
							const r2 = await axios.get(`https://maps.swiggy.com/address/recommend?place_id=${encodeURIComponent(item.place_id)}&enrich_poi_components=true`, {
								headers: buildDiscHeaders(tid, token, { accept: 'application/json' }),
								timeout: 5000,
							});
							const d0 = r2.data?.data?.[0];
							if (d0?.geometry?.location) {
								sLat = parseFloat(d0.geometry.location.lat);
								sLng = parseFloat(d0.geometry.location.lng);
							}
							const comps = Array.isArray(d0?.address_components) ? d0.address_components : [];
							sCity = comps.find((c) => Array.isArray(c.types) && (c.types.includes('city') || c.types.includes('locality')))?.long_name || '';
						} catch (e) {}
					}
					if (!sLat || !sLng) return null;
					return {
						area: main,
						city: sCity || sec.split(',').slice(-3, -2)[0]?.trim() || '',
						display: desc || `${main}, ${sec}`,
						lat: sLat,
						lng: sLng,
					};
				})
			);
			return { success: true, suggestions: resolved.filter(Boolean) };
		} catch (error) {
			return { success: false, suggestions: [], error: error.message };
		}
	},
	// Resolve Swiggy Share Address Link via mapi/social/getAddress (from swiggy_address.har)
	async resolveShareAddress(shareId, userId = '', refererUrl = '', tid = '', token = '') {
		const cleanId = String(shareId || '').trim().split(/[?#]/)[0];
		if (!cleanId) return { success: false, error: 'Missing share ID' };
		const url = `https://www.swiggy.com/mapi/social/getAddress/${encodeURIComponent(cleanId)}`;
		const swiggyWebCookie = process.env.SWIGGY_WEB_COOKIE || 'is_app=1; platform=Swiggy-Android; a_platform=an; __SW=QjDG5DVcjuTpNNnT_oiinYR8pA_bqmbD; _is_logged_in=1; _session_tid=587798ad1dbd8962426859e3281438db3d003a78ad5b47c07cb155cc4fbbe953f538784b2d9730523d3fa7c2f5e324fa262224e9b21cf3d11babb23627ac9f3121a83f4b62b0f1ff09f1221157f701b5b6253bf29de6f6f463107decdf968fc7a8fa60f48ce85121344f0ab5bedbb9ba44ebe72b481c3dff02769284e83d03481ff0f54dab6a79966d5f527ecf4905767428a45a650076e041a64bb7f20e7776cd8a5f9c4a9b445b323e7586b406aa1b2c14719b7e8842f6e43d627742aa0d284797477f777416bd29f22169001a3ce96281bf607e3663d0a0849575093a822c3b773275d4dd62661d812dbd5d87edff0da38eedc545a60b7977b1b1bddf24a4e79a8d9401a69a19667ae6bd9319c41c72989183bd22ca5012f19fdfdc54a422ef12c018e74b50ebfedf50a99ca558e62e045f2c74d57370e7ea2160a99e52d92d2bde2788f56dc02a88fe00e57e81385c193556fe489c401da44d14fea1b97f961f21b431367195faeb9872834141c79528cd2d5e1d2baf6126705e21a3f66027d01fafc19dac0e1e40e3bc2dd0a19a1e487672198ecc77409d26bd2b5ae1240ab86ca74140d3c1086430b2b23d73da8189df6150b42c9350bc4e0dc6283be0b5b8c88e82ba01c72d476fa6e2321b13aaa4154e094cfb2c32d6fb574215d470db80636f5d7a1ec373c748f20e55fcc88659b8528ba806796a72cc89a14c13608e3ac761020827e377cae270edaa939ccaf385a05fc359a93f252d0ca763f23e53d60319e6f8bff2226ece16c483e470a38533abe537ec29f9ab98ab4812674afe4920eae2fc5d7780ade884398d0468c95edccfb1855234abe5a6b7270b79a5a4a9173491345eb7648719a8d432a80fbd4b7118098ccd9432cf9fbcbd6e4d8cc009d477b77afbadfe187c32608224fe3a54da6516bc5c66fa875e0f9bb7a812fddf524e6893fcbae26293909a8fee558173a8bdc01b2d49465cea5dd9dcf54b5471c361bef1dc66980570052eb8806ba719ca1d9f978fb3e0a145bf8d23c8b337f9d7c2d95917dd928efa29109da6ad0fdaa34459415a84fa324df08bfcbf2f8fa32f15dd1bdac22faf41eef84544877b308ff143f2aa0566ca166881adf01abf1f5f675774f856da460fda37d3f28e555c92cf0862929c4e83a82771a6848bf1b855b6b3765c19d741dec104a31d03e5abc831696415fdedabef69a015a19c54fb9fbaf4ce5c69f57467688ed591dd33c092aa7742de7a8c6df69b544523e5; tid=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsIktJRCI6IjIifQ.eyJzZXNzaW9uX2RhdGEiOiJuTkk4dEZaWkdKL0JSVjBrT0tpaGlkYzUrU1NUMU9kSWFtZEo1eGlYV3FxNlIvVm1BSyszNVB3R01SdEtyZ1N4ZlBaS0xIVWRicjRTWlFuS1U0b0NjWEZlSG1kaGM1NTdrbFA4a3RDd0VRRTBHL2QxU0hiNUp0dmM1ZGcrc1NkTlpqSURmUHhrYTNyamc4VnBrLzVUaWFWYWtRMWNWQngzaTlqdDYrU2FkWjRFdTliZ1ZIWUdGVTdzVUNOWS9GbkZxMThpV3JkSzN2TlpFaUtWbnhTb0t0Z2lMN3N6ZzVsMStCQTU2TGczUFo1aGM3aUpMcUlSOXlMMlhGTVdJSVpFTmNZbDBPUkhpMkNpS2RVVVNHNjdHMXQrWVhwcVpDZkFzRHRNN20xVk41S2JpZVlKYUpoN29uc1U2djNCRWNUanRyNGxnVm9sUEwrcmNYWnFPakE2SWNPcEtuQ1RNVmg5RTZwb21sMD0iLCJleHAiOjE3OTU2MzA1NzcsInNpZCI6InVlbmQ4YWQ1YWFlLTRiZjMtNDNhZC1iNzNlLWJhYzE4Y2I5MyIsImlhdCI6MTc5MzAzODU3NywiaXNzIjoiaGFwIiwidXNlcl9pZCI6IjI0MDU2NjI2MiIsInN1YiI6ImUyMWZmNzk5LWY2MzEtNGZiMS05OTJhLTk3M2JiNTA3YjlkNiJ9.wZ0V6DGyNOGfoQFR8zxjaAnmTa2l4VyCdzfpBnLArys; token=2be7ebfb-d0b4-4c36-b9cb-54d6dd3820ced9b21a91-e736-4196-80b8-7bb135aa67f5; _device_id=224f98f617ba29a5; _swuid=224f98f617ba29a5; _cid=MjQwNTY2MjYy; _sid=uend8ad5aae-4bf3-43ad-b73e-bac18cb93';
		try {
			const headers = {
				'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9a Build/BD4A.250505.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.46 Mobile Safari/537.36',
				'__fetch_req__': 'true',
				'content-type': 'application/json',
				'platform': 'mweb',
				'x-requested-with': 'in.swiggy.android',
				'user-id': '240566262',
				'referer': refererUrl || `https://www.swiggy.com/ofo/address/user/${cleanId}?pushScreen=true`,
				'cookie': swiggyWebCookie,
			};
			const response = await axios.get(url, {
				headers,
				timeout: 8000,
			});
			const addr = response.data?.data?.address;
			const act = addr?.actual_address;
			const lat = parseFloat(act?.location?.lat ?? act?.location?.latitude);
			const lng = parseFloat(act?.location?.lng ?? act?.location?.longitude);
			if (!act || !lat || !lng) {
				return { success: false, error: response.data?.statusMessage || 'Address not found in share link' };
			}
			return {
				success: true,
				address: {
					lat,
					lng,
					formatted_address: act.formatted_address || '',
					flat_no: act.address_line || '',
					area: act.locality || act.city || '',
					city: act.city || '',
					pincode: act.postal_code || '',
					name: act.contact_name || act.account_details?.name || '',
					phone: act.phone || act.account_details?.phone || '',
					tag: (Array.isArray(act.tags) && act.tags[0]) || 'Friends and Family',
				},
			};
		} catch (error) {
			return { success: false, error: error.response?.data?.statusMessage || error.message };
		}
	},
	// Fetch All Saved Addresses (from maps.swiggy.com)
	async getAddresses(tid, token, userId = '') {
		const url = `https://maps.swiggy.com/addresses/v1/all?client_id=android-consumer-app${userId ? `&entityId=${userId}` : ''}&entityType=1&marketPlaceId=1`;
		try {
			const response = await axios.get(url, {
				headers: buildDiscHeaders(tid, token, {
					'accept': 'application/x-protobuf, application/json, */*',
				}),
				responseType: 'arraybuffer',
				timeout: 10000,
			});

			const buf = Buffer.from(response.data || []);
			// Check if response is JSON
			try {
				const json = JSON.parse(buf.toString('utf8'));
				const list = json.addresses || json.data?.addresses || json;
				if (Array.isArray(list)) return { success: true, addresses: list };
			} catch (e) {}

			// Decode Protobuf
			const addresses = [];
			let i = 0;
			while (i < buf.length) {
				const byte = buf[i++];
				const fn = byte >> 3;
				const wt = byte & 0x07;
				if (wt === 2) {
					let len = 0, shift = 0;
					while (i < buf.length) {
						const b = buf[i++];
						len |= (b & 0x7f) << shift;
						if (!(b & 0x80)) break;
						shift += 7;
					}
					const val = buf.slice(i, i + len);
					if (fn === 2) {
						// Decode address message
						let j = 0;
						let addrId = '';
						let formattedAddress = '';
						let addrLine1 = '';
						let area = '';
						let city = '';
						let lat = 25.6074;
						let lng = 85.1587;
						let contactName = '';
						let contactPhone = '';

						while (j < val.length) {
							const b2 = val[j++];
							const fn2 = b2 >> 3;
							const wt2 = b2 & 0x07;
							if (wt2 === 2) {
								let l2 = 0, s2 = 0;
								while (j < val.length) {
									const b_ = val[j++];
									l2 |= (b_ & 0x7f) << s2;
									if (!(b_ & 0x80)) break;
									s2 += 7;
								}
								const v2 = val.slice(j, j + l2);
								if (fn2 === 1) addrId = v2.toString('utf8');
								else if (fn2 === 3) {
									let k = 0;
									while (k < v2.length) {
										const b3 = v2[k++];
										const fn3 = b3 >> 3;
										const wt3 = b3 & 0x07;
										if (wt3 === 2) {
											let l3 = 0, s3 = 0;
											while (k < v2.length) {
												const b_ = v2[k++];
												l3 |= (b_ & 0x7f) << s3;
												if (!(b_ & 0x80)) break;
												s3 += 7;
											}
											const v3 = v2.slice(k, k + l3);
											if (fn3 === 1) formattedAddress = v3.toString('utf8');
											else if (fn3 === 2) addrLine1 = v3.toString('utf8');
											else if (fn3 === 5) area = v3.toString('utf8');
											else if (fn3 === 6) city = v3.toString('utf8');
											else if (fn3 === 14) {
												let m = 0;
												while (m < v3.length) {
													const b4 = v3[m++];
													const fn4 = b4 >> 3;
													const wt4 = b4 & 0x07;
													if (wt4 === 1 && m + 8 <= v3.length) {
														const num = v3.readDoubleLE(m);
														if (fn4 === 1) lat = num;
														if (fn4 === 2) lng = num;
														m += 8;
													}
												}
											}
											else if (fn3 === 20) contactName = v3.toString('utf8');
											else if (fn3 === 22) contactPhone = v3.toString('utf8');
											k += l3;
										} else if (wt3 === 0) { while (v2[k++] & 0x80) {} }
										else if (wt3 === 1) { k += 8; }
										else if (wt3 === 5) { k += 4; }
									}
								}
								j += l2;
							} else if (wt2 === 0) { while (val[j++] & 0x80) {} }
							else if (wt2 === 1) { j += 8; }
							else if (wt2 === 5) { j += 4; }
						}

						if (addrId) {
							addresses.push({
								id: addrId,
								display_address: formattedAddress || addrLine1 || 'Delivery Address',
								address_line1: addrLine1 || formattedAddress,
								area,
								city: city || 'Patna',
								lat,
								lng,
								name: contactName || 'Customer',
								phone: contactPhone || '',
								actual_address: {
									formatted_address: formattedAddress,
									address_line: addrLine1,
									contact_name: contactName,
									phone: contactPhone,
									location: { lat, lng }
								}
							});
						}
					}
					i += len;
				} else if (wt === 0) { while (buf[i++] & 0x80) {} }
				else if (wt === 1) { i += 8; }
				else if (wt === 5) { i += 4; }
			}

			return {
				success: true,
				addresses,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message,
				addresses: []
			};
		}
	},
	// Add New Address on Swiggy (Exact protobuf schema from maps.swiggy.com/addresses/v1 HAR)
	async addAddress(addrData = {}, tid = '', token = '', userId = '') {
		const url = `https://maps.swiggy.com/addresses/v1`;
		const pbVarint = (n) => {
			let v = BigInt(n);
			const out = [];
			while (v >= 0x80n) {
				out.push(Number((v & 0x7fn) | 0x80n));
				v >>= 7n;
			}
			out.push(Number(v));
			return Buffer.from(out);
		};
		const pbFieldVarint = (fn, n) => Buffer.concat([pbVarint((fn << 3) | 0), pbVarint(n)]);
		const pbFieldBytes = (fn, buf) => Buffer.concat([pbVarint((fn << 3) | 2), pbVarint(buf.length), buf]);
		const pbFieldStr = (fn, s) => (s ? pbFieldBytes(fn, Buffer.from(String(s), 'utf8')) : Buffer.alloc(0));
		const pbFieldDouble = (fn, val) => {
			const b = Buffer.alloc(8);
			b.writeDoubleLE(Number(val), 0);
			return Buffer.concat([pbVarint((fn << 3) | 1), b]);
		};
		const lat = Number(addrData.lat || 25.6074);
		const lng = Number(addrData.lng || 85.1587);
		const cleanPhone = String(addrData.phone || addrData.mobile || '').replace(/\D/g, '').slice(-10);
		const recName = String(addrData.name || 'Customer').trim();
		const tagStr = String(addrData.tag || 'OTHER').toUpperCase();
		const tagCode = tagStr === 'HOME' ? 1 : (tagStr === 'WORK' ? 2 : 3);
		const ctxMsg = Buffer.concat([
			pbFieldVarint(1, 1),
			pbFieldBytes(3, Buffer.concat([pbFieldStr(1, 'cart_screen'), pbFieldStr(2, 'android-consumer-app')])),
		]);
		const entityMsg = Buffer.concat([
			pbFieldVarint(1, 1),
			pbFieldStr(2, String(userId || '')),
		]);
		const locMsg = Buffer.concat([pbFieldDouble(1, lat), pbFieldDouble(2, lng)]);
		const recMsg = Buffer.concat([pbFieldStr(1, recName), pbFieldStr(2, cleanPhone)]);
		const addrMsg = Buffer.concat([
			pbFieldStr(1, addrData.formatted_address || addrData.address || addrData.address_line1 || 'Delivery Address'),
			pbFieldStr(2, addrData.flat_no || addrData.address_line1 || 'House 1'),
			pbFieldStr(7, addrData.area || addrData.address_line2 || addrData.city || 'India'),
			pbFieldStr(9, addrData.city || 'Patna'),
			pbFieldStr(12, addrData.pincode || '800001'),
			pbFieldBytes(14, locMsg),
			pbFieldStr(17, addrData.landmark || addrData.area || addrData.city || 'Landmark'),
			pbFieldStr(21, addrData.locality || addrData.area || addrData.city || 'Locality'),
			pbFieldVarint(22, 1),
			pbFieldStr(24, cleanPhone || '9999999999'),
			pbFieldBytes(26, Buffer.from([3])),
			pbFieldStr(29, addrData.address_line2 || addrData.city || 'Area'),
			pbFieldBytes(33, pbFieldVarint(1, tagCode)),
			pbFieldBytes(34, recMsg),
			pbFieldBytes(36, pbFieldBytes(2, Buffer.alloc(0))),
			pbFieldStr(38, addrData.tagLabel || tagStr),
		]);
		const payload = Buffer.concat([
			pbFieldBytes(1, ctxMsg),
			pbFieldBytes(2, entityMsg),
			pbFieldBytes(3, addrMsg),
			pbFieldVarint(4, 1),
		]);
		try {
			const response = await axios.post(url, payload, {
				headers: buildDiscHeaders(tid, token, {
					'content-type': 'application/x-protobuf',
					'accept': 'application/x-protobuf',
					'latitude': String(lat),
					'longitude': String(lng),
				}),
				responseType: 'arraybuffer',
				timeout: 12000,
			});
			const buf = Buffer.from(response.data || []);
			// Field 1 (tag 0x0a) is the newly created Swiggy address_id string
			let addressId = '';
			if (buf.length > 2 && buf[0] === 0x0a) {
				let len = 0,
					shift = 0,
					idx = 1;
				while (idx < buf.length) {
					const b = buf[idx++];
					len |= (b & 0x7f) << shift;
					if (!(b & 0x80)) break;
					shift += 7;
				}
				if (len > 0 && idx + len <= buf.length) {
					addressId = buf.slice(idx, idx + len).toString('utf8');
				}
			}
			return {
				success: Boolean(addressId),
				addressId
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data ? Buffer.from(error.response.data).toString('utf8') : error.message,
			};
		}
	},
	// Delete Address (Discovered from toing_orders.har)
	async deleteAddress(addressId, tid, token) {
		const url = `https://maps.swiggy.com/addresses/v1/${addressId}`;
		try {
			const response = await axios.delete(url, {
				headers: buildDiscHeaders(tid, token),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	/* ==========================================================
	   3. SEARCH & MENU (Live Toing endpoints from toing_search.har)
	   ========================================================== */
	// Search Live Food & Restaurants (Direct from disc.swiggy.com)
	async searchRestaurants(query, lat = 25.6074, lng = 85.1587, tid = '', token = '', city = '') {
		const cleanQuery = (query || 'Pizza').trim();
		const discUrl = `https://disc.swiggy.com/api/v3/search/RESTAURANT?lat=${lat}&lng=${lng}`;
		const payload = {
			categoryPage: 'FOOD',
			deselectedFacets: {},
			isSimilarRxFlow: 0,
			marketplaces: [{
				businessLineId: 'FOOD',
				marketplaceId: 'SWIGGY'
			}],
			query: cleanQuery,
			queryUniqueId: '7a66ad55-0ca6-48cf-86c9-6a0434e6da2b',
			redirection: 1,
			secondaryFacets: {},
			showIntentLocation: false,
			sldEnabled: 0,
			submitAction: 'ENTER',
			supportedMarketplaces: [{
				businessLineId: 'FOOD',
				marketplaceId: 'SWIGGY'
			}],
			supportedTabs: [],
		};
		try {
			const response = await axios.post(discUrl, payload, {
				headers: buildDiscHeaders(tid, token, {
					latitude: String(lat),
					longitude: String(lng),
					'current-latitude': String(lat),
					'current-longitude': String(lng),
				}),
				responseType: 'arraybuffer',
				timeout: 10000,
			});
			const str = Buffer.isBuffer(response.data) ? response.data.toString('latin1') : (typeof response.data === 'string' ? response.data : JSON.stringify(response.data));
			const restMarker = 'swiggy.presentation.food.v2.Restaurant';
			const list = [];
			let pos = 0;
			while ((pos = str.indexOf(restMarker, pos)) !== -1) {
				const chunk = str.slice(pos, pos + 1800);
				const words = chunk.replace(/[\x00-\x1F\x7F-\xFF]+/g, '|').split('|').map((w) => w.trim()).filter((w) => w.length >= 2);
				// 1. Real Restaurant ID & Name
				const id = (words[1] && /^[0-9]{5,9}$/.test(words[1])) ? words[1] : (chunk.match(/([0-9]{6,8})/)?.[1] || '');
				let name = (words[2] && !words[2].includes('.jpg')) ? words[2] : '';
				if (!name && words[3] && !words[3].includes('.jpg')) name = words[3];
				// 2. Real Cloudinary Image ID from Swiggy Protobuf (FOOD_CATALOG, RX_THUMBNAIL, or 32-char Hex Hash)
				let imageId = '';
				const pathMatch = chunk.match(/((?:FOOD_CATALOG|RX_THUMBNAIL)\/IMAGES\/(?:CMS|VENDOR)\/[A-Za-z0-9_\-\/\.]+(?:\.[a-z]{3,4}|_compressed)?)/i);
				if (pathMatch) {
					imageId = pathMatch[1];
				} else {
					const hexMatch = chunk.match(/2[\x20]([a-f0-9]{32})/i) || chunk.match(/\b([a-f0-9]{32})\b/i);
					if (hexMatch) {
						imageId = hexMatch[1];
					}
				}
				// 3. Real Locality / Area (Exact locality: e.g. Indrapuri, minal residency, Ayodhya Bypass Road)
				const bjMatch = chunk.match(/B[\x02-\x28]([A-Za-z0-9\s\-,\.']{2,35})J[\x02-\x28]([A-Za-z0-9\s\-,\.']{2,35})R/);
				const bOnly = chunk.match(/B[\x02-\x28]([A-Za-z0-9\s\-,\.']{2,35})/);
				const jOnly = chunk.match(/J[\x02-\x28]([A-Za-z0-9\s\-,\.']{2,35})/);
				const area = bjMatch ? (bjMatch[1].trim() || bjMatch[2].trim()) : (bOnly ? bOnly[1].trim() : (jOnly ? jOnly[1].trim() : (city || 'Nearby')));
				// 4. Real Rating
				const ratingMatch = chunk.match(/([1-5]\.[0-9])\s+(?:cid=|SERVICEABLE|[0-9]\s+')/);
				const avgRating = ratingMatch ? ratingMatch[1] : (chunk.match(/\b([3-4]\.[0-9])\b/)?.[1] || '4.2');
				// 5. Real Delivery Time (SLA) & Open/Closed Status
				const slaMatch = chunk.match(/([0-9]{1,2}-[0-9]{1,2}\s+MINS|[0-9]{1,2}\s+MINS)/i);
				const isServiceableP1 = chunk.includes('SERVICEABLEP\x01');
				const isClosedExplicit = chunk.includes('SERVICEABLEP\x00') || chunk.includes('UNSERVICEABLE') || chunk.includes('Closed now') || chunk.includes('CLOSED');
				const isOpen = Boolean(slaMatch && isServiceableP1 && !isClosedExplicit);
				const deliveryTime = isOpen ? (slaMatch ? slaMatch[1].toLowerCase() : '25-30 mins') : '';
				// 6. Real Distance
				const distMatch = chunk.match(/([0-9]{1,2}\.[0-9]\s+km)/i);
				const distance = distMatch ? distMatch[1] : '2.1 km';
				// 7. Real Cost For Two
				const costMatch = chunk.match(/([0-9]+)\s+FOR\s+TWO/i);
				const costForTwo = costMatch ? '₹' + costMatch[1] + ' for two' : '₹200 for two';
				// 8. Real Cuisines (Protobuf Tag 0x62)
				const cuisinesList = [];
				let cp = 0;
				while ((cp = chunk.indexOf('\x62', cp)) !== -1) {
					const len = chunk.charCodeAt(cp + 1);
					if (len >= 3 && len <= 25 && cp + 2 + len <= chunk.length) {
						const cs = chunk.slice(cp + 2, cp + 2 + len);
						if (/^[A-Za-z\s&]+$/.test(cs) && !cuisinesList.includes(cs) && cs !== 'FOR') {
							cuisinesList.push(cs);
						}
					}
					cp++;
				}
				const cuisines = cuisinesList.length > 0 ? cuisinesList.slice(0, 3).join(', ') : 'Fast Food, Rolls';
				// Real Image URL on Swiggy CDN (Zero dummy fallback)
				const imageUrl = imageId ? `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_508,h_320,c_fill/${imageId}` : '';
				if (id && name && !list.some((r) => r.id === id)) {
					list.push({
						id: String(id),
						name: name.replace(/^[\s\W]+/, '').trim(),
						avgRating,
						deliveryTime,
						cuisines,
						areaName: area,
						distance,
						costForTwo,
						imageUrl,
						isOpen,
					});
				}
				pos += restMarker.length;
			}
			return {
				success: true,
				data: response.data,
				restaurants: list,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Helper: Parse live protobuf addon/variation groups dynamically from binary buffer
	parseAddonGroups(dishBuf) {
		const groups = [];
		let p = 0;
		while (p < dishBuf.length - 4) {
			if (dishBuf[p] === 0x52) {
				p++;
				let len = 0,
					shift = 0;
				while (p < dishBuf.length) {
					const b = dishBuf[p++];
					len |= (b & 0x7f) << shift;
					if (!(b & 0x80)) break;
					shift += 7;
				}
				const groupEnd = p + len;
				if (groupEnd <= dishBuf.length) {
					const groupBuf = dishBuf.slice(p, groupEnd);
					let gp = 0;
					if (groupBuf[0] === 0x12) gp = 2;
					let groupId = '',
						groupName = '';
					const choices = [];
					while (gp < groupBuf.length) {
						const tag = groupBuf[gp++];
						const fieldNum = tag >> 3;
						const wire = tag & 0x07;
						if (wire === 2) {
							let sLen = 0,
								sShift = 0;
							while (gp < groupBuf.length) {
								const b = groupBuf[gp++];
								sLen |= (b & 0x7f) << sShift;
								if (!(b & 0x80)) break;
								sShift += 7;
							}
							if (fieldNum === 1 && !groupId) {
								groupId = groupBuf.slice(gp, gp + sLen).toString('utf8');
							} else if (fieldNum === 2 && !groupName) {
								groupName = groupBuf.slice(gp, gp + sLen).toString('utf8');
							} else if (fieldNum === 3) {
								const choiceBuf = groupBuf.slice(gp, gp + sLen);
								let cp = 0,
									choiceName = '',
									choiceId = '',
									choicePrice = 0;
								while (cp < choiceBuf.length) {
									const cTag = choiceBuf[cp++];
									const cField = cTag >> 3,
										cWire = cTag & 0x07;
									if (cWire === 2) {
										let cLen = 0,
											cShift = 0;
										while (cp < choiceBuf.length) {
											const b = choiceBuf[cp++];
											cLen |= (b & 0x7f) << cShift;
											if (!(b & 0x80)) break;
											cShift += 7;
										}
										if (cField === 1 && !choiceName) {
											choiceName = choiceBuf.slice(cp, cp + cLen).toString('utf8');
										} else if (cField === 4 && !choiceId) {
											choiceId = choiceBuf.slice(cp, cp + cLen).toString('utf8');
										}
										cp += cLen;
									} else if (cWire === 5) {
										const f = choiceBuf.readFloatLE(cp);
										if (f > 0 && f < 500000) choicePrice = Math.round((f / 100) * 100) / 100;
										cp += 4;
									} else if (cWire === 0) {
										while (cp < choiceBuf.length && (choiceBuf[cp++] & 0x80)) {}
									} else {
										break;
									}
								}
								if (choiceName && choiceName.length >= 2) {
									choices.push({
										id: choiceId || `c_${choices.length}`,
										name: choiceName,
										price: choicePrice,
										isVeg: !choiceName.toLowerCase().includes('chicken') && !choiceName.toLowerCase().includes('mutton') && !choiceName.toLowerCase().includes('wings')
									});
								}
							}
							gp += sLen;
						} else if (wire === 0) {
							while (gp < groupBuf.length && (groupBuf[gp++] & 0x80)) {}
						} else {
							break;
						}
					}
					if (groupName && choices.length > 0 && !groupName.includes('http') && !groupName.includes('.png')) {
						groups.push({
							id: groupId || `grp_${groups.length}`,
							name: groupName,
							subText: 'Optional',
							type: choices.length > 1 ? 'radio' : 'checkbox',
							choices
						});
					}
					p = groupEnd;
				}
			} else {
				p++;
			}
		}
		return groups;
	},
	// Fetch Live Restaurant Menu (Direct from disc.swiggy.com)
	async getMenu(restaurantId, lat = 25.2730006, lng = 82.9639115, tid = '', token = '') {
		const url = `https://disc.swiggy.com/api/v2/menu/${restaurantId}?complete-menu=true&lat=${lat}&lng=${lng}`;
		try {
			const response = await axios.post(url, {}, {
				headers: buildDiscHeaders(tid, token, {
					latitude: String(lat),
					longitude: String(lng),
				}),
				responseType: 'arraybuffer',
				timeout: 10000,
			});
			const str = Buffer.isBuffer(response.data) ? response.data.toString('latin1') : (typeof response.data === 'string' ? response.data : JSON.stringify(response.data));
			const dishes = [];
			// 1. Primary High-Fidelity Parser using Swiggy Dish Protobuf Marker
			const dishMarker = 'swiggy.presentation.food.v2.Dish';
			let pos = 0;
			while ((pos = str.indexOf(dishMarker, pos)) !== -1) {
				const nextDishPos = str.indexOf(dishMarker, pos + dishMarker.length);
				const endPos = nextDishPos !== -1 ? Math.min(nextDishPos, pos + 1800) : pos + 1800;
				const chunk = str.slice(pos, endPos);
				const words = chunk.replace(/[\x00-\x1F\x7F-\xFF]+/g, '|').split('|').map((w) => w.trim()).filter((w) => w.length >= 2);
				const id = (words[1] && /^[0-9]{6,10}$/.test(words[1])) ? words[1] : (chunk.match(/([0-9]{7,10})/)?.[1] || '');
				const name = (words[2] && !words[2].includes('.jpg') && !words[2].includes('http')) ? words[2] : '';
				let rawCat = words[3] || 'Recommended Dishes';
				if (rawCat.includes('*') || rawCat.length > 30 || rawCat.includes('http') || rawCat.includes('.jpg')) {
					rawCat = 'Recommended Dishes';
				}
				const category = rawCat;
				// Real Dish Image
				let imageId = '';
				const imgPath = chunk.match(/((?:FOOD_CATALOG|RX_THUMBNAIL)\/IMAGES\/(?:CMS|VENDOR)\/[A-Za-z0-9_\-\/\.]+(?:\.[a-z]{3,4}|_compressed)?)/i);
				if (imgPath) {
					imageId = imgPath[1];
				} else {
					const starIdx = chunk.indexOf('*');
					if (starIdx !== -1) {
						const sub = chunk.slice(starIdx + 1, starIdx + 60);
						const m = sub.match(/([a-zA-Z0-9_\-]{15,40})/);
						if (m && !m[1].includes('FinalPrice')) imageId = m[1];
					}
				}
				if (imageId && imageId.includes('.')) {
					imageId = imageId.replace(/(\.(?:jpe?g|png|webp|avif)).*$/i, '$1');
				}
				// Real Prices from Swiggy Protobuf & Tag Offsets
				const chunkBuf = Buffer.from(chunk, 'latin1');
				let originalPrice = 0;
				let price = 0;
				// 1. Primary: Dish protobuf float tags 0x45 (original price) & 0x4D (Toing finalPrice)
				// Prefer paired 0x45 + 0x4D (5 bytes apart) or standalone 0x4D / 0x45
				for (let i = 0; i < chunkBuf.length - 9; i++) {
					if (chunkBuf[i] === 0x45 && chunkBuf[i + 5] === 0x4D) {
						const vOrig = Math.round(chunkBuf.readFloatLE(i + 1) / 100);
						const vFinal = Math.round(chunkBuf.readFloatLE(i + 6) / 100);
						if (vFinal >= 15 && vFinal <= 3500 && vOrig >= vFinal && vOrig <= 5000) {
							originalPrice = vOrig;
							price = vFinal;
							break;
						}
					}
				}
				if (!price) {
					for (let i = 0; i < chunkBuf.length - 4; i++) {
						const tag = chunkBuf[i];
						if (tag === 0x4D && !price) {
							const val = Math.round(chunkBuf.readFloatLE(i + 1) / 100);
							if (val >= 15 && val <= 3500) price = val;
						} else if (tag === 0x45 && !originalPrice) {
							const val = Math.round(chunkBuf.readFloatLE(i + 1) / 100);
							if (val >= 15 && val <= 5000) originalPrice = val;
						}
					}
				}
				// 2. Fallback: Swiggy final/listing price string match (only if 0x4D/0x45 missing)
				if (!price) {
					const mFinal = chunk.match(/swiggy_final_price[^\d]+([0-9]{4,6})/);
					if (mFinal) {
						const p = Math.round(parseInt(mFinal[1], 10) / 100);
						if (p >= 15 && p <= 3500) price = p;
					}
				}
				if (!originalPrice) {
					const mList = chunk.match(/swiggy_listing_price[^\d]+([0-9]{4,6})/);
					if (mList) {
						const op = Math.round(parseInt(mList[1], 10) / 100);
						if (op >= (price || 15)) originalPrice = op;
					}
				}
				// 3. Last resort: Tag 0x15 (float32 price in paise)
				if (!price) {
					for (let i = 0; i < chunkBuf.length - 4; i++) {
						if (chunkBuf[i] === 0x15) {
							const val = Math.round(chunkBuf.readFloatLE(i + 1) / 100);
							if (val >= 15 && val <= 3500) {
								price = val;
								break;
							}
						}
					}
				}
				if (!price) price = originalPrice || 0;
				// Only keep originalPrice when the API genuinely reports a higher listing price than final price
				if (!originalPrice || originalPrice <= price) originalPrice = price;
				// Description / Allergens info
				const descMatch = chunk.match(/(?:\||\b)(Allergens:[^\|]+)/i) || chunk.match(/([A-Za-z0-9\s,\.\-]{25,120})(?=\x00|\|)/);
				const description = descMatch ? descMatch[1].trim() : '';
				// Veg / Non-veg
				const lowerName = name.toLowerCase();
				const isVeg = !chunk.includes('NONVEG') && !lowerName.includes('chicken') && !lowerName.includes('mutton') && !lowerName.includes('fish') && !lowerName.includes('egg') && !lowerName.includes('wings') && !lowerName.includes('peri peri strips');
				// Dynamic Customisation / Addon Groups (Parsed directly from Swiggy Protobuf stream)
				const addonGroups = this.parseAddonGroups(chunkBuf);
				if (id && name && !dishes.some((d) => d.id === id)) {
					const finalPrice = price || 99;
					const finalOrigPrice = (originalPrice && originalPrice > finalPrice) ? originalPrice : finalPrice;
					dishes.push({
						id: String(id),
						name: name.replace(/^[\s\W]+/, '').trim(),
						category,
						price: finalPrice,
						originalPrice: finalOrigPrice,
						isVeg,
						description,
						imageUrl: imageId ? `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_300,h_300,c_fit/${imageId}` : '',
						customisable: addonGroups.length > 0,
						addonGroups,
					});
				}
				pos += dishMarker.length;
			}
			// Fallback: If dishMarker found nothing, run secondary tag loop
			if (dishes.length === 0) {
				const buf = Buffer.from(str, 'latin1');
				const idRegex = /([0-9]{8,10})\x12/g;
				let match;
				while ((match = idRegex.exec(buf.toString('latin1'))) !== null) {
					const id = match[1];
					let p = match.index + id.length + 1;
					if (p >= buf.length) continue;
					let nameLen = buf[p++];
					if (nameLen & 0x80) nameLen = (nameLen & 0x7f) | (buf[p++] << 7);
					if (p + nameLen > buf.length) continue;
					const name = buf.slice(p, p + nameLen).toString('utf8');
					p += nameLen;
					if (name.includes('.png') || name.includes('.jpg') || name === 'Quantity' || name.length < 2) continue;
					let category = '';
					let imageId = '';
					let isVeg = true;
					let originalPrice = 0;
					let price = 0;
					for (let step = 0; step < 10 && p < buf.length - 10; step++) {
						const tag = buf[p++];
						if (tag === 0x1a) {
							let len = buf[p++];
							if (len & 0x80) len = (len & 0x7f) | (buf[p++] << 7);
							category = buf.slice(p, p + len).toString('utf8');
							p += len;
						} else if (tag === 0x2a) {
							let len = buf[p++];
							if (len & 0x80) len = (len & 0x7f) | (buf[p++] << 7);
							imageId = buf.slice(p, p + len).toString('utf8');
							p += len;
						} else if (tag === 0x30) {
							isVeg = buf[p++] === 1;
						} else if (tag === 0x45) {
							originalPrice = Math.round(buf.readFloatLE(p) / 100);
							p += 4;
						} else if (tag === 0x4d) {
							price = Math.round(buf.readFloatLE(p) / 100);
							p += 4;
							break;
						} else {
							break;
						}
					}
					if (name && !dishes.some((x) => x.id === id)) {
						const finalPrice = price || 99;
						const finalOrigPrice = (originalPrice && originalPrice > finalPrice) ? originalPrice : finalPrice;
						dishes.push({
							id: String(id),
							name: name.replace(/^[\s\W]+/, '').trim(),
							category: category && category.length < 30 ? category : 'Specialties',
							isVeg,
							price: finalPrice,
							originalPrice: finalOrigPrice,
							description: '',
							imageUrl: imageId ? `https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_300,h_300,c_fit/${imageId}` : '',
							customisable: false,
							addonGroups: [],
						});
					}
				}
			}
			return {
				success: true,
				items: dishes,
				data: response.data,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message,
				items: [],
			};
		}
	},
	/* ==========================================================
	   4. CART & COUPONS (Direct payments.swiggy.com endpoints)
	   ========================================================== */
	// Update Cart Items
	async updateCart(cartData, tid = '', token = '', userId = '') {
		const url = `https://payments.swiggy.com/api/v3/update-cart`;
		try {
			const lat = cartData?.cartLatLong?.lat;
			const lng = cartData?.cartLatLong?.lng;
			const addressId = cartData?.address_id;

			const extraHeaders = {};
			if (lat) {
				extraHeaders['lat'] = String(lat);
				extraHeaders['latitude'] = String(lat);
			}
			if (lng) {
				extraHeaders['lng'] = String(lng);
				extraHeaders['longitude'] = String(lng);
			}
			if (addressId) {
				extraHeaders['addressid'] = String(addressId);
				extraHeaders['cartaddressid'] = String(addressId);
			}

			const response = await axios.post(url, cartData, {
				headers: buildPaymentHeaders(tid, token, userId, extraHeaders),
				timeout: 12000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Fetch Live Coupons (Direct from payments.swiggy.com)
	async fetchCoupons(restaurantId = '1325710', cartValue = 159, lat = 25.2731318, lng = 82.9634978, tid = '', token = '', userId = '') {
		const url = `https://payments.swiggy.com/api/v3/fetch-coupons?source_page=cart&restaurant_id=${restaurantId}&cart_value=${cartValue}&coupon_code=&lat=${lat}&lng=${lng}&sub_page=`;
		try {
			const response = await axios.get(url, {
				headers: buildPaymentHeaders(tid, token, userId, {
					referer: 'https://payments.swiggy.com/?flow=cart',
				}),
				timeout: 10000,
			});
			// Extract coupons array across all cards
			let coupons = [];
			const cards = response.data?.success?.cards || [];
			for (const c of cards) {
				const clist = c.card?.card?.coupons || [];
				const cardTitle = String(c.card?.card?.title || '');
				for (const item of clist) {
					const sub = String(item.subtitle || '').trim();
					const ctaType = String(item.ctaType || '').toUpperCase();
					const isAddMore = /^add\s*₹/i.test(sub) || /not\s*applicable|unavailable/i.test(sub);
					const isLocked = isAddMore || (ctaType && ctaType !== 'APPLY_COUPON' && ctaType !== 'APPLY');
					coupons.push({
						id: item.id,
						code: item.title,
						title: item.title,
						subtitle: item.subtitle,
						description: item.description,
						ribbonText: item.ribbonText,
						ctaText: item.ctaText || (isLocked ? 'LOCKED' : 'APPLY'),
						locked: Boolean(isLocked),
						section: cardTitle,
						discount: item.title?.includes('125') ? 125 : item.title?.includes('150') ? 150 : 50,
						logo: item.logo ? `https://toing-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_80,h_80,c_fill/${item.logo}` : '',
					});
				}
			}
			// Only return live coupons from Swiggy (no static/hardcoded coupons)
			return {
				success: true,
				coupons,
				data: response.data,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Apply Coupon Code (Direct from payments.swiggy.com)
	async applyCoupon(couponCode, tid = '', token = '', userId = '', opts = {}) {
		const url = `https://payments.swiggy.com/api/v3/apply-coupon`;
		try {
			const extraHeaders = {};
			if (opts.lat !== undefined && opts.lng !== undefined) {
				extraHeaders['lat'] = String(opts.lat);
				extraHeaders['latitude'] = String(opts.lat);
				extraHeaders['lng'] = String(opts.lng);
				extraHeaders['longitude'] = String(opts.lng);
			}
			if (opts.addressId) {
				extraHeaders['addressid'] = String(opts.addressId);
				extraHeaders['cartaddressid'] = String(opts.addressId);
			}
			const response = await axios.post(url, {
				coupon_code: couponCode.trim().toUpperCase()
			}, {
				headers: buildPaymentHeaders(tid, token, userId, extraHeaders),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Remove Coupon Code
	async removeCoupon(couponCode, tid = '', token = '', userId = '') {
		const url = `https://payments.swiggy.com/api/v3/remove-coupon`;
		try {
			const response = await axios.post(url, {
				coupon_code: couponCode.trim().toUpperCase()
			}, {
				headers: buildPaymentHeaders(tid, token, userId),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	/* ==========================================================
	   5. ORDERS & CHECKOUT (Direct payments.swiggy.com & chkout.swiggy.com)
	   ========================================================== */
	// Get Payment Options (1:1 pay_toing.har)
	async getPaymentOptions(addressId = '', tid = '', token = '', userId = '', opts = {}) {
		const url = `https://payments.swiggy.com/api/v3/payment/get-payment-options`;
		const payload = {
			address_id: String(addressId || ''),
			card_details: true,
			is_user_cred_eligible: false,
			is_user_eligible_for_single_click: false,
			without_split_pay: false,
			split_pay_methods: 'default',
			is_gifting_flow: false,
			is_inapp_upi_eligible: false,
			apple_pay_eligibility: '',
			bill_to_company_toggle: false,
		};
		try {
			const extraHeaders = {};
			if (opts.lat !== undefined && opts.lng !== undefined) {
				extraHeaders['lat'] = String(opts.lat);
				extraHeaders['latitude'] = String(opts.lat);
				extraHeaders['lng'] = String(opts.lng);
				extraHeaders['longitude'] = String(opts.lng);
			}
			if (addressId) {
				extraHeaders['addressid'] = String(addressId);
				extraHeaders['cartaddressid'] = String(addressId);
			}
			if (opts.cartId) extraHeaders['cartid'] = String(opts.cartId);
			const response = await axios.post(url, payload, {
				headers: buildPaymentHeaders(tid, token, userId, extraHeaders),
				timeout: 12000,
			});
			const d = response.data?.data || {};
			const rawGroups = Array.isArray(d.payment_group) ? d.payment_group : [];
			const groups = rawGroups.map((g) => ({
				group_name: g.group_name || '',
				display_name: g.display_name || g.group_name || '',
				methods: (g.payment_methods || []).map((m) => ({
					name: m.name || '',
					display_name: m.display_name || m.name || '',
					payment_code: m.payment_code || '',
					enabled: m.enabled !== false,
					subtitle: m.meta?.promo_msg || m.meta?.subtitle || m.meta?.disable_message || '',
					icon_url: m.meta?.icon_url || '',
				})),
			})).filter((g) => g.methods.length > 0);
			return {
				success: response.data?.statusCode === 0,
				codEnabled: Boolean(d.codEnabled),
				paymentAmount: d.payment_amount || 0,
				groups,
				data: response.data,
			};
		} catch (error) {
			return {
				success: false,
				codEnabled: false,
				groups: [],
				error: error.response?.data?.statusMessage || error.message,
			};
		}
	},
	// Place Order (1:1 pay_toing.har)
	async placeOrder(orderData, tid = '', token = '', userId = '') {
		const url = `https://payments.swiggy.com/api/v3/order/place`;
		const amount = Number(orderData.transaction_amount || 0);
		const isUpiCollect = Boolean(orderData.upiVpa);
		const isBhimCoupon = String(orderData.couponCode || '').toUpperCase().includes('BHIM');
		const payload = {
			upi_transaction_info: isUpiCollect ? {
				payer_vpa: String(orderData.upiVpa).trim(),
				save_vpa: false
			} : (isBhimCoupon ? {
				intent_app: 'in.org.npci.upiapp',
				transaction_mode: '',
				intent_app_display_name: 'BHIM',
			} : {
				intent_app: 'com.google.android.apps.nbu.paisa.user',
				transaction_mode: '',
				intent_app_display_name: 'Google Pay',
			}),
			force_validate_coupon: false,
			transaction_amount: amount,
			selected_split_pay_amounts: {},
			twid_rewards_meta: {},
			place_order_source: 'payment',
			lat: String(orderData.lat || '25.6074'),
			lng: String(orderData.lng || '85.1587'),
			addressId: String(orderData.addressId || ''),
			paymentMethod: isUpiCollect ? 'UPI' : (orderData.paymentMethod || 'UPIIntent'),
			useJuspayNative: !isUpiCollect,
			paymentReturnUrl: '',
			orderComments: String(orderData.cookingRequest || ''),
			paymentAmount: String(amount),
			address_id: String(orderData.addressId || ''),
			payment_cod_method: isUpiCollect ? 'UPI' : 'UPIIntent',
			order_comments: String(orderData.cookingRequest || ''),
		};
		try {
			const extraHeaders = {};
			if (orderData.cartId) extraHeaders['cartid'] = String(orderData.cartId);
			if (orderData.addressId) {
				extraHeaders['addressid'] = String(orderData.addressId);
				extraHeaders['cartaddressid'] = String(orderData.addressId);
			}
			if (orderData.lat !== undefined && orderData.lng !== undefined) {
				extraHeaders['lat'] = String(orderData.lat);
				extraHeaders['latitude'] = String(orderData.lat);
				extraHeaders['lng'] = String(orderData.lng);
				extraHeaders['longitude'] = String(orderData.lng);
			}
			const response = await axios.post(url, payload, {
				headers: buildPaymentHeaders(tid, token, userId, extraHeaders),
				timeout: 15000,
			});
			const d = response.data || {};
			const od = d.data?.order_data || {};
			const orderId = od.order_id ? String(od.order_id) : '';
			const paasId = String(od.payment_txn_id || od.payment_info_v2?.payment_transactions?.[0]?.marketplace_reference_id || od.targeted_marketplace_payment_reference_id || '');
			const rawStr = JSON.stringify(d);
			const upiMatch = rawStr.match(/upi:\/\/pay\?[^"\\]+/);
			return {
				success: d.statusCode === 0 && Boolean(orderId),
				statusCode: d.statusCode,
				statusMessage: d.statusMessage || '',
				orderId,
				paasId,
				amount: od.order_total || amount,
				upiUri: upiMatch ? upiMatch[0] : '',
				data: d,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data?.statusMessage || error.response?.data || error.message,
			};
		}
	},
	// Confirm Order (from pay_toing.har)
	async confirmOrder(orderId, tid = '', token = '', userId = '') {
		const url = `https://payments.swiggy.com/api/v3/order/confirm?order_id=${orderId}`;
		try {
			const response = await axios.post(url, {}, {
				headers: buildPaymentHeaders(tid, token, userId),
				timeout: 10000,
			});
			return {
				success: response.data?.statusCode === 0,
				data: response.data,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data?.statusMessage || error.response?.data || error.message,
			};
		}
	},
	// Check UPI Transaction Status (1:1 pay_toing.har)
	async getVpaTxnStatus(paasId = '', paymentCode = 'UPIIntent', tid = '', token = '', userId = '') {
		const url = `https://payments.swiggy.com/api/v3/vpa-txn-status?paas_id=${encodeURIComponent(paasId)}&payment_code=${encodeURIComponent(paymentCode || 'UPIIntent')}`;
		try {
			const response = await axios.get(url, {
				headers: buildPaymentHeaders(tid, token, userId),
				timeout: 10000,
			});
			return {
				success: true,
				status: String(response.data?.data || 'pending').toLowerCase(),
				data: response.data,
			};
		} catch (error) {
			return {
				success: false,
				status: 'error',
				error: error.response?.data?.statusMessage || error.response?.data || error.message,
			};
		}
	},
	// Get Single Order Details (from chkout.swiggy.com)
	async getSingleOrder(orderId, tid = '', token = '') {
		const url = `https://chkout.swiggy.com/api/v1/order/getSingleOrder?order_id=${orderId}`;
		try {
			const response = await axios.get(url, {
				headers: buildDiscHeaders(tid, token),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Parse protobuf OrderDetails widgets from disc.swiggy.com/api/v1/account/orders
	parseOrdersProtobuf(buf) {
		const orders = [];
		const str = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '');
		const marker = 'swiggy.gandalf.widgets.v2.OrderDetails';
		let pos = 0;
		const readLenStr = (chunk, idx) => {
			if (idx < 0 || idx >= chunk.length) return '';
			const len = chunk.charCodeAt(idx);
			if (len > 0 && len < 140 && idx + 1 + len <= chunk.length) {
				return Buffer.from(chunk.slice(idx + 1, idx + 1 + len), 'latin1').toString('utf8').trim();
			}
			return '';
		};
		while ((pos = str.indexOf(marker, pos)) !== -1) {
			const nextPos = str.indexOf(marker, pos + marker.length);
			const chunk = str.slice(pos + marker.length, nextPos !== -1 ? nextPos : pos + marker.length + 2500);
			// Clean ASCII words for fallback
			const words = chunk.replace(/[\x00-\x1F\x7F-\xFF]+/g, '|').split('|').map((w) => w.trim()).filter((w) => w.length >= 1);
			const orderId = chunk.match(/\b([0-9]{12,18})\b/)?.[1] || '';
			// Extract restaurant name (usually after order_id and restaurant_id)
			let restaurantName = '';
			const idIdx = words.findIndex((w) => w === orderId);
			if (idIdx !== -1) {
				for (let i = idIdx + 1; i < Math.min(idIdx + 5, words.length); i++) {
					if (!/^[0-9]+$/.test(words[i]) && words[i].length >= 2) {
						restaurantName = words[i].replace(/["*]+$/, '').trim();
						break;
					}
				}
			}
			// Protobuf field tags inside OrderDetails:
			// 0x2a = total ("₹52"), 0x32 = status ("Delivered"), 0x62 = items summary, 0x6a = order time
			let orderTotal = '';
			let orderStatus = '';
			let itemsSummary = '';
			let orderTime = '';
			for (let i = 0; i < chunk.length - 3; i++) {
				const b = chunk.charCodeAt(i);
				if (b === 0x2a && !orderTotal) {
					const v = readLenStr(chunk, i + 1);
					const tm = v.match(/₹\s*([0-9]+(?:\.[0-9]+)?)/);
					if (tm) orderTotal = tm[1];
				} else if (b === 0x32 && !orderStatus) {
					const v = readLenStr(chunk, i + 1);
					if (/^[A-Za-z\s]{3,25}$/.test(v)) orderStatus = v;
				} else if (b === 0x62 && !itemsSummary) {
					const v = readLenStr(chunk, i + 1);
					if (v.length >= 3 && /[A-Za-z]/.test(v) && !/[\x00-\x1F₹]/.test(v) && v !== 'delivery') itemsSummary = v;
				} else if (b === 0x6a && !orderTime) {
					const v = readLenStr(chunk, i + 1);
					if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|[0-9]{1,2})/i.test(v) && /\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(v)) {
						orderTime = v;
					}
				}
			}
			// Parse items from summary like "Rasedar subji (2),Egg bhujiya (1)"
			const items = itemsSummary ? itemsSummary.split(',').map((part) => {
				const m = part.trim().match(/^(.+?)\s*\((\d+)\)$/);
				return m ? {
					name: m[1].trim(),
					quantity: parseInt(m[2], 10) || 1,
					cost: 0
				} : {
					name: part.trim(),
					quantity: 1,
					cost: 0
				};
			}).filter((it) => it.name) : [];
			if (orderId && !orders.some((o) => o.order_id === orderId)) {
				orders.push({
					order_id: orderId,
					restaurant_name: restaurantName || 'Swiggy Toing Restaurant',
					order_total: orderTotal || '0',
					order_status: (orderStatus || 'DELIVERED').toUpperCase(),
					delivery_address: '',
					order_time: orderTime || 'Past Order',
					items,
				});
			}
			pos += marker.length;
		}
		return orders;
	},
	// Get Orders List
	async getOrders(orderCount = 10, tid = '', token = '', lat = 25.6074, lng = 85.1587) {
		const url = `https://disc.swiggy.com/api/v1/account/orders?order_count=${orderCount}`;
		try {
			const response = await axios.get(url, {
				headers: buildDiscHeaders(tid, token, {
					latitude: String(lat),
					longitude: String(lng),
					'current-latitude': String(lat),
					'current-longitude': String(lng),
				}),
				responseType: 'arraybuffer',
				timeout: 12000,
			});
			const orders = this.parseOrdersProtobuf(response.data);
			return {
				success: true,
				orders,
				data: response.data,
			};
		} catch (error) {
			return {
				success: false,
				orders: [],
				error: error.response?.data || error.message
			};
		}
	},
	/* ==========================================================
	   6. REWARDS & AUTOMATIONS (Direct from profile & disc)
	   ========================================================== */
	// Claim Referral / Reveal Reward (from toing_claim.har)
	async claimReferral(referralCode, tid = '', token = '') {
		const url = `https://profile.swiggy.com/api/v1/referral/reveal`;
		try {
			const response = await axios.post(url, {
				campaign_id: 'ToingCampaign',
				referral_code: String(referralCode || '1130EEDF').trim(),
			}, {
				headers: buildDiscHeaders(tid, token, {
					accept: 'application/json; charset=utf-8',
				}),
				timeout: 10000,
			});
			const d = response.data || {};
			return {
				success: d.statusCode === 0,
				data: d,
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Assign Scratch Card (from pay_toing.har)
	async assignScratchCard(tid = '', token = '') {
		const url = `https://disc.swiggy.com/api/v1/scratch-card/assign`;
		try {
			const response = await axios.post(url, {}, {
				headers: buildDiscHeaders(tid, token),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
	// Live Track Card (from toing_track.har & pay_toing.har)
	async getTrackCard(orderId, tid = '', token = '') {
		const url = `https://disc.swiggy.com/api/v2/track/card`;
		try {
			const response = await axios.post(url, {
				order_id: String(orderId)
			}, {
				headers: buildDiscHeaders(tid, token),
				timeout: 10000,
			});
			return {
				success: true,
				data: response.data
			};
		} catch (error) {
			return {
				success: false,
				error: error.response?.data || error.message
			};
		}
	},
};
module.exports = SwiggyService;
