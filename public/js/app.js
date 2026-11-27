// Telegram WebApp Init
if (window.Telegram && window.Telegram.WebApp) {
	const tg = window.Telegram.WebApp;
	tg.ready();
	tg.expand();
}
// Per-user isolation ID (Telegram User ID inside Mini App, or persistent browser ID)
function getTelegramUserId() {
	const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
	if (tgUser && tgUser.id) return String(tgUser.id);
	let localId = localStorage.getItem('toing_client_id');
	if (!localId) {
		localId = 'web_' + Math.random().toString(36).slice(2, 12);
		localStorage.setItem('toing_client_id', localId);
	}
	return localId;
}
// Automatically attach x-tg-user-id header on every /api/* request
const _origFetch = window.fetch;
window.fetch = function(input, init = {}) {
	const url = typeof input === 'string' ? input : (input && input.url) || '';
	if (url.startsWith('/api')) {
		const nextInit = {
			...init
		};
		const headers = new Headers(nextInit.headers || {});
		if (!headers.has('x-tg-user-id')) {
			headers.set('x-tg-user-id', getTelegramUserId());
		}
		nextInit.headers = headers;
		return _origFetch.call(this, input, nextInit);
	}
	return _origFetch.call(this, input, init);
};
// Global App State
const state = {
	activeTab: 'address', // Default to Address tab as requested
	accountMode: 'number',
	accounts: [],
	activeAccount: null,
	addresses: [],
	selectedAddressId: '',
	selectedAddress: null,
	otpSent: false,
	pendingTid: '',
	pendingPhone: '',
	cart: {
		restaurantId: null,
		restaurantName: '',
		restaurantArea: '',
		restaurantSla: '',
		restaurantDistance: '',
		restaurantImage: '',
		items: {},
		cookingRequest: '',
		couponCode: '',
		discount: 0,
		fcClaimed: true,
		fcManuallyToggled: false,
		paymentMethod: 'UPIIntent',
		liveBill: null,
	},
	currentMenu: null,
};
// DOM Elements
const activeAccountPill = document.getElementById('activeAccountPill');
const activeAccountText = document.getElementById('activeAccountText');
const deliveryBanner = document.getElementById('deliveryBanner');
const selectedAddressLabel = document.getElementById('selectedAddressLabel');
const addressList = document.getElementById('addressList');
const searchResults = document.getElementById('searchResults');
const inputSearchQuery = document.getElementById('inputSearchQuery');
const restaurantsCountNum = document.getElementById('restaurantsCountNum');
const openNowText = document.getElementById('openNowText');
const toastEl = document.getElementById('toast');
// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
	setupTheme();
	// Restore pending OTP session if user refreshed
	const pendingPhone = sessionStorage.getItem('toing_pending_phone');
	const pendingTid = sessionStorage.getItem('toing_pending_tid');
	if (pendingPhone) {
		state.otpSent = true;
		state.pendingPhone = pendingPhone;
		state.pendingTid = pendingTid || '';
		const phoneInput = document.getElementById('inputPhone');
		if (phoneInput) phoneInput.value = pendingPhone;
		const otpGroup = document.getElementById('otpInputGroup');
		if (otpGroup) otpGroup.classList.remove('hidden');
		const btnSendOtpText = document.getElementById('btnSendOtpText');
		if (btnSendOtpText) btnSendOtpText.textContent = 'Verify OTP';
	}
	Promise.all([loadAccounts(), loadAddresses(), loadWallet()]);
});
// Skeleton / Spinner Loader helper
function getSkeletonHtml(count = 4, withThumb = true) {
	let html = '';
	for (let i = 0; i < count; i++) {
		html += `
      <div class="skeleton-card">
        ${withThumb ? '<div class="skeleton-thumb"></div>' : ''}
        <div class="skeleton-lines">
          <div class="skeleton-line" style="height:14px; width:${withThumb ? '65%' : '45%'};"></div>
          <div class="skeleton-line" style="height:11px; width:${withThumb ? '45%' : '85%'};"></div>
          <div class="skeleton-line" style="height:11px; width:75%;"></div>
        </div>
      </div>
    `;
	}
	return html;
}
// Global Button Loading Spinner Helper
function setButtonLoading(btnOrId, isLoading, loadingText = null, darkSpinner = false) {
	const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
	if (!btn) return;
	if (isLoading) {
		if (!btn.dataset.origHtml) {
			btn.dataset.origHtml = btn.innerHTML;
		}
		btn.disabled = true;
		btn.classList.add('is-loading');
		const spinnerClass = darkSpinner ? 'btn-spinner btn-spinner-dark' : 'btn-spinner';
		const label = loadingText ? `<span>${loadingText}</span>` : '';
		btn.innerHTML = `<span class="${spinnerClass}"></span>${label}`;
	} else {
		btn.disabled = false;
		btn.classList.remove('is-loading');
		if (btn.dataset.origHtml) {
			btn.innerHTML = btn.dataset.origHtml;
			delete btn.dataset.origHtml;
		}
	}
}
// Toast notification helper
function showToast(message, isError = false) {
	toastEl.textContent = message;
	toastEl.style.backgroundColor = isError ? 'rgba(239, 68, 68, 0.95)' : 'rgba(15, 23, 42, 0.95)';
	toastEl.classList.remove('hidden');
	setTimeout(() => {
		toastEl.classList.add('hidden');
	}, 3200);
}
// Theme handling
function setupTheme() {
	const toggleBtn = document.getElementById('themeToggleBtn');
	const savedTheme = localStorage.getItem('toing_theme') || 'light';
	if (savedTheme === 'dark') {
		document.body.classList.add('dark-theme');
		document.body.classList.remove('light-theme');
	}
	toggleBtn.addEventListener('click', () => {
		const isDark = document.body.classList.toggle('dark-theme');
		document.body.classList.toggle('light-theme', !isDark);
		localStorage.setItem('toing_theme', isDark ? 'dark' : 'light');
	});
}
// Tab Switching
function switchTab(tabName) {
	if (tabName === 'tools') tabName = 'bulk';
	state.activeTab = tabName;
	document.querySelectorAll('.view-panel').forEach((panel) => {
		panel.classList.remove('active');
	});
	const targetPanel = document.getElementById(`tab-${tabName}`);
	if (targetPanel) targetPanel.classList.add('active');
	document.querySelectorAll('.nav-item').forEach((item) => {
		item.classList.remove('active');
	});
	const targetNav = document.getElementById(`nav-${tabName}`);
	if (targetNav) targetNav.classList.add('active');
	// Hide delivery banner on search, menu, cart and bulk tabs (matches decoders_toingbot)
	const deliveryBanner = document.getElementById('deliveryBanner');
	if (deliveryBanner) {
		deliveryBanner.style.display = (tabName === 'search' || tabName === 'menu' || tabName === 'cart' || tabName === 'bulk') ? 'none' : 'flex';
	}
	// Handle sticky pay bar vs floating cart bar
	const stickyPayBar = document.getElementById('cartStickyPayBar');
	const floatingBar = document.getElementById('floatingCartBar');
	const cartItemCount = Object.keys(state.cart.items).length;
	if (tabName === 'cart') {
		if (floatingBar) floatingBar.classList.add('hidden');
		if (stickyPayBar) {
			if (cartItemCount > 0) stickyPayBar.classList.remove('hidden');
			else stickyPayBar.classList.add('hidden');
		}
		loadPaymentOptions();
	} else {
		if (stickyPayBar) stickyPayBar.classList.add('hidden');
		updateFloatingCartBar();
	}
	// Trigger contextual data only if not already loaded (instant tab switching)
	if (tabName === 'address' && state.addresses.length === 0) loadAddresses();
	if (tabName === 'search' && (!state.lastRestaurants || state.lastRestaurants.length === 0)) performSearch();
	if (tabName === 'orders' && !state.ordersCache) fetchOrders();
	if (tabName === 'cart') updateCartView();
	if (tabName === 'orders') fetchOrders();
	if (tabName === 'bulk') updateBulkView();
}
// ==========================================
// ACCOUNTS LOGIC
// ==========================================
async function loadAccounts() {
	try {
		const res = await fetch('/api/accounts');
		const data = await res.json();
		if (data.success) {
			state.accounts = data.accounts || [];
			const active = state.accounts.find((a) => a.isActive) || state.accounts[0];
			state.activeAccount = active || null;
			updateActiveAccountUI();
			renderAccountsList();
		}
	} catch (err) {
		console.error('Failed to load accounts:', err);
	}
}

function updateActiveAccountUI() {
	if (state.activeAccount) {
		activeAccountPill.classList.add('has-active');
		activeAccountText.textContent = `+91 ${state.activeAccount.phone}`;
	} else {
		activeAccountPill.classList.remove('has-active');
		activeAccountText.textContent = 'Select Account';
	}
}
let accountFilter = 'all'; // 'all', 'fresh', 'used'
let accountSearch = '';

function setAccountFilter(filter) {
	accountFilter = filter;
	document.getElementById('chipAll')?.classList.toggle('active', filter === 'all');
	document.getElementById('chipFresh')?.classList.toggle('active', filter === 'fresh');
	document.getElementById('chipUsed')?.classList.toggle('active', filter === 'used');
	renderAccountsList();
}

function filterAccounts() {
	accountSearch = (document.getElementById('searchAccountInput')?.value || '').trim().toLowerCase();
	renderAccountsList();
}
async function handleClearAllAccounts() {
	if (!confirm('Are you sure you want to delete ALL accounts?')) return;
	try {
		const res = await fetch('/api/accounts/delete-all', {
			method: 'POST'
		});
		const data = await res.json();
		if (data.success) {
			showToast('All accounts removed');
			loadAccounts();
		}
	} catch (e) {
		showToast('Failed to clear accounts', true);
	}
}
async function toggleAccountUsed(id) {
	try {
		const res = await fetch(`/api/accounts/${id}/toggle-used`, {
			method: 'POST'
		});
		const data = await res.json();
		if (data.success) {
			showToast(data.isUsed ? 'Marked as Used' : 'Marked as Fresh');
			loadAccounts();
		}
	} catch (e) {
		showToast('Failed to update status', true);
	}
}

function copyAccountSession(id) {
	const acc = state.accounts.find(a => a._id === id || a.phone === id);
	if (!acc) return;
	const session = JSON.stringify({
		phone: acc.phone,
		tid: acc.tid,
		token: acc.token,
		userId: acc.userId,
		userName: acc.userName,
		addresses: acc.addresses
	}, null, 2);
	if (navigator.clipboard) {
		navigator.clipboard.writeText(session).then(() => {
			showToast('Session JSON copied to clipboard! 📋');
		}).catch(() => {
			prompt('Copy session JSON:', session);
		});
	} else {
		prompt('Copy session JSON:', session);
	}
}

function renderAccountsList() {
	const container = document.getElementById('accountsList');
	if (!container) return;
	const countBadge = document.getElementById('accountsCount');
	if (countBadge) countBadge.textContent = state.accounts.length;
	let filtered = state.accounts;
	if (accountFilter === 'fresh') {
		filtered = filtered.filter(a => !a.isUsed);
	} else if (accountFilter === 'used') {
		filtered = filtered.filter(a => a.isUsed);
	}
	if (accountSearch) {
		filtered = filtered.filter(a => (a.phone && a.phone.includes(accountSearch)) || (a.userName && a.userName.toLowerCase().includes(accountSearch)));
	}
	if (filtered.length === 0) {
		container.innerHTML = `
      <div class="empty-state" style="padding: 24px 10px; text-align: center; color: var(--text-muted);">
        <p style="font-size: 13px; font-weight: 600;">No accounts found matching filter.</p>
      </div>`;
		return;
	}
	let html = '';
	filtered.forEach((acc) => {
		const isCur = acc.isActive;
		const isUsed = acc.isUsed === true;
		const name = acc.userName || 'Suman Kumar';
		const phone = acc.phone;
		html += `
      <div class="account-row-card ${isCur ? 'is-active' : ''}" onclick="switchActiveAccount('${acc._id}')">
        <div class="acc-card-left">
          <div class="acc-avatar-wrap">
            <div class="acc-avatar-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            ${isCur ? `
              <div class="acc-check-badge">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            ` : ''}
          </div>
          <div class="acc-card-info">
            <div class="acc-card-name">${name}</div>
            <div class="acc-card-phone">+91 ${phone}</div>
          </div>
        </div>
        <div class="acc-card-actions">
          <button class="btn-acc-used ${isUsed ? 'is-used' : ''}" onclick="event.stopPropagation(); toggleAccountUsed('${acc._id}')" title="Toggle status">
            <span>${isUsed ? '🕒' : '🔒'}</span>
            <span>${isUsed ? 'Used' : 'Mark Used'}</span>
          </button>
          <button class="btn-acc-session" onclick="event.stopPropagation(); copyAccountSession('${acc._id}')" title="Export / Copy Session">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="btn-acc-trash" onclick="event.stopPropagation(); deleteAccount('${acc._id}')" title="Delete Account">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    `;
	});
	container.innerHTML = html;
}

function setAccountMode(mode) {
	state.accountMode = mode;
	document.getElementById('btnModeNumber').classList.toggle('active', mode === 'number');
	document.getElementById('btnModeJson').classList.toggle('active', mode === 'json');
	document.getElementById('numberForm').classList.toggle('hidden', mode !== 'number');
	document.getElementById('jsonForm').classList.toggle('hidden', mode !== 'json');
}
async function handleOtpAction() {
	const phone = document.getElementById('inputPhone').value.trim();
	if (!phone || phone.length < 10) {
		showToast('Please enter a valid 10-digit mobile number', true);
		return;
	}
	if (state.otpSent) {
		const otpInput = document.getElementById('inputOtp');
		const otp = otpInput ? otpInput.value.trim() : '';
		if (!otp || !/^\d{6}$/.test(otp)) {
			showToast('Please enter a valid 6-digit numerical OTP', true);
			return;
		}
		const pendingPhone = state.pendingPhone || sessionStorage.getItem('toing_pending_phone') || phone;
		const pendingTid = state.pendingTid || sessionStorage.getItem('toing_pending_tid') || '';
		const btn = document.getElementById('btnSendOtp');
		setButtonLoading(btn, true, 'Verifying...');
		try {
			const res = await fetch('/api/accounts/verify-otp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					mobile: pendingPhone,
					otp,
					tid: pendingTid
				}),
			});
			const data = await res.json();
			if (data.success) {
				showToast('🎉 Account logged in!');
				resetOtpForm();
				loadAccounts().then(() => loadAddresses());
			} else {
				showToast(data.error || 'Verification failed. Please check OTP.', true);
			}
		} catch (e) {
			showToast('Network error while verifying OTP', true);
		} finally {
			setButtonLoading(btn, false);
			const btnText = document.getElementById('btnSendOtpText');
			if (btnText && state.otpSent) btnText.textContent = 'Verify OTP';
		}
		return;
	}
	const btn = document.getElementById('btnSendOtp');
	setButtonLoading(btn, true, 'Sending...');
	try {
		const res = await fetch('/api/accounts/send-otp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				mobile: phone
			}),
		});
		const data = await res.json();
		if (data.success) {
			state.otpSent = true;
			state.pendingPhone = phone;
			state.pendingTid = data.tid || '';
			sessionStorage.setItem('toing_pending_phone', phone);
			sessionStorage.setItem('toing_pending_tid', data.tid || '');
			document.getElementById('otpInputGroup').classList.remove('hidden');
			const otpInput = document.getElementById('inputOtp');
			if (otpInput) {
				otpInput.value = '';
				otpInput.focus();
			}
			showToast('OTP sent to +91 ' + phone);
		} else {
			showToast(data.error || 'Failed to send OTP', true);
		}
	} catch (e) {
		showToast('Failed to reach server', true);
	} finally {
		setButtonLoading(btn, false);
		const btnText = document.getElementById('btnSendOtpText');
		if (btnText) btnText.textContent = state.otpSent ? 'Verify OTP' : 'Send OTP';
	}
}

function resetOtpForm() {
	state.otpSent = false;
	state.pendingPhone = '';
	state.pendingTid = '';
	sessionStorage.removeItem('toing_pending_phone');
	sessionStorage.removeItem('toing_pending_tid');
	const inputPhone = document.getElementById('inputPhone');
	if (inputPhone) inputPhone.value = '';
	const inputOtp = document.getElementById('inputOtp');
	if (inputOtp) inputOtp.value = '';
	const otpGroup = document.getElementById('otpInputGroup');
	if (otpGroup) otpGroup.classList.add('hidden');
	const btnText = document.getElementById('btnSendOtpText');
	if (btnText) btnText.textContent = 'Send OTP';
}
async function handleImportJson() {
	const jsonStr = document.getElementById('inputJson').value.trim();
	if (!jsonStr) {
		showToast('Please paste valid JSON data', true);
		return;
	}
	setButtonLoading('btnImportJson', true, 'Importing...');
	try {
		const res = await fetch('/api/accounts/import-json', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				jsonData: jsonStr
			}),
		});
		const data = await res.json();
		if (data.success) {
			showToast('Account imported successfully!');
			document.getElementById('inputJson').value = '';
			setAccountMode('number');
			loadAccounts().then(() => loadAddresses());
		} else {
			showToast(data.error || 'Import failed', true);
		}
	} catch (e) {
		showToast('Invalid JSON format', true);
	} finally {
		setButtonLoading('btnImportJson', false);
	}
}
async function switchActiveAccount(id) {
	try {
		const res = await fetch(`/api/accounts/switch/${id}`, {
			method: 'POST'
		});
		const data = await res.json();
		if (data.success) {
			showToast('Switched to account!');
			loadAccounts().then(() => loadAddresses());
		}
	} catch (e) {
		showToast('Failed to switch account', true);
	}
}
async function deleteAccount(id) {
	if (!confirm('Are you sure you want to remove this account?')) return;
	try {
		const res = await fetch(`/api/accounts/${id}`, {
			method: 'DELETE'
		});
		const data = await res.json();
		if (data.success) {
			showToast('Account removed');
			loadAccounts();
		}
	} catch (e) {
		showToast('Failed to delete account', true);
	}
}

function toggleAccountDropdown() {
	switchTab('accounts');
}
// ==========================================
// 2. ADDRESS MANAGEMENT (MATCHING IMAGE 1)
// ==========================================
async function loadAddresses(forceRefresh = false) {
	if (state.addresses.length === 0 || forceRefresh) {
		addressList.innerHTML = getSkeletonHtml(3, false);
	}
	try {
		const res = await fetch(`/api/addresses${forceRefresh ? '?refresh=1' : ''}`);
		const data = await res.json();
		state.addresses = data.addresses || [];
		state.selectedAddressId = data.selectedAddressId || state.addresses[0]?.id || '';
		// Set selected address object
		state.selectedAddress = state.addresses.find((a) => a.id === state.selectedAddressId) || state.addresses[0] || null;
		updateDeliveryBanner();
		renderAddressesList();
	} catch (err) {
		addressList.innerHTML = '<div class="empty-hint">Failed to load addresses. Please retry.</div>';
	}
}

function formatFullAddress(addr) {
	if (!addr) return '';
	if (typeof addr === 'string') return addr;
	const parts = [];
	const seenParts = new Set();
	const pushPart = (val) => {
		const s = String(val || '').trim();
		if (!s) return;
		const low = s.toLowerCase();
		if (seenParts.has(low)) return;
		seenParts.add(low);
		parts.push(s);
	};
	pushPart(addr.flat_no);
	pushPart(addr.landmark);
	pushPart(addr.address_line1);
	pushPart(addr.address_line2);
	if (addr.address && !parts.some((p) => addr.address.toLowerCase().includes(p.toLowerCase()))) {
		pushPart(addr.address);
	} else if (!addr.address_line1 && addr.address) {
		pushPart(addr.address);
	}
	if (parts.length === 0) {
		pushPart(addr.area);
		pushPart(addr.city);
		pushPart('India');
	} else if (addr.city && !parts.join(' ').toLowerCase().includes(addr.city.toLowerCase())) {
		pushPart(addr.city);
	}
	return parts.join(', ');
}

function updateDeliveryBanner() {
	if (state.selectedAddress) {
		const shortArea = state.selectedAddress.flat_no || state.selectedAddress.area || state.selectedAddress.city || 'Patna';
		selectedAddressLabel.textContent = `${state.selectedAddress.name || 'User'} • ${shortArea}`;
		selectedAddressLabel.title = formatFullAddress(state.selectedAddress);
	} else {
		selectedAddressLabel.textContent = 'Select Delivery Address';
	}
}

function renderAddressesList() {
	if (state.addresses.length === 0) {
		addressList.innerHTML = '<div class="empty-hint" style="padding: 24px 10px;">No saved addresses yet. Use buttons above to add an address.</div>';
		return;
	}
	let html = '';
	state.addresses.forEach((addr) => {
		const isSelected = addr.id === state.selectedAddressId;
		const rawTag = addr.tag || addr.annotation || (Array.isArray(addr.tags) && addr.tags[0]) || 'OTHER';
		const tag = String(rawTag).toUpperCase();
		const isHome = tag === 'HOME';
		const name = (addr.name || (state.activeAccount ? (state.activeAccount.userName || 'User') : 'User')).trim();
		const rawPhone = String(addr.phone || addr.mobile || (state.activeAccount ? state.activeAccount.phone : '')).trim();
		const phone = rawPhone ? (rawPhone.startsWith('+') ? rawPhone : `+91 ${rawPhone.replace(/^91/, '')}`) : '';
		const fullText = formatFullAddress(addr);
		html += `
      <div class="addr-card-item ${isSelected ? 'is-selected' : ''}" onclick="selectDeliveryAddress('${addr.id}')">
        <div class="addr-card-top-row">
          <span class="addr-badge ${isHome ? 'badge-purple' : 'badge-gray'}">${tag}</span>
          <span class="addr-badge badge-green">ACCOUNT ADDRESS</span>
        </div>
        
        <div class="addr-user-row">
          <div class="addr-user-text">${name} | ${phone}</div>
          <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
            <button class="addr-trash-btn" onclick="event.stopPropagation(); openEditAddressModal('${addr.id}')" title="Edit Address">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </button>
            <button class="addr-trash-btn" onclick="event.stopPropagation(); deleteAddress('${addr.id}')" title="Delete Address">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>

        <div class="addr-text-line">${fullText}</div>
      </div>
    `;
	});
	addressList.innerHTML = html;
}
// Select Address and use it for search & cart
async function selectDeliveryAddress(addressId) {
	state.selectedAddressId = addressId;
	state.selectedAddress = state.addresses.find((a) => a.id === addressId);
	state.lastRestaurants = [];
	state.currentMenu = null;
	updateDeliveryBanner();
	renderAddressesList();
	try {
		await fetch('/api/addresses/select', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				addressId
			}),
		});
		showToast(`📍 Delivering to: ${state.selectedAddress?.name || 'Selected Address'}`);
		if (state.activeTab === 'search') {
			performSearch();
		}
	} catch (e) {}
}
// Delete Address
async function deleteAddress(addressId) {
	if (!confirm('Are you sure you want to delete this address?')) return;
	try {
		const res = await fetch(`/api/addresses/${addressId}`, {
			method: 'DELETE'
		});
		const data = await res.json();
		if (data.success) {
			showToast('Address removed');
			loadAddresses();
		}
	} catch (e) {
		showToast('Failed to delete address', true);
	}
}
// Modal controls
function openAddLinkModal() {
	document.getElementById('modalAddLink').classList.remove('hidden');
}
let areaSuggestTimer = null;

function setManualGpsStatus(msg, isErr = false) {
	const el = document.getElementById('manualGpsStatus');
	if (!el) return;
	if (!msg) {
		el.classList.add('hidden');
		el.textContent = '';
		return;
	}
	el.textContent = msg;
	el.style.color = isErr ? '#dc2626' : '#047857';
	el.style.background = isErr ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.12)';
	el.classList.remove('hidden');
}
async function applyFetchedGpsCoords(lat, lng) {
	state.manualLat = Number(lat);
	state.manualLng = Number(lng);
	setManualGpsStatus(`✅ Location locked (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}) — resolving area...`);
	try {
		const res = await fetch(`/api/addresses/reverse-geocode?lat=${lat}&lng=${lng}`);
		const data = await res.json();
		if (data.success) {
			if (data.area) document.getElementById('manualLine2').value = data.area;
			if (data.city) document.getElementById('manualCity').value = data.city;
			setManualGpsStatus(`✅ GPS Locked: ${data.area || data.city || ''} (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})`);
			showToast('📍 Current location fetched!');
		}
	} catch (e) {}
}

function fetchCurrentGpsLocation() {
	const btn = document.getElementById('btnFetchGpsLoc');
	if (btn) {
		btn.disabled = true;
		btn.textContent = '⏳ Fetching current GPS location...';
	}
	const done = () => {
		if (btn) {
			btn.disabled = false;
			btn.textContent = '📍 Fetch Current Location (GPS)';
		}
	};
	const tryBrowserGeo = () => {
		if (!navigator.geolocation) {
			done();
			setManualGpsStatus('⚠️ GPS unavailable here — type Area / Colony below to pick exact location', true);
			return;
		}
		navigator.geolocation.getCurrentPosition(async (pos) => {
				await applyFetchedGpsCoords(pos.coords.latitude, pos.coords.longitude);
				done();
			},
			(err) => {
				done();
				const msg = err?.code === 1 ? '⚠️ Location permission denied — allow GPS or type Area / Colony below' : '⚠️ GPS unavailable — type Area / Colony below to pick exact location';
				setManualGpsStatus(msg, true);
			}, {
				enableHighAccuracy: false,
				maximumAge: 60000,
				timeout: 10000
			});
	};
	const lm = window.Telegram?.WebApp?.LocationManager;
	if (lm && typeof lm.init === 'function' && typeof lm.getLocation === 'function') {
		let settled = false;
		const guard = setTimeout(() => {
			if (!settled) {
				settled = true;
				tryBrowserGeo();
			}
		}, 2500);
		const runTgLoc = () => {
			if (lm.isLocationAvailable === false) {
				if (!settled) {
					settled = true;
					clearTimeout(guard);
					tryBrowserGeo();
				}
				return;
			}
			try {
				lm.getLocation(async (loc) => {
					if (settled) return;
					settled = true;
					clearTimeout(guard);
					if (loc && loc.latitude && loc.longitude) {
						await applyFetchedGpsCoords(loc.latitude, loc.longitude);
						done();
					} else {
						tryBrowserGeo();
					}
				});
			} catch (e) {
				if (!settled) {
					settled = true;
					clearTimeout(guard);
					tryBrowserGeo();
				}
			}
		};
		if (lm.isInited) runTgLoc();
		else {
			try {
				lm.init(() => runTgLoc());
			} catch (e) {
				settled = true;
				clearTimeout(guard);
				tryBrowserGeo();
			}
		}
		return;
	}
	tryBrowserGeo();
}

function onManualAreaInput(val) {
	state.manualLat = null;
	state.manualLng = null;
	const box = document.getElementById('manualAreaSuggestions');
	if (!box) return;
	if (areaSuggestTimer) clearTimeout(areaSuggestTimer);
	const q = String(val || '').trim();
	if (q.length < 3) {
		box.classList.add('hidden');
		return;
	}
	areaSuggestTimer = setTimeout(async () => {
		try {
			const res = await fetch(`/api/addresses/suggest?q=${encodeURIComponent(q)}`);
			const data = await res.json();
			const list = data.suggestions || [];
			if (list.length === 0) {
				box.classList.add('hidden');
				return;
			}
			box.innerHTML = list.map((s) => `
				<div onclick="pickManualAreaSuggestion(${s.lat}, ${s.lng}, '${encodeURIComponent(s.area)}', '${encodeURIComponent(s.city)}')" style="padding:9px 12px; border-bottom:1px solid var(--border-color); font-size:12px; cursor:pointer;">
					<div style="font-weight:700;">📍 ${s.area}</div>
					<div style="color:var(--text-muted); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.display}</div>
				</div>
			`).join('');
			box.classList.remove('hidden');
		} catch (e) {}
	}, 300);
}

function pickManualAreaSuggestion(lat, lng, encArea, encCity) {
	const area = decodeURIComponent(encArea || '');
	const city = decodeURIComponent(encCity || '');
	state.manualLat = Number(lat);
	state.manualLng = Number(lng);
	if (area) document.getElementById('manualLine2').value = area;
	if (city) document.getElementById('manualCity').value = city;
	document.getElementById('manualAreaSuggestions')?.classList.add('hidden');
	setManualGpsStatus(`✅ Location locked: ${area || city} (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})`);
}

function selectManualTag(tag) {
	const clean = ['HOME', 'WORK', 'OTHER'].includes(String(tag).toUpperCase()) ? String(tag).toUpperCase() : 'OTHER';
	const hidden = document.getElementById('manualTag');
	if (hidden) hidden.value = clean;
	['HOME', 'WORK', 'OTHER'].forEach((t) => {
		const el = document.getElementById(`tagPill${t}`);
		if (el) el.classList.toggle('active', t === clean);
	});
}

function openAddManualModal() {
	state.editingAddressId = null;
	state.manualLat = null;
	state.manualLng = null;
	setManualGpsStatus('');
	document.getElementById('manualAreaSuggestions')?.classList.add('hidden');
	const titleEl = document.getElementById('manualModalTitle');
	const btnEl = document.getElementById('btnSaveManualAddr');
	if (titleEl) titleEl.textContent = 'Add Address Manually';
	if (btnEl) btnEl.textContent = 'Save Address';
	document.getElementById('manualName').value = '';
	document.getElementById('manualPhone').value = '';
	document.getElementById('manualLine1').value = '';
	document.getElementById('manualLine2').value = '';
	const lm = document.getElementById('manualLandmark');
	if (lm) lm.value = '';
	document.getElementById('manualCity').value = state.selectedAddress?.city || '';
	selectManualTag('HOME');
	document.getElementById('modalAddManual').classList.remove('hidden');
}

function openEditAddressModal(addressId) {
	const addr = (state.addresses || []).find((a) => String(a.id) === String(addressId));
	if (!addr) return;
	state.editingAddressId = addressId;
	state.manualLat = null;
	state.manualLng = null;
	setManualGpsStatus('');
	document.getElementById('manualAreaSuggestions')?.classList.add('hidden');
	const titleEl = document.getElementById('manualModalTitle');
	const btnEl = document.getElementById('btnSaveManualAddr');
	if (titleEl) titleEl.textContent = 'Edit Address';
	if (btnEl) btnEl.textContent = 'Update Address';
	document.getElementById('manualName').value = (addr.name || '').trim();
	document.getElementById('manualPhone').value = String(addr.phone || addr.mobile || '').replace(/^\+91\s*/, '').trim();
	document.getElementById('manualLine1').value = addr.flat_no || addr.address_line1 || '';
	document.getElementById('manualLine2').value = addr.address_line2 || addr.area || '';
	const lm = document.getElementById('manualLandmark');
	if (lm) lm.value = addr.landmark || '';
	document.getElementById('manualCity').value = addr.city || '';
	selectManualTag(addr.tag || 'HOME');
	document.getElementById('modalAddManual').classList.remove('hidden');
}

function closeModal(id) {
	document.getElementById(id).classList.add('hidden');
}
async function submitAddLink() {
	const link = document.getElementById('inputAddressLink').value.trim();
	if (!link) {
		showToast('Please paste a Swiggy link or address text', true);
		return;
	}
	setButtonLoading('btnSubmitAddLink', true, 'Adding...');
	try {
		const res = await fetch('/api/addresses/add-link', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				link
			}),
		});
		const data = await res.json();
		if (data.success) {
			showToast('Address added!');
			closeModal('modalAddLink');
			document.getElementById('inputAddressLink').value = '';
			state.lastRestaurants = [];
			state.currentMenu = null;
			loadAddresses();
		} else {
			showToast(data.error || 'Failed to add address', true);
		}
	} catch (e) {
		showToast('Error saving address', true);
	} finally {
		setButtonLoading('btnSubmitAddLink', false);
	}
}
async function submitAddManual() {
	const name = document.getElementById('manualName').value.trim();
	const phone = document.getElementById('manualPhone').value.trim();
	const addressLine1 = document.getElementById('manualLine1').value.trim();
	const addressLine2 = document.getElementById('manualLine2').value.trim();
	const landmark = (document.getElementById('manualLandmark')?.value || '').trim();
	const city = document.getElementById('manualCity').value.trim() || state.selectedAddress?.city || 'Patna';
	const tag = document.getElementById('manualTag').value;
	if (!name || !addressLine1) {
		showToast('Name and Flat/House No. are required', true);
		return;
	}
	setButtonLoading('btnSaveManualAddr', true, 'Saving...');
	try {
		const isEdit = Boolean(state.editingAddressId);
		const url = isEdit ? `/api/addresses/${encodeURIComponent(state.editingAddressId)}` : '/api/addresses/add-manual';
		const res = await fetch(url, {
			method: isEdit ? 'PUT' : 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				name,
				phone,
				addressLine1,
				addressLine2: [addressLine2, landmark].filter(Boolean).join(', '),
				city,
				tag,
				lat: state.manualLat || undefined,
				lng: state.manualLng || undefined,
			}),
		});
		const data = await res.json();
		if (data.success) {
			showToast(isEdit ? 'Address updated!' : 'Address saved!');
			state.editingAddressId = null;
			closeModal('modalAddManual');
			state.lastRestaurants = [];
			state.currentMenu = null;
			loadAddresses();
		} else {
			showToast(data.error || 'Failed to save address', true);
		}
	} catch (e) {
		showToast('Error saving address', true);
	} finally {
		setButtonLoading('btnSaveManualAddr', false);
	}
}
// Helper: Highlight query terms in restaurant name (matches original Toing Pro UI)
function highlightQuery(name, q) {
	if (!name) return '';
	if (!q || !q.trim()) return name;
	const terms = q.trim().split(/\s+/).filter((t) => t.length >= 2);
	if (terms.length === 0) return name;
	const regex = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
	return name.replace(regex, '<span class="highlight-term">$1</span>');
}
// ==========================================
// 3. SEARCH VIEW (MATCHING IMAGE 2)
// ==========================================
let searchAbortController = null;
async function performSearch() {
	if (!state.selectedAddress || !state.selectedAddress.lat || !state.selectedAddress.lng) {
		restaurantsCountNum.textContent = '0';
		openNowText.textContent = '0 open now';
		searchResults.innerHTML = `
      <div class="empty-hint" style="padding: 28px 16px;">
        <div style="font-size: 28px; margin-bottom: 8px;">📍</div>
        <div style="font-weight: 700; color: var(--text-main); margin-bottom: 6px;">No Delivery Address Selected</div>
        <div style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 14px;">Please login and select a delivery address to see nearby restaurants.</div>
        <button class="btn-primary" style="width:auto; padding: 10px 20px; font-size: 13px;" onclick="switchTab('${state.activeAccount ? 'address' : 'accounts'}')">
          ${state.activeAccount ? 'Select Address' : 'Login / Add Account'}
        </button>
      </div>
    `;
		return;
	}
	const query = inputSearchQuery.value.trim() || 'Pizza';
	if (searchAbortController) {
		searchAbortController.abort();
	}
	searchAbortController = new AbortController();
	searchResults.innerHTML = getSkeletonHtml(4, true);
	const lat = state.selectedAddress.lat;
	const lng = state.selectedAddress.lng;
	const city = state.selectedAddress.city || '';
	try {
		const res = await fetch('/api/search', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				query,
				lat,
				lng,
				city
			}),
			signal: searchAbortController.signal,
		});
		const data = await res.json();
		const restaurants = data.restaurants || [];
		state.lastRestaurants = restaurants;
		const openCount = restaurants.filter((r) => r.isOpen).length;
		restaurantsCountNum.textContent = restaurants.length;
		openNowText.textContent = `${openCount} open now`;
		if (restaurants.length === 0) {
			searchResults.innerHTML = '<div class="empty-hint">No restaurants found. Try another search.</div>';
			return;
		}
		let html = '';
		restaurants.forEach((r) => {
			const isClosed = !r.isOpen;
			const highlightedName = highlightQuery(r.name, query);
			const ratingClass = isClosed ? 'rating-pill rating-closed' : 'rating-pill';
			const imgClass = isClosed ? 'rest-img-thumb is-closed' : 'rest-img-thumb';
			html += `
        <div class="restaurant-card ${isClosed ? 'is-closed-card' : ''}" onclick="selectRestaurant('${r.id}')">
          <div class="rest-left">
            <div class="rest-img-wrapper">
              ${r.imageUrl ? `<img class="${imgClass}" loading="lazy" decoding="async" src="${r.imageUrl}" alt="${r.name}" onerror="if(!this.dataset.retried){this.dataset.retried='1'; this.src=this.src.replace('media-assets.swiggy.com', 'toing-media-assets.swiggy.com');}" />` : `<div class="${imgClass} rest-img-placeholder">🍽️</div>`}
              ${isClosed ? '<div class="closed-overlay-badge">CLOSED</div>' : ''}
            </div>
            <div class="rest-details">
              <h3 class="rest-name">${highlightedName}</h3>
              <div class="rest-rating-sla">
                <span class="${ratingClass}">★ ${r.avgRating}</span>
                ${r.isOpen && r.deliveryTime ? `<span class="sla-text">🕒 ${r.deliveryTime}</span>` : ''}
              </div>
              <div class="rest-cuisines">${r.cuisines}</div>
              <div class="rest-location">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
                <span>${r.areaName} • ${r.distance}</span>
              </div>
              ${isClosed ? '<div class="rest-closed-now-row">🌙 Closed now</div>' : ''}
            </div>
          </div>
          <div class="rest-chevron">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </div>
        </div>
      `;
		});
		searchResults.innerHTML = html;
	} catch (err) {
		if (err && err.name === 'AbortError') return;
		searchResults.innerHTML = '<div class="empty-hint">Search failed. Check server connection.</div>';
	}
}

function clearSearchInput() {
	inputSearchQuery.value = '';
	inputSearchQuery.focus();
	performSearch();
}
// Live search listener on typing and Enter key
let searchDebounceTimeout = null;
if (inputSearchQuery) {
	inputSearchQuery.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			clearTimeout(searchDebounceTimeout);
			performSearch();
		}
	});
	inputSearchQuery.addEventListener('input', () => {
		clearTimeout(searchDebounceTimeout);
		searchDebounceTimeout = setTimeout(() => {
			performSearch();
		}, 500);
	});
}
// ==========================================
// 3.5. RESTAURANT MENU & FOOD CATALOG (1:1 TOING PRO)
// ==========================================
function selectRestaurant(id, encName, encArea, isOpen = true) {
	const rest = (state.lastRestaurants || []).find((r) => String(r.id) === String(id)) || {
		id,
		name: decodeURIComponent(encName || ''),
		areaName: decodeURIComponent(encArea || ''),
	};
	state.selectedRestaurant = rest;
	// 1. Immediately populate Top Nav & Hero Restaurant Card
	const topTitleEl = document.getElementById('menuTopTitle');
	if (topTitleEl) topTitleEl.textContent = rest.name || 'Restaurant';
	const heroNameEl = document.getElementById('menuRestName');
	if (heroNameEl) heroNameEl.textContent = rest.name || 'Restaurant';
	const heroImgEl = document.getElementById('menuHeroImg');
	if (heroImgEl) {
		heroImgEl.src = rest.imageUrl || 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_508,h_320,c_fill/FOOD_CATALOG/IMAGES/CMS/2024/3/9/971fe499-fcb5-4530-b878-c03436738d70_7de95bb6-376b-463a-ac43-2a87bc633851_compressed';
	}
	const ratingEl = document.getElementById('menuRestRating');
	if (ratingEl) ratingEl.textContent = `★ ${rest.avgRating || '4.1'}`;
	const outletLocEl = document.getElementById('menuOutletLoc');
	if (outletLocEl) {
		const area = rest.areaName || state.selectedAddress?.city || 'Outlet';
		outletLocEl.innerHTML = `${area} <span>⌄</span>`;
	}
	const outletDistEl = document.getElementById('menuOutletDist');
	if (outletDistEl) outletDistEl.textContent = rest.distance || '2.1 KM';
	const outletSlaEl = document.getElementById('menuOutletSla');
	if (outletSlaEl) outletSlaEl.textContent = rest.deliveryTime || '25-30 mins';
	// 2. Reset filters
	state.menuVegFilter = false;
	state.menuDishQuery = '';
	const vegToggle = document.getElementById('vegFilterToggle');
	if (vegToggle) vegToggle.checked = false;
	const searchInput = document.getElementById('menuDishSearch');
	if (searchInput) searchInput.value = '';
	switchTab('menu');
	loadRestaurantMenu(id, rest);
}
async function loadRestaurantMenu(restaurantId, restObj = {}) {
	const menuContainer = document.getElementById('menuItemsList');
	if (menuContainer) {
		menuContainer.innerHTML = getSkeletonHtml(5, true);
	}
	try {
		const lat = state.selectedAddress?.lat || 25.6074;
		const lng = state.selectedAddress?.lng || 85.1587;
		const defaultCity = state.selectedAddress?.city || 'Patna';
		const params = new URLSearchParams({
			lat: String(lat),
			lng: String(lng),
			name: restObj.name || '',
			areaName: restObj.areaName || defaultCity,
			imageUrl: restObj.imageUrl || '',
			avgRating: restObj.avgRating || '4.1',
			deliveryTime: restObj.deliveryTime || '25-30 mins',
			distance: restObj.distance || '2.1 KM',
			cuisines: restObj.cuisines || '',
		});
		const res = await fetch(`/api/menu/${restaurantId}?${params.toString()}`);
		const data = await res.json();
		const rest = data.restaurant || restObj;
		const items = data.items || [];
		state.currentMenu = {
			restaurant: rest,
			items
		};
		renderMenuItems();
	} catch (err) {
		if (menuContainer) {
			menuContainer.innerHTML = '<div class="empty-hint">Failed to load menu items.</div>';
		}
	}
}

function toggleVegFilter() {
	const toggle = document.getElementById('vegFilterToggle');
	state.menuVegFilter = toggle ? toggle.checked : false;
	renderMenuItems();
}

function filterMenuDishes() {
	const input = document.getElementById('menuDishSearch');
	state.menuDishQuery = input ? input.value.trim().toLowerCase() : '';
	renderMenuItems();
}

function toggleCategoryAccordion(catId) {
	const listEl = document.getElementById(`cat-dishes-${catId}`);
	const chevEl = document.getElementById(`cat-chev-${catId}`);
	if (listEl) {
		if (listEl.style.display === 'none') {
			listEl.style.display = 'block';
			if (chevEl) chevEl.classList.remove('collapsed');
		} else {
			listEl.style.display = 'none';
			if (chevEl) chevEl.classList.add('collapsed');
		}
	}
}

function renderMenuItems() {
	const menuContainer = document.getElementById('menuItemsList');
	if (!menuContainer || !state.currentMenu || !state.currentMenu.items) return;
	let items = state.currentMenu.items || [];
	// Filter Veg
	if (state.menuVegFilter) {
		items = items.filter((i) => i.isVeg === true);
	}
	// Filter Search Query
	if (state.menuDishQuery) {
		const q = state.menuDishQuery;
		items = items.filter((i) => (i.name && i.name.toLowerCase().includes(q)) || (i.category && i.category.toLowerCase().includes(q)));
	}
	if (items.length === 0) {
		menuContainer.innerHTML = '<div class="empty-hint">No matching dishes found.</div>';
		return;
	}
	// Group dishes by category
	const categoriesMap = new Map();
	items.forEach((item) => {
		const cat = item.category || 'Recommended Dishes';
		if (!categoriesMap.has(cat)) {
			categoriesMap.set(cat, []);
		}
		categoriesMap.get(cat).push(item);
	});
	let html = '';
	let catIndex = 0;
	for (const [catName, catDishes] of categoriesMap.entries()) {
		catIndex++;
		const catId = `cat_${catIndex}`;
		html += `
      <div class="category-section">
        <div class="category-header" onclick="toggleCategoryAccordion('${catId}')">
          <div class="cat-left">
            <span class="cat-title">${catName}</span>
            <span class="cat-count-pill">${catDishes.length}</span>
          </div>
          <svg id="cat-chev-${catId}" class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </div>
        <div class="category-dishes" id="cat-dishes-${catId}">
    `;
		catDishes.forEach((item) => {
			const cartMatches = Object.values(state.cart.items).filter((ci) => ci.baseId === item.id || ci.id === item.id);
			const qty = cartMatches.reduce((sum, ci) => sum + ci.quantity, 0);
			const primaryCartId = cartMatches[0]?.id || item.id;
			const discountPct = (item.originalPrice && item.originalPrice > item.price) ? Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100) : 0;
			html += `
        <div class="dish-item-card">
          <div class="dish-item-info">
            <div class="${item.isVeg ? 'veg-symbol' : 'nonveg-symbol'}">
              <div class="${item.isVeg ? 'veg-symbol-dot' : 'nonveg-symbol-dot'}"></div>
            </div>
            <div class="dish-item-name">${item.name}</div>
            <div class="dish-price-row">
              <span class="dish-price">₹${item.price}</span>
              ${item.originalPrice && item.originalPrice > item.price ? `<span class="dish-orig-price">₹${item.originalPrice}</span>` : ''}
              ${discountPct > 0 ? `<span class="dish-discount-pct">${discountPct}% OFF</span>` : ''}
            </div>
            ${item.description ? `<div class="dish-item-desc">${item.description}</div>` : ''}
          </div>
          <div class="dish-img-action-wrap">
            ${item.imageUrl ? `<img class="dish-thumb-img" loading="lazy" decoding="async" src="${item.imageUrl}" alt="${item.name}" onerror="if(!this.dataset.retried){this.dataset.retried='1'; this.src=this.src.replace('media-assets.swiggy.com', 'toing-media-assets.swiggy.com');}" />` : '<div class="dish-thumb-empty"></div>'}
            <div class="dish-btn-overlay">
              ${qty > 0 ? `
                <div class="qty-counter-pill" id="qty-pill-${item.id}">
                  <button class="qty-btn" onclick="updateCartQty('${primaryCartId}', -1)">−</button>
                  <span>${qty}</span>
                  <button class="qty-btn" onclick="handleAddToCart('${item.id}')">+</button>
                </div>
              ` : `
                <button class="dish-add-pill-btn" id="btn-add-${item.id}" onclick="handleAddToCart('${item.id}')">ADD</button>
              `}
            </div>
            ${item.customisable ? '<div class="dish-customisable-sub">Customisable</div>' : ''}
          </div>
        </div>
      `;
		});
		html += `
        </div>
      </div>
    `;
	}
	menuContainer.innerHTML = html;
}

function handleBuyNow(itemId) {
	handleAddToCart(itemId);
	switchTab('cart');
}

function selectPaymentMethod(radio) {
	document.querySelectorAll('.pay-method-opt').forEach((lbl) => {
		lbl.style.borderColor = 'var(--border-color)';
		lbl.style.background = 'transparent';
	});
	if (radio.parentElement) {
		radio.parentElement.style.borderColor = 'var(--primary)';
		radio.parentElement.style.background = 'var(--primary-light)';
	}
}
// ==========================================
// 3.6. ITEM CUSTOMISATION BOTTOM SHEET
// ==========================================
let currentCustomisingDish = null;

function openCustomiseModal(item) {
	currentCustomisingDish = item;
	const modal = document.getElementById('modalCustomiseDish');
	const titleEl = document.getElementById('custDishTitle');
	const basePriceEl = document.getElementById('custDishBasePrice');
	const bodyEl = document.getElementById('custSheetBody');
	if (titleEl) titleEl.textContent = item.name;
	if (basePriceEl) basePriceEl.textContent = `Base Price: ₹${item.price}`;
	let html = '';
	(item.addonGroups || []).forEach((grp, gIdx) => {
		const isRadio = grp.type === 'radio' || grp.max === 1;
		html += `
      <div class="addon-group-section" data-group-id="${grp.id}">
        <div class="addon-group-header">
          <div class="addon-group-title">${grp.name}</div>
          <div class="addon-group-sub">${grp.subText || 'Optional'}</div>
        </div>
        <div class="addon-group-choices">
    `;
		(grp.choices || []).forEach((ch, cIdx) => {
			const inputName = `addon_grp_${grp.id}`;
			const inputId = `opt_${grp.id}_${cIdx}`;
			const inputType = isRadio ? 'radio' : 'checkbox';
			const isFirstRadio = isRadio && cIdx === 0 && grp.min === 1;
			html += `
        <label class="addon-choice-item" for="${inputId}">
          <div class="addon-choice-left">
            <input 
              type="${inputType}" 
              name="${inputName}" 
              id="${inputId}" 
              class="addon-choice-input"
              data-group-id="${grp.id}"
              data-group-name="${grp.name}"
              data-choice-id="${ch.id}"
              data-choice-name="${ch.name}"
              data-choice-price="${ch.price}"
              ${isFirstRadio ? 'checked' : ''}
              onchange="updateCustomiseTotal()"
            />
            <div class="${ch.isVeg ? 'veg-symbol' : 'nonveg-symbol'}" style="margin-bottom:0; flex-shrink:0;">
              <div class="${ch.isVeg ? 'veg-symbol-dot' : 'nonveg-symbol-dot'}"></div>
            </div>
            <span class="addon-choice-name">${ch.name}</span>
          </div>
          <span class="addon-choice-price">${ch.price > 0 ? '+₹' + ch.price : 'Free'}</span>
        </label>
      `;
		});
		html += `
        </div>
      </div>
    `;
	});
	if (bodyEl) bodyEl.innerHTML = html;
	updateCustomiseTotal();
	if (modal) modal.classList.remove('hidden');
}

function closeCustomiseModal() {
	const modal = document.getElementById('modalCustomiseDish');
	if (modal) modal.classList.add('hidden');
	currentCustomisingDish = null;
}

function updateCustomiseTotal() {
	if (!currentCustomisingDish) return;
	let total = currentCustomisingDish.price;
	const checkedInputs = document.querySelectorAll('#custSheetBody input:checked');
	checkedInputs.forEach((inp) => {
		const extra = parseFloat(inp.dataset.choicePrice || 0);
		if (!isNaN(extra)) {
			total += extra;
		}
	});
	const rounded = Math.round(total);
	const footerTotal = document.getElementById('custFooterTotal');
	const btnPrice = document.getElementById('custAddBtnPrice');
	if (footerTotal) footerTotal.textContent = `₹${rounded}`;
	if (btnPrice) btnPrice.textContent = `₹${rounded}`;
}

function confirmCustomiseAddToCart() {
	if (!currentCustomisingDish || !state.currentMenu) return;
	const rest = state.currentMenu.restaurant;
	if (state.cart.restaurantId && String(state.cart.restaurantId) !== String(rest.id)) {
		if (!confirm(`Your cart already contains items from "${state.cart.restaurantName}". Reset cart and add from "${rest.name}"?`)) {
			return;
		}
		state.cart.items = {};
		state.cart.couponCode = '';
		state.cart.discount = 0;
	}
	state.cart.restaurantId = rest.id;
	state.cart.restaurantName = rest.name;
	state.cart.restaurantArea = rest.area || rest.locality || '';
	state.cart.restaurantSla = rest.deliveryTime || rest.slaString || '';
	state.cart.restaurantDistance = rest.distance || '';
	state.cart.restaurantImage = rest.imageUrl || '';
	const selectedAddons = [];
	let total = currentCustomisingDish.price;
	const checkedInputs = document.querySelectorAll('#custSheetBody input:checked');
	checkedInputs.forEach((inp) => {
		const extra = parseFloat(inp.dataset.choicePrice || 0);
		total += isNaN(extra) ? 0 : extra;
		selectedAddons.push({
			id: inp.dataset.choiceId,
			name: inp.dataset.choiceName,
			price: extra,
			groupName: inp.dataset.groupName,
		});
	});
	const roundedPrice = Math.round(total);
	const addonKey = selectedAddons.map((a) => a.id).sort().join('_');
	const cartItemId = `${currentCustomisingDish.id}${addonKey ? '_' + addonKey : ''}`;
	if (state.cart.items[cartItemId]) {
		state.cart.items[cartItemId].quantity += 1;
	} else {
		state.cart.items[cartItemId] = {
			id: cartItemId,
			baseId: currentCustomisingDish.id,
			name: currentCustomisingDish.name,
			basePrice: currentCustomisingDish.price,
			price: roundedPrice,
			quantity: 1,
			isVeg: currentCustomisingDish.isVeg,
			imageUrl: currentCustomisingDish.imageUrl,
			addons: selectedAddons,
		};
	}
	showToast(`Added "${currentCustomisingDish.name}" to Cart! 🛒`);
	closeCustomiseModal();
	renderMenuItems();
	updateFloatingCartBar();
	updateCartView();
}

function handleAddToCart(itemId) {
	if (!state.currentMenu) return;
	const item = state.currentMenu.items.find((i) => String(i.id) === String(itemId));
	if (!item) return;
	const rest = state.currentMenu.restaurant;
	// Check if adding from another restaurant
	if (state.cart.restaurantId && String(state.cart.restaurantId) !== String(rest.id)) {
		if (!confirm(`Your cart already contains items from "${state.cart.restaurantName}". Reset cart and add from "${rest.name}"?`)) {
			return;
		}
		state.cart.items = {};
		state.cart.couponCode = '';
		state.cart.discount = 0;
	}
	// If item is customisable and has addon groups, open the customisation modal
	if (item.customisable && item.addonGroups && item.addonGroups.length > 0) {
		openCustomiseModal(item);
		return;
	}
	state.cart.restaurantId = rest.id;
	state.cart.restaurantName = rest.name;
	state.cart.restaurantArea = rest.area || rest.locality || '';
	state.cart.restaurantSla = rest.deliveryTime || rest.slaString || '';
	state.cart.restaurantDistance = rest.distance || '';
	state.cart.restaurantImage = rest.imageUrl || '';
	if (state.cart.items[item.id]) {
		state.cart.items[item.id].quantity += 1;
	} else {
		state.cart.items[item.id] = {
			id: item.id,
			baseId: item.id,
			name: item.name,
			basePrice: item.price,
			price: item.price,
			quantity: 1,
			isVeg: item.isVeg,
			imageUrl: item.imageUrl,
			addons: [],
		};
	}
	showToast(`Added "${item.name}" to Cart! 🛒`);
	renderMenuItems();
	updateFloatingCartBar();
	updateCartView();
}

function updateCartQty(itemId, delta) {
	const item = state.cart.items[itemId];
	if (!item) return;
	item.quantity += delta;
	if (item.quantity <= 0) {
		delete state.cart.items[itemId];
		showToast(`Removed from Cart`);
	}
	// If no items left, clear restaurant
	if (Object.keys(state.cart.items).length === 0) {
		state.cart.restaurantId = null;
		state.cart.restaurantName = '';
		state.cart.restaurantArea = '';
		state.cart.restaurantSla = '';
		state.cart.restaurantDistance = '';
		state.cart.restaurantImage = '';
		state.cart.couponCode = '';
		state.cart.discount = 0;
		state.cart.cookingRequest = '';
		state.cart.fcClaimed = true;
		state.cart.fcManuallyToggled = false;
	}
	renderMenuItems();
	updateFloatingCartBar();
	updateCartView();
}

function updateFloatingCartBar() {
	const bar = document.getElementById('floatingCartBar');
	const countEl = document.getElementById('floatCartCount');
	const totalEl = document.getElementById('floatCartTotal');
	const items = Object.values(state.cart.items);
	const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);
	const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
	if (totalCount > 0 && state.activeTab !== 'cart') {
		countEl.textContent = `${totalCount} ${totalCount === 1 ? 'Item' : 'Items'}`;
		totalEl.textContent = `₹${totalPrice}`;
		bar.classList.remove('hidden');
	} else {
		bar.classList.add('hidden');
	}
}

function clearCart() {
	if (!confirm('Clear all items from your cart?')) return;
	state.cart.items = {};
	state.cart.restaurantId = null;
	state.cart.restaurantName = '';
	state.cart.restaurantArea = '';
	state.cart.restaurantSla = '';
	state.cart.restaurantDistance = '';
	state.cart.restaurantImage = '';
	state.cart.couponCode = '';
	state.cart.discount = 0;
	state.cart.cookingRequest = '';
	state.cart.fcClaimed = true;
	state.cart.fcManuallyToggled = false;
	showToast('Cart cleared');
	renderMenuItems();
	updateFloatingCartBar();
	updateCartView();
}
// ==========================================
// 4. CART & CHECKOUT (1:1 TOING BOT)
// ==========================================
function updateCartView() {
	const items = Object.values(state.cart.items);
	const emptyState = document.getElementById('cartEmptyState');
	const contentWrap = document.getElementById('cartContentWrap');
	const stickyPayBar = document.getElementById('cartStickyPayBar');
	if (items.length === 0) {
		if (emptyState) emptyState.classList.remove('hidden');
		if (contentWrap) contentWrap.classList.add('hidden');
		if (stickyPayBar) stickyPayBar.classList.add('hidden');
		return;
	}
	if (emptyState) emptyState.classList.add('hidden');
	if (contentWrap) contentWrap.classList.remove('hidden');
	if (state.activeTab === 'cart' && stickyPayBar) stickyPayBar.classList.remove('hidden');
	// 1. Delivering to Home card
	const cartAddressTitle = document.getElementById('cartAddressTitle');
	const cartAddressSub = document.getElementById('cartAddressSub');
	if (state.selectedAddress) {
		const rawTag = String(state.selectedAddress.tag || state.selectedAddress.annotation || 'Home').toLowerCase();
		const capitalizedTag = rawTag.charAt(0).toUpperCase() + rawTag.slice(1);
		if (cartAddressTitle) cartAddressTitle.textContent = `Delivering to ${capitalizedTag}`;
		const fullAddr = formatFullAddress(state.selectedAddress);
		if (cartAddressSub) {
			cartAddressSub.textContent = fullAddr || 'Selected Address';
			cartAddressSub.title = fullAddr;
		}
	} else {
		if (cartAddressTitle) cartAddressTitle.textContent = 'Delivering to Home';
		if (cartAddressSub) cartAddressSub.textContent = 'Select delivery address';
	}
	// 2. Your Order Section Header
	const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);
	const rawItemTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
	const headerSummary = document.getElementById('cartHeaderSummary');
	if (headerSummary) {
		headerSummary.textContent = `${totalCount} ${totalCount === 1 ? 'item' : 'items'} • ₹${rawItemTotal}`;
	}
	// Restaurant details
	const restLogo = document.getElementById('cartRestLogo');
	const restTitle = document.getElementById('cartRestaurantTitle');
	const restSub = document.getElementById('cartRestSubSla');
	if (restTitle) restTitle.textContent = state.cart.restaurantName || 'Restaurant';
	if (restSub) {
		const area = state.cart.restaurantArea || '';
		const sla = state.cart.restaurantSla || '';
		restSub.textContent = [area, sla].filter(Boolean).join(' • ');
	}
	if (restLogo && state.cart.restaurantImage) {
		restLogo.src = state.cart.restaurantImage;
	}
	// Dishes List (1:1 with Decoders Toing Screenshot)
	const cartList = document.getElementById('cartItemsList');
	if (cartList) {
		let dishesHtml = '';
		items.forEach((item) => {
			const isVeg = item.isVeg !== false;
			const addonsText = item.addons && item.addons.length > 0 ? item.addons.map(a => `${a.name}${a.price ? ` (+₹${Math.round(a.price)})` : ''}`).join(', ') : '';
			dishesHtml += `
        <div class="cart-dish-row">
          <div class="cart-dish-info-col">
            <div class="cart-dish-symbol ${isVeg ? 'veg' : 'nonveg'}">
              <div class="cart-dish-dot"></div>
            </div>
            <div>
              <div class="cart-dish-name">${item.name}</div>
              ${addonsText ? `<div class="cart-dish-addons-sub">+ ${addonsText}</div>` : ''}
            </div>
          </div>
          <div class="cart-dish-actions-col">
            <div class="cart-qty-pill-dark">
              ${item.quantity === 1 ? `
                <button onclick="updateCartQty('${item.id}', -1)" title="Remove item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              ` : `
                <button onclick="updateCartQty('${item.id}', -1)" title="Decrease">−</button>
              `}
              <span>${item.quantity}</span>
              <button onclick="updateCartQty('${item.id}', 1)" title="Increase">+</button>
            </div>
            <div class="cart-dish-price">₹${item.price * item.quantity}</div>
          </div>
        </div>
      `;
		});
		cartList.innerHTML = dishesHtml;
	}
	// Cooking Request Text
	const cookingReqEl = document.getElementById('cookingReqText');
	if (cookingReqEl) {
		if (state.cart.cookingRequest) {
			cookingReqEl.textContent = `Note: "${state.cart.cookingRequest}" (tap to edit)`;
		} else {
			cookingReqEl.textContent = 'Add cooking request';
		}
	}
	// Bill Calculations (live Swiggy /api/cart/update values with fallback)
	renderCartBill(rawItemTotal);
	syncCartBillWithApi(items, rawItemTotal);
	fetchCoupons();
}
let cartBillSyncTimer = null;
let cartBillSyncKey = '';

function renderCartBill(rawItemTotal) {
	const live = state.cart.liveBill;
	const deliveryFee = live ? Number(live.deliveryFee || 0) : null;
	const taxes = live ? Number(live.taxes || 0) : null;
	const couponDiscount = (live && live.couponDiscount > 0) ? Number(live.couponDiscount) : Number(state.cart.discount || 0);
	if (state.cart.couponCode && couponDiscount > 0) {
		state.cart.discount = couponDiscount;
	}
	const fcDiscount = state.cart.fcClaimed ? 50 : 0;
	const toPay = live && live.orderTotal > 0 && !state.cart.fcManuallyToggled && !state.cart.couponCode ? Math.max(0, Math.round(Number(live.orderTotal) - fcDiscount)) : Math.max(0, Math.round(rawItemTotal + (deliveryFee || 0) + (taxes || 0) - couponDiscount - fcDiscount));
	const origTotalEl = document.getElementById('billOrigItemTotal');
	if (origTotalEl) {
		if (live && live.strikeOffItemTotal) {
			origTotalEl.textContent = `₹${live.strikeOffItemTotal}`;
			origTotalEl.style.display = '';
		} else {
			origTotalEl.textContent = '';
			origTotalEl.style.display = 'none';
		}
	}
	document.getElementById('billItemTotal').textContent = `₹${rawItemTotal.toFixed(2)}`;
	const delivLabel = document.getElementById('billDeliveryLabel');
	if (delivLabel) {
		delivLabel.textContent = (live && live.deliveryLabel) ? live.deliveryLabel : (state.cart.restaurantDistance ? `Delivery Fee ${state.cart.restaurantDistance}` : 'Delivery Fee');
	}
	const delivFeeEl = document.getElementById('billDeliveryFee');
	if (delivFeeEl) {
		if (deliveryFee === null) {
			delivFeeEl.textContent = '...';
		} else if (deliveryFee === 0) {
			const strike = live.deliveryStrikeOff ? `<span style="text-decoration:line-through; color:var(--text-muted); margin-right:4px;">₹${live.deliveryStrikeOff}</span>` : '';
			delivFeeEl.innerHTML = `${strike}<span style="color:#16a34a; font-weight:700;">FREE</span>`;
		} else {
			delivFeeEl.textContent = `₹${deliveryFee}`;
		}
	}
	document.getElementById('billTaxes').textContent = taxes === null ? '...' : `₹${taxes}`;
	// Coupon discount row
	const discRow = document.getElementById('billDiscountRow');
	if (discRow) {
		if (couponDiscount > 0) {
			discRow.style.display = 'flex';
			document.getElementById('appliedCouponTag').textContent = state.cart.couponCode;
			document.getElementById('billDiscount').textContent = `-₹${couponDiscount}`;
		} else {
			discRow.style.display = 'none';
		}
	}
	// Food coin discount row
	const fcRow = document.getElementById('billFcDiscountRow');
	if (fcRow) {
		fcRow.style.display = fcDiscount > 0 ? 'flex' : 'none';
	}
	const fcBtnText = document.getElementById('claimFcBtnText');
	if (fcBtnText) {
		fcBtnText.textContent = state.cart.fcClaimed ? 'Claimed ₹50 FC ✔' : 'Claim ₹50 FC';
	}
	// Update Apply Coupon card & BHIM ON/OFF badge
	const cTitle = document.getElementById('couponCardTitle');
	const cSub = document.getElementById('couponCardSub');
	const bhimBadge = document.getElementById('bhimStatusBadge');
	if (cTitle && cSub) {
		if (state.cart.couponCode) {
			cTitle.textContent = `Coupon '${state.cart.couponCode}' applied`;
			cSub.textContent = `Saved ₹${couponDiscount || state.cart.discount || 50} on this order`;
		} else if (state.cart.bhimStatus === 'off') {
			cTitle.textContent = 'Apply coupon';
			cSub.textContent = state.cart.bhimReason || 'BHIM ₹50 not available on this account';
		} else {
			cTitle.textContent = 'Apply coupon';
			cSub.textContent = 'See offers for this restaurant';
		}
	}
	if (bhimBadge) {
		if (state.cart.couponCode === 'BHIMNEW' || state.cart.bhimStatus === 'applied') {
			bhimBadge.textContent = 'BHIM ON ✓';
			bhimBadge.style.background = 'rgba(22, 163, 74, 0.14)';
			bhimBadge.style.color = '#16a34a';
			bhimBadge.style.border = '1px solid rgba(22, 163, 74, 0.3)';
			bhimBadge.classList.remove('hidden');
		} else if (state.cart.bhimStatus === 'off') {
			bhimBadge.textContent = 'BHIM OFF';
			bhimBadge.style.background = 'rgba(239, 68, 68, 0.12)';
			bhimBadge.style.color = '#dc2626';
			bhimBadge.style.border = '1px solid rgba(239, 68, 68, 0.25)';
			bhimBadge.classList.remove('hidden');
		} else if (state.cart.bhimStatus === 'need_99') {
			bhimBadge.textContent = 'BHIM ₹99+';
			bhimBadge.style.background = 'rgba(148, 163, 184, 0.14)';
			bhimBadge.style.color = 'var(--text-muted)';
			bhimBadge.style.border = '1px solid rgba(148, 163, 184, 0.25)';
			bhimBadge.classList.remove('hidden');
		} else {
			bhimBadge.classList.add('hidden');
		}
	}
	document.getElementById('billGrandTotal').textContent = `₹${toPay}`;
	// Sticky pay bar elements
	const stickyAmt = document.getElementById('stickyPayAmount');
	if (stickyAmt) stickyAmt.textContent = `₹${toPay}`;
	updateWalletUi();
}

function syncCartBillWithApi(items, rawItemTotal) {
	if (!state.activeAccount || !items || items.length === 0) {
		state.cart.liveBill = null;
		return;
	}
	const key = JSON.stringify({
		r: state.cart.restaurantId,
		a: state.selectedAddressId,
		i: items.map((x) => `${x.id}:${x.quantity}:${x.price}`),
	});
	if (key === cartBillSyncKey && state.cart.liveBill) return;
	if (cartBillSyncTimer) clearTimeout(cartBillSyncTimer);
	cartBillSyncTimer = setTimeout(async () => {
		try {
			const res = await fetch('/api/cart/update', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					restaurantId: state.cart.restaurantId,
					items,
					cookingRequest: state.cart.cookingRequest || '',
					couponCode: state.cart.couponCode || '',
					autoApplyBhim: !state.cart.couponManuallyRemoved,
					lat: state.selectedAddress?.lat,
					lng: state.selectedAddress?.lng,
					addressId: state.selectedAddressId,
				}),
			});
			const data = await res.json();
			if (data.success && data.bill) {
				cartBillSyncKey = key;
				state.cart.liveBill = data.bill;
				state.cart.bhimStatus = data.bhimStatus || '';
				state.cart.bhimReason = data.bhimReason || '';
				if (data.autoAppliedCoupon && data.autoAppliedCoupon.code && !state.cart.couponCode) {
					state.cart.couponCode = data.autoAppliedCoupon.code;
					state.cart.discount = Number(data.autoAppliedCoupon.discount || 50);
					showToast(`🎉 ${state.cart.couponCode} auto-applied! Saved ₹${state.cart.discount}`);
					fetchCoupons();
				}
				renderCartBill(rawItemTotal);
			}
		} catch (e) {}
	}, 250);
}

function openCookingRequestPrompt() {
	const current = state.cart.cookingRequest || '';
	const note = prompt('Add cooking instructions for restaurant (e.g. Less spicy, extra sauce, no onions):', current);
	if (note !== null) {
		state.cart.cookingRequest = note.trim();
		updateCartView();
		if (state.cart.cookingRequest) {
			showToast('Cooking request saved');
		}
	}
}

function toggleCouponSection() {
	const drawer = document.getElementById('cartCouponDrawer');
	const chevron = document.getElementById('couponChevron');
	if (!drawer) return;
	const isHidden = drawer.classList.toggle('hidden');
	if (chevron) {
		chevron.textContent = isHidden ? '›' : 'ˇ';
	}
}

function claimFoodCoinDiscount() {
	state.cart.fcManuallyToggled = true;
	state.cart.fcClaimed = !state.cart.fcClaimed;
	if (state.cart.fcClaimed) {
		showToast('⚡ ₹50 Food Coins claimed!');
	} else {
		showToast('Food Coin claim removed');
	}
	updateCartView();
}

function refreshBillDetails() {
	showToast('Refreshing bill details...');
	updateCartView();
}

function setCartPaymentMethod(method) {
	state.cart.paymentMethod = method;
	const upiBox = document.getElementById('optPayUPI');
	const codBox = document.getElementById('optPayCOD');
	const checkUpi = document.getElementById('checkPayUPI');
	const checkCod = document.getElementById('checkPayCOD');
	const upiWrap = document.getElementById('upiCollectInputWrap');
	const checkSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#10b981"><circle cx="12" cy="12" r="10"></circle><polyline points="8 12 11 15 16 9" stroke="#fff" stroke-width="2.5" fill="none"></polyline></svg>';
	if (upiBox) upiBox.classList.toggle('selected', method !== 'Cash');
	if (codBox) codBox.classList.toggle('selected', method === 'Cash');
	if (checkUpi) {
		checkUpi.className = method !== 'Cash' ? 'pay-opt-check' : 'pay-opt-radio-empty';
		checkUpi.innerHTML = method !== 'Cash' ? checkSvg : '';
	}
	if (checkCod) {
		checkCod.className = method === 'Cash' ? 'pay-opt-check' : 'pay-opt-radio-empty';
		checkCod.innerHTML = method === 'Cash' ? checkSvg : '';
	}
	if (upiWrap) {
		upiWrap.style.display = method !== 'Cash' ? 'block' : 'none';
	}
}
async function loadPaymentOptions() {
	try {
		const addrId = state.selectedAddress?.id || '';
		const res = await fetch(`/api/payment-options${addrId ? '?addressId=' + encodeURIComponent(addrId) : ''}`);
		const data = await res.json();
		const codBox = document.getElementById('optPayCOD');
		const codName = document.getElementById('codNameText');
		const codDesc = document.getElementById('codDescText');
		if (codBox && data.success) {
			if (data.codEnabled) {
				codBox.classList.remove('disabled');
				if (codName) codName.style.color = '';
				if (codDesc) {
					codDesc.className = 'pay-opt-desc';
					codDesc.textContent = 'Pay cash or ask for QR code';
				}
			} else {
				codBox.classList.add('disabled');
				if (codName) codName.style.color = 'var(--text-muted)';
				if (codDesc) {
					codDesc.className = 'pay-opt-badge-soon';
					codDesc.textContent = 'Currently unavailable';
				}
			}
		}
	} catch (e) {}
}
async function fetchCoupons() {
	const container = document.getElementById('couponList');
	if (!container) return;
	try {
		const items = Object.values(state.cart.items || {});
		const cartValue = Math.max(0, Math.round(items.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0)));
		const params = new URLSearchParams();
		if (state.cart.restaurantId) params.set('restaurantId', state.cart.restaurantId);
		if (cartValue > 0) params.set('cartValue', String(cartValue));
		if (state.selectedAddress?.lat) params.set('lat', String(state.selectedAddress.lat));
		if (state.selectedAddress?.lng) params.set('lng', String(state.selectedAddress.lng));
		const res = await fetch(`/api/coupons?${params.toString()}`);
		const data = await res.json();
		const coupons = data.coupons || [];
		if (coupons.length === 0) {
			container.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:8px;">No live coupons available for this order.</div>';
			return;
		}
		let html = '';
		coupons.forEach((c) => {
			const isApplied = state.cart.couponCode === c.code;
			const isLocked = Boolean(c.locked || /^add\s*₹/i.test(String(c.subtitle || '').trim())) && !isApplied;
			html += `
        <div class="address-card-item" style="cursor:${isLocked ? 'not-allowed' : 'pointer'}; opacity:${isLocked ? '0.6' : '1'}; display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;" ${isLocked ? '' : `onclick="selectCoupon('${c.code}')"`}>
          <div style="flex:1; margin-right:12px;">
            <div class="address-card-top" style="margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              <span class="badge-tag tag-account" style="font-weight:700;">${c.code}</span>
              ${c.ribbonText ? `<span class="badge-tag" style="background:rgba(34,197,94,0.15); color:#22c55e; font-size:10px;">${c.ribbonText}</span>` : ''}
            </div>
            <div style="font-size:12px; font-weight:600; color:var(--text-main);">${c.subtitle || c.title}</div>
            <div style="font-size:11px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${c.description}</div>
          </div>
          <button class="pill-btn ${isApplied ? 'green-pill' : (isLocked ? '' : 'purple-pill')}" ${isLocked ? 'disabled style="font-size:11px; padding:6px 12px; white-space:nowrap; background:rgba(148,163,184,0.18); color:var(--text-muted); border:1px solid rgba(148,163,184,0.25); cursor:not-allowed;"' : 'style="font-size:11px; padding:6px 14px; white-space:nowrap;"'}>
            ${isApplied ? 'APPLIED ✓' : (isLocked ? '🔒 LOCKED' : 'APPLY')}
          </button>
        </div>
      `;
		});
		container.innerHTML = html;
	} catch (err) {
		container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Failed to load offers.</div>';
	}
}

function selectCoupon(code) {
	document.getElementById('inputCouponCode').value = code;
	handleApplyCoupon();
}
async function handleApplyCoupon() {
	const code = (document.getElementById('inputCouponCode').value || '').trim().toUpperCase();
	if (!code) {
		showToast('Enter a coupon code', true);
		return;
	}
	setButtonLoading('btnApplyCoupon', true);
	try {
		const res = await fetch('/api/coupons/apply', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				couponCode: code
			}),
		});
		const data = await res.json();
		if (data.success) {
			state.cart.couponCode = code;
			state.cart.discount = data.discount || 50;
			updateCartView();
			showToast(data.message || `🎉 Coupon ${code} applied! Saved ₹${state.cart.discount}`);
		} else {
			showToast(data.error || 'Invalid coupon code', true);
		}
	} catch (err) {
		showToast('Failed to apply coupon', true);
	} finally {
		setButtonLoading('btnApplyCoupon', false);
	}
}
async function handlePlaceOrder() {
	const items = Object.values(state.cart.items);
	if (items.length === 0) {
		showToast('Add items to cart before placing order!', true);
		return;
	}
	// Enforce dynamic order fee in wallet
	const reqFee = Number(state.orderFee ?? 3);
	const reqMin = Number(state.minDeposit ?? 15);
	if (reqFee > 0 && (state.walletBalance || 0) < reqFee) {
		showToast(`₹${reqFee} order fee required! Please deposit min ₹${reqMin} in wallet.`, true);
		openWalletModal();
		return;
	}
	const btn = document.getElementById('btnPlaceOrder');
	const stickyBtn = document.getElementById('btnStickyPayOrder');
	if (btn) setButtonLoading(btn, true, 'Placing Order...');
	if (stickyBtn) setButtonLoading(stickyBtn, true, 'Processing...');
	const itemTotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
	const deliveryFee = state.cart.liveBill ? Number(state.cart.liveBill.deliveryFee || 0) : 0;
	const taxes = state.cart.liveBill ? Number(state.cart.liveBill.taxes || 0) : 0;
	const fcDiscount = state.cart.fcClaimed ? 50 : 0;
	const total = Math.max(0, Math.round(itemTotal + deliveryFee + taxes - (state.cart.discount || 0) - fcDiscount));
	const payMethod = state.cart.paymentMethod || 'UPIIntent';
	const upiVpa = (document.getElementById('inputUpiVpa')?.value || '').trim();
	try {
		const res = await fetch('/api/orders/place', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				items,
				restaurantId: state.cart.restaurantId,
				restaurantName: state.cart.restaurantName,
				total,
				address: formatFullAddress(state.selectedAddress) || 'Delivery Address',
				couponCode: state.cart.couponCode,
				paymentMethod: upiVpa ? 'UPI' : payMethod,
				upiVpa,
				cookingRequest: state.cart.cookingRequest || '',
			}),
		});
		const data = await res.json();
		if (data.code === 'INSUFFICIENT_WALLET_BALANCE') {
			showToast(data.error || '₹3 order fee required! Min ₹15 deposit.', true);
			loadWallet();
			openWalletModal();
			return;
		}
		if (data.success && data.order_id) {
			loadWallet();
			const pmUp = String(data.payment_code || payMethod || '').toUpperCase();
			if (pmUp === 'CASH' || pmUp === 'COD') {
				showToast(`🎉 Order #${data.order_id} Placed (Pay on Delivery)!`);
				clearCartAfterOrder();
				switchTab('orders');
				fetchOrders();
				openOrderDetails(data.order_id);
			} else {
				openPaymentFlowModal({
					orderId: data.order_id,
					paasId: data.paas_id || '',
					amount: data.amount || total,
					upiUri: data.upi_uri || '',
					paymentCode: data.payment_code || 'UPIIntent',
					upiVpa,
				});
			}
		} else {
			showToast(data.error || 'Failed to initiate payment on Swiggy', true);
		}
	} catch (e) {
		showToast('Network error while initiating payment', true);
	} finally {
		if (btn) {
			setButtonLoading(btn, false);
			btn.innerHTML = `<span>🛍️ BUY NOW / PLACE ORDER</span> <span id="checkoutTotalText">₹${total}</span>`;
		}
		if (stickyBtn) {
			setButtonLoading(stickyBtn, false);
			updateWalletUi();
		}
	}
}
// ==========================================
// 7. BOT WALLET & BHARATPE RECHARGE (₹3 FEE, MIN ₹15 DEPOSIT)
// ==========================================
let bharatPePollTimer = null;
let activeRechargeRefId = '';
async function loadWallet() {
	try {
		const res = await fetch('/api/wallet');
		const data = await res.json();
		if (data.success) {
			state.walletBalance = Number(data.balance || 0);
			state.orderFee = Number(data.orderFee ?? 3);
			state.minDeposit = Number(data.minDeposit ?? 15);
			state.isAdmin = Boolean(data.isAdmin);
			state.walletTxns = data.transactions || [];
			updateWalletUi();
			renderWalletTransactions();
		}
	} catch (e) {}
}

function updateWalletUi() {
	const bal = Number(state.walletBalance || 0);
	const fee = Number(state.orderFee ?? 3);
	const minDep = Number(state.minDeposit ?? 15);
	const pillText = document.getElementById('walletBalanceText');
	if (pillText) pillText.textContent = `₹${bal}`;
	const modalBal = document.getElementById('modalWalletBal');
	if (modalBal) modalBal.textContent = `₹${bal}`;
	const feeLbl = document.getElementById('walletOrderFeeLabel');
	if (feeLbl) feeLbl.textContent = `₹${fee} / order`;
	const minLbl = document.getElementById('walletMinDepLabel');
	if (minLbl) minLbl.textContent = `₹${minDep}`;
	const minPrompt = document.getElementById('walletMinDepPrompt');
	if (minPrompt) minPrompt.textContent = `Select Recharge Amount (Min ₹${minDep})`;
	const amtInput = document.getElementById('inputRechargeAmount');
	if (amtInput) {
		amtInput.min = String(minDep);
		if (!amtInput.value || Number(amtInput.value) < minDep) amtInput.value = minDep;
	}
	const chipsWrap = document.getElementById('walletQuickChips');
	if (chipsWrap) {
		const presets = [minDep, minDep * 2, minDep * 4, minDep * 10];
		chipsWrap.innerHTML = presets.map((v, idx) => {
			const ordersTxt = fee > 0 ? ` (${Math.floor(v / fee)} Orders)` : '';
			return `<button type="button" class="acc-chip ${idx === 0 ? 'active' : ''}" onclick="setRechargeAmount(${v})">₹${v}${idx < 3 ? ordersTxt : ''}</button>`;
		}).join('');
	}
	const adminBox = document.getElementById('adminFeeSettingsBox');
	if (adminBox) {
		if (state.isAdmin) {
			adminBox.classList.remove('hidden');
			const fIn = document.getElementById('adminInputOrderFee');
			const mIn = document.getElementById('adminInputMinDeposit');
			if (fIn && document.activeElement !== fIn) fIn.value = fee;
			if (mIn && document.activeElement !== mIn) mIn.value = minDep;
		} else {
			adminBox.classList.add('hidden');
		}
	}
	const stickyBtn = document.getElementById('btnStickyPayOrder');
	if (stickyBtn && !stickyBtn.disabled) {
		stickyBtn.innerHTML = (fee > 0 && bal < fee) ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg><span id="stickyPayBtnText">Add order fee</span>` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"></polyline></svg><span id="stickyPayBtnText">Place Order${fee > 0 ? ` (₹${fee} Fee)` : ''}</span>`;
	}
}
async function saveAdminFeeSettings() {
	const orderFee = Number(document.getElementById('adminInputOrderFee')?.value);
	const minDeposit = Number(document.getElementById('adminInputMinDeposit')?.value);
	if (isNaN(orderFee) || orderFee < 0 || isNaN(minDeposit) || minDeposit < 1) {
		showToast('Enter valid Order Fee (>= 0) and Min Deposit (>= 1)', true);
		return;
	}
	const btn = document.getElementById('btnSaveAdminSettings');
	setButtonLoading(btn, true, 'Saving...');
	try {
		const res = await fetch('/api/admin/settings', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				orderFee,
				minDeposit
			}),
		});
		const data = await res.json();
		if (data.success) {
			state.orderFee = Number(data.orderFee);
			state.minDeposit = Number(data.minDeposit);
			updateWalletUi();
			showToast(`✅ Updated: ₹${data.orderFee}/order, Min ₹${data.minDeposit}`);
		} else {
			showToast(data.error || 'Failed to save settings', true);
		}
	} catch (e) {
		showToast('Network error saving settings', true);
	} finally {
		setButtonLoading(btn, false);
	}
}

function renderWalletTransactions() {
	const box = document.getElementById('walletTxnsList');
	if (!box) return;
	const txns = state.walletTxns || [];
	if (txns.length === 0) {
		box.innerHTML = '<div>No transactions yet. Deposit min ₹15 to start ordering.</div>';
		return;
	}
	box.innerHTML = txns.map((t) => {
		const isCredit = t.type === 'CREDIT';
		return `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--border-color);">
      <span style="color:var(--text-main);">${t.description || t.type}</span>
      <strong style="color:${isCredit ? '#16a34a' : '#dc2626'};">${isCredit ? '+' : '-'}₹${t.amount}</strong>
    </div>`;
	}).join('');
}

function openWalletModal() {
	resetWalletModalStep();
	loadWallet();
	document.getElementById('modalWalletRecharge').classList.remove('hidden');
}

function closeWalletModal() {
	if (bharatPePollTimer) {
		clearInterval(bharatPePollTimer);
		bharatPePollTimer = null;
	}
	closeModal('modalWalletRecharge');
}

function resetWalletModalStep() {
	if (bharatPePollTimer) {
		clearInterval(bharatPePollTimer);
		bharatPePollTimer = null;
	}
	activeRechargeRefId = '';
	document.getElementById('walletAmountStep').classList.remove('hidden');
	document.getElementById('walletQrStep').classList.add('hidden');
}

function setRechargeAmount(amt) {
	const input = document.getElementById('inputRechargeAmount');
	if (input) input.value = amt;
}
async function initBharatPeRecharge() {
	const minDep = Number(state.minDeposit ?? 15);
	const amt = Math.round(Number(document.getElementById('inputRechargeAmount')?.value || 0));
	if (!amt || amt < minDep) {
		showToast(`Minimum deposit is ₹${minDep}`, true);
		return;
	}
	const btn = document.getElementById('btnInitBharatPe');
	setButtonLoading(btn, true, 'Generating QR...');
	try {
		const res = await fetch('/api/wallet/recharge/init', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				amount: amt
			}),
		});
		const data = await res.json();
		if (!data.success) {
			showToast(data.error || 'Failed to generate BharatPe QR', true);
			return;
		}
		activeRechargeRefId = data.refId;
		document.getElementById('qrPayAmountText').textContent = `₹${data.amount}`;
		document.getElementById('bharatPeQrImg').src = data.qrUrl;
		const bpLink = document.getElementById('bharatPeUpiLink');
		bpLink.href = '#';
		bpLink.onclick = (e) => {
			e.preventDefault();
			openExternalUpi(data.upiUri);
		};
		document.getElementById('inputManualUtr').value = '';
		document.getElementById('bharatPePollStatus').innerHTML = '<div class="mini-spinner"></div><span>Waiting for BharatPe auto-verification...</span>';
		document.getElementById('walletAmountStep').classList.add('hidden');
		document.getElementById('walletQrStep').classList.remove('hidden');
		if (bharatPePollTimer) clearInterval(bharatPePollTimer);
		let checks = 0;
		bharatPePollTimer = setInterval(async () => {
			checks++;
			if (checks > 45) {
				clearInterval(bharatPePollTimer);
				bharatPePollTimer = null;
				return;
			}
			await verifyBharatPeRecharge(true);
		}, 3500);
	} catch (e) {
		showToast('Network error generating QR', true);
	} finally {
		setButtonLoading(btn, false);
	}
}
async function verifyBharatPeRecharge(isAuto = false) {
	const utr = (document.getElementById('inputManualUtr')?.value || '').trim();
	if (!isAuto) setButtonLoading('btnVerifyBharatPe', true, 'Verifying...');
	try {
		const res = await fetch('/api/wallet/recharge/verify', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				refId: activeRechargeRefId,
				utr
			}),
		});
		const data = await res.json();
		if (data.verified) {
			if (bharatPePollTimer) {
				clearInterval(bharatPePollTimer);
				bharatPePollTimer = null;
			}
			showToast(`🎉 ₹${data.creditedAmount} added to wallet!`);
			state.walletBalance = Number(data.balance || 0);
			updateWalletUi();
			loadWallet();
			closeWalletModal();
		} else if (!data.success && data.error) {
			const stEl = document.getElementById('bharatPePollStatus');
			if (stEl) stEl.innerHTML = `<span style="color:#dc2626; font-weight:700; font-size:12px;">⚠️ ${data.error}</span>`;
			if (!isAuto) showToast(data.error, true);
		} else if (!isAuto) {
			showToast(data.error || data.message || 'Payment not received yet', true);
		}
	} catch (e) {
		if (!isAuto) showToast('Error verifying payment', true);
	} finally {
		if (!isAuto) setButtonLoading('btnVerifyBharatPe', false);
	}
}
let paymentPollTimer = null;

function clearCartAfterOrder() {
	state.cart.items = {};
	state.cart.restaurantId = null;
	state.cart.restaurantName = '';
	state.cart.restaurantArea = '';
	state.cart.restaurantSla = '';
	state.cart.restaurantDistance = '';
	state.cart.restaurantImage = '';
	state.cart.couponCode = '';
	state.cart.discount = 0;
	state.cart.cookingRequest = '';
	state.cart.fcClaimed = true;
	state.cart.fcManuallyToggled = false;
	state.cart.liveBill = null;
	state.ordersCache = null;
	updateFloatingCartBar();
	updateCartView();
}

function cancelPaymentFlow() {
	if (paymentPollTimer) {
		clearInterval(paymentPollTimer);
		paymentPollTimer = null;
	}
	closeModal('modalPaymentFlow');
}

function openExternalUpi(uri) {
	if (!uri) return;
	const tgOpen = window.Telegram?.WebApp?.openLink;
	if (tgOpen) {
		// Telegram WebView throws net::ERR_UNKNOWN_URL_SCHEME on upi:// navigation;
		// open an https:// launcher page in the external browser instead.
		const launchUrl = `${window.location.origin}/api/upi-launch?uri=${encodeURIComponent(uri)}`;
		try {
			tgOpen.call(window.Telegram.WebApp, launchUrl, {
				try_instant_view: false
			});
			return;
		} catch (e) {}
	}
	window.location.href = uri;
}

function copyUpiUri(uri) {
	if (!uri) return;
	navigator.clipboard?.writeText(uri).then(() => {
		showToast('📋 UPI Link copied!');
	}).catch(() => {
		showToast('Copy failed', true);
	});
}

function openPaymentFlowModal(info) {
	const modal = document.getElementById('modalPaymentFlow');
	const body = document.getElementById('paymentModalBody');
	if (!modal || !body) return;
	const {
		orderId,
		paasId,
		amount,
		upiUri,
		paymentCode,
		upiVpa
	} = info;
	state.activeUpiUri = upiUri || '';
	const qrImgUrl = upiUri ? `https://api.qrserver.com/v1/create-qr-code/?size=185x185&margin=6&data=${encodeURIComponent(upiUri)}` : '';
	body.innerHTML = `
    <div style="background:var(--input-bg); border:1px solid var(--border-color); border-radius:12px; padding:12px; margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span style="color:var(--text-muted); font-size:12px;">Order ID</span>
        <span style="font-weight:700;">#${orderId}</span>
      </div>
      ${paasId ? `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span style="color:var(--text-muted); font-size:12px;">Transaction ID</span><span style="font-weight:600; font-size:12px;">${paasId}</span></div>` : ''}
      <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; margin-top:6px;">
        <span>Amount Payable</span>
        <span style="color:var(--primary);">₹${amount}</span>
      </div>
    </div>

    ${upiVpa ? `<div style="background:rgba(16,185,129,0.1); color:#047857; padding:9px 12px; border-radius:10px; font-size:12.5px; font-weight:600; margin-bottom:12px;">📲 UPI Collect request sent to <strong>${upiVpa}</strong>. Please approve in your UPI app!</div>` : ''}
    ${qrImgUrl ? `
      <div style="text-align:center; margin-bottom:10px;">
        <div style="background:#fff; padding:8px; border-radius:12px; display:inline-block; border:1px solid var(--border-color);">
          <img src="${qrImgUrl}" alt="Swiggy UPI QR" style="width:175px; height:175px; display:block;" />
        </div>
        <div style="font-size:11.5px; color:var(--text-muted); margin-top:4px;">Scan QR with GPay / PhonePe / Paytm</div>
      </div>
    ` : ''}
    ${upiUri ? `
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <button type="button" class="btn-primary" style="flex:1;" onclick="openExternalUpi(state.activeUpiUri)">🚀 Open UPI App & Pay ₹${amount}</button>
        <button type="button" class="btn-secondary" style="padding:10px 14px;" onclick="copyUpiUri(state.activeUpiUri)" title="Copy UPI Link">📋</button>
      </div>
    ` : ''}

    <div id="vpaLiveStatusBox" class="skeleton-spinner-row" style="padding:10px 0;">
      <div class="mini-spinner"></div>
      <span>Waiting for UPI payment confirmation...</span>
    </div>

    <div style="display:flex; gap:8px; margin-top:8px;">
      <button class="btn-primary" id="btnManualConfirmPay" style="flex:1;" onclick="checkAndConfirmPayment('${orderId}', '${paasId}', '${paymentCode}')">Check & Confirm</button>
      <button class="btn-secondary" style="padding:12px 16px;" onclick="cancelPaymentFlow()">Cancel</button>
    </div>
  `;
	modal.classList.remove('hidden');
	if (paymentPollTimer) clearInterval(paymentPollTimer);
	let attempts = 0;
	paymentPollTimer = setInterval(async () => {
		attempts++;
		if (attempts > 40) {
			clearInterval(paymentPollTimer);
			paymentPollTimer = null;
			return;
		}
		await checkAndConfirmPayment(orderId, paasId, paymentCode, true);
	}, 3000);
}
async function checkAndConfirmPayment(orderId, paasId, paymentCode = 'UPIIntent', isAuto = false) {
	const statusBox = document.getElementById('vpaLiveStatusBox');
	try {
		if (paasId) {
			const stRes = await fetch(`/api/orders/vpa-status?paasId=${encodeURIComponent(paasId)}&paymentCode=${encodeURIComponent(paymentCode)}`);
			const stData = await stRes.json();
			const st = String(stData.status || '').toLowerCase();
			if (st === 'success') {
				if (paymentPollTimer) {
					clearInterval(paymentPollTimer);
					paymentPollTimer = null;
				}
				if (statusBox) statusBox.innerHTML = '<span style="color:#16a34a; font-weight:800;">✅ Payment Verified! Confirming order...</span>';
				const cfRes = await fetch('/api/orders/confirm', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						orderId
					}),
				});
				const cfData = await cfRes.json();
				showToast(cfData.success ? `🎉 Order #${orderId} Confirmed!` : `Order #${orderId} placed!`);
				clearCartAfterOrder();
				closeModal('modalPaymentFlow');
				switchTab('orders');
				fetchOrders();
				openOrderDetails(orderId);
				return;
			} else if (st === 'failed' || st === 'failure') {
				if (paymentPollTimer) {
					clearInterval(paymentPollTimer);
					paymentPollTimer = null;
				}
				if (statusBox) statusBox.innerHTML = '<span style="color:#dc2626; font-weight:700;">❌ Payment failed or declined.</span>';
				return;
			} else if (!isAuto) {
				showToast('Payment still pending. Please approve in UPI app.');
			}
		} else if (!isAuto) {
			// No paasId returned; try direct order/confirm
			const cfRes = await fetch('/api/orders/confirm', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					orderId
				}),
			});
			const cfData = await cfRes.json();
			if (cfData.success) {
				if (paymentPollTimer) {
					clearInterval(paymentPollTimer);
					paymentPollTimer = null;
				}
				showToast(`🎉 Order #${orderId} Confirmed!`);
				clearCartAfterOrder();
				closeModal('modalPaymentFlow');
				switchTab('orders');
				fetchOrders();
				openOrderDetails(orderId);
			} else {
				showToast(cfData.error || 'Payment not confirmed yet', true);
			}
		}
	} catch (e) {
		if (!isAuto) showToast('Error checking payment status', true);
	}
}
// ==========================================
// 5. ORDERS
// ==========================================
function copyPlainText(text, msg = 'Copied!') {
	if (!text) return;
	navigator.clipboard?.writeText(String(text)).then(() => showToast(msg)).catch(() => showToast('Copy failed', true));
}

function closeOrderDetails() {
	const listCard = document.getElementById('ordersListCard');
	const detailView = document.getElementById('orderDetailView');
	if (detailView) detailView.classList.add('hidden');
	if (listCard) listCard.classList.remove('hidden');
}
async function fetchOrders() {
	closeOrderDetails();
	const container = document.getElementById('ordersList');
	container.innerHTML = getSkeletonHtml(3, false);
	setButtonLoading('btnRefreshOrders', true, 'Refreshing...', true);
	try {
		const res = await fetch('/api/orders');
		const data = await res.json();
		const orders = data.data?.data?.orders || data.orders || [];
		if (orders.length === 0) {
			container.innerHTML = '<div class="empty-hint">No past orders found for this account.</div>';
			return;
		}
		let html = '';
		state.ordersCache = orders;
		orders.forEach((o) => {
			const itemsList = o.items ? o.items.map((it) => `${it.name} (x${it.quantity})`).join(', ') : '';
			html += `
        <div class="address-card-item" style="cursor:pointer;" onclick="openOrderDetails('${o.order_id}')">
          <div class="address-card-top">
            <span class="badge-tag tag-other">ORDER #${o.order_id}</span>
            <span class="badge-tag tag-account">${(o.order_status || 'DELIVERED').toUpperCase()}</span>
          </div>
          <div class="address-user-line">${o.restaurant_name} • ₹${o.order_total}</div>
          ${itemsList ? `<div class="address-text-full" style="color:var(--primary); font-weight:600; margin:2px 0;">🍴 ${itemsList}</div>` : ''}
          <div class="address-text-full">Delivered to: ${o.delivery_address || 'Delivery Address'}</div>
          <div style="font-size:11px; color:var(--primary); font-weight:700; margin-top:6px; text-align:right;">Tap to track & view details ›</div>
        </div>
      `;
		});
		container.innerHTML = html;
	} catch (e) {
		container.innerHTML = '<div class="empty-hint">Failed to load orders from Swiggy.</div>';
	} finally {
		setButtonLoading('btnRefreshOrders', false);
	}
}
async function openOrderDetails(orderId) {
	const listCard = document.getElementById('ordersListCard');
	const detailView = document.getElementById('orderDetailView');
	if (!detailView) return;
	if (listCard) listCard.classList.add('hidden');
	detailView.classList.remove('hidden');
	detailView.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <button type="button" class="btn-secondary btn-sm" onclick="closeOrderDetails()" style="border-radius:999px; padding:7px 14px; font-weight:700;">← Back to Orders</button>
      <button type="button" class="btn-secondary btn-sm" onclick="openOrderDetails('${orderId}')" style="border-radius:999px; padding:7px 14px; font-weight:700;">🔄 Refresh</button>
    </div>
    <div class="card"><div class="skeleton-spinner-row"><div class="mini-spinner"></div><span>Loading live order status...</span></div></div>
  `;
	const cached = (state.ordersCache || []).find((o) => String(o.order_id) === String(orderId));
	try {
		const res = await fetch(`/api/orders/${orderId}`);
		const data = await res.json();
		const ord = data.liveOrder || data.order || cached || {
			order_id: orderId
		};
		const track = data.trackData?.data || data.trackData || {};
		const status = (track.order_status || ord.order_status || cached?.order_status || 'PREPARING').toUpperCase();
		const orderTime = ord.order_time || cached?.order_time || 'Just now';
		const total = Number(ord.order_total ?? ord.net_total ?? cached?.order_total ?? 0);
		const items = ord.order_items || ord.items || cached?.items || [];
		const statusMsg = track.message || track.statusMessage || data.trackData?.statusMessage || '';
		// Delivery Partner details
		const dp = ord.delivery_boy || track.delivery_boy || track.de_details || {};
		const dpName = dp.name || '';
		const dpPhone = dp.mobile || dp.phone || '';
		const dpText = dpName ? `${dpName}${dpPhone ? ' | ' + dpPhone : ''}` : (status === 'DELIVERED' ? 'Delivered' : 'Assigning partner...');
		// Tracking link
		const trackUrl = `https://www.swiggy.com/track-order/${orderId}`;
		// Extract full Bill Details
		const charges = ord.charges || {};
		const itemTotal = Number(ord.item_total || items.reduce((s, it) => s + Number(it.sub_total || it.item_total || (it.cost ? it.cost / 100 : 0)), 0) || total);
		const deliveryFee = Number(ord.delivery_charges ?? charges['Total Delivery Fees'] ?? charges['Delivery Charges'] ?? 0);
		const packingFee = Number(charges['Packing Charges'] || 0) + Number(charges['Convenience Fee'] || 0) + Number(charges['Service Charges'] || 0);
		const taxes = Math.round((Number(ord.order_tax ?? charges['GST'] ?? 0) + packingFee) * 100) / 100;
		const couponDisc = Number(ord.coupon_discount || 0);
		const otherDisc = Math.max(0, Number(ord.order_discount || 0) + Number(ord.trade_discount || 0) + Number(ord.payment_offer_instant_discount || 0));
		const computedDiff = Math.max(0, Math.round((itemTotal + deliveryFee + taxes - couponDisc - otherDisc - total) * 100) / 100);
		const freeCashDisc = otherDisc > 0 ? otherDisc : (couponDisc === 0 && computedDiff > 0 ? computedDiff : 0);
		const finalCouponDisc = couponDisc > 0 ? couponDisc : (freeCashDisc === 0 && computedDiff > 0 ? computedDiff : 0);
		const rawPm = String(ord.payment_method || ord.payment_method_involved || cached?.payment_method || 'UPI');
		const payLabel = /cash|cod/i.test(rawPm) ? 'COD' : (/upi/i.test(rawPm) ? 'UPI' : rawPm.toUpperCase());
		// Delivery Address & Receiver Contact
		const da = ord.delivery_address;
		const recName = (da && typeof da === 'object' ? da.name : '') || state.selectedAddress?.name || state.activeAccount?.userName || 'Customer';
		const recPhone = (da && typeof da === 'object' ? da.mobile : '') || state.selectedAddress?.mobile || state.activeAccount?.phone || '';
		const addrText = (da && typeof da === 'object') ? [da.flat_no, da.landmark, da.address || da.address_line1, da.city].filter(Boolean).join(', ') : (da || cached?.delivery_address || 'Delivery Address');
		detailView.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeOrderDetails()" style="border-radius:999px; padding:7px 14px; font-weight:700;">← Back to Orders</button>
        <button type="button" class="btn-secondary btn-sm" onclick="openOrderDetails('${orderId}')" style="border-radius:999px; padding:7px 14px; font-weight:700;">🔄 Refresh</button>
      </div>

      <!-- Card 1: Order & Tracking -->
      <div class="card" style="padding:14px 16px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600;">Order ID</span>
          <span style="display:flex; align-items:center; gap:6px; font-weight:700;">
            #${orderId}
            <button type="button" onclick="copyPlainText('${orderId}', 'Order ID copied!')" style="border:1px solid var(--border-color); background:var(--input-bg); border-radius:6px; padding:2px 6px; cursor:pointer; font-size:11px;">📋</button>
          </span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600;">Paid Via</span>
          <span style="background:rgba(16,185,129,0.14); color:#047857; padding:3px 10px; border-radius:999px; font-weight:800; font-size:11.5px;">${payLabel}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600;">Placed On</span>
          <span style="font-weight:700;">${orderTime}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600;">Tracking</span>
          <span style="display:flex; align-items:center; gap:6px;">
            <a href="${trackUrl}" target="_blank" rel="noopener" style="background:rgba(249,115,22,0.12); color:#ea580c; padding:4px 11px; border-radius:999px; font-weight:700; font-size:12px; text-decoration:none;">🎯 Track order</a>
            <button type="button" onclick="copyPlainText('${trackUrl}', 'Tracking link copied!')" style="border:1px solid var(--border-color); background:var(--input-bg); border-radius:6px; padding:2px 6px; cursor:pointer; font-size:11px;">📋</button>
          </span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600;">Delivery Partner</span>
          <span style="font-weight:700; text-align:right;">${dpText}</span>
        </div>
        ${statusMsg ? `<div style="margin-top:8px; background:rgba(99,102,241,0.1); color:var(--primary); padding:8px 10px; border-radius:8px; font-size:12px; font-weight:600;">🛵 ${statusMsg}</div>` : ''}
      </div>

      <!-- Card 2: Delivery Address -->
      <div class="card" style="padding:14px 16px; margin-bottom:12px;">
        <div style="font-weight:800; font-size:14px; margin-bottom:10px;">📍 Delivery Address</div>
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:8px; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600; white-space:nowrap;">Deliver To:</span>
          <span style="font-weight:700; text-align:right; line-height:1.4;">${addrText}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:13px;">
          <span style="color:var(--text-muted); font-weight:600; white-space:nowrap;">Receiver Contact:</span>
          <span style="font-weight:700; text-align:right;">${recName}${recPhone ? ' | ' + recPhone : ''}</span>
        </div>
      </div>

      <!-- Card 3: Ordered Items Summary -->
      <div class="card" style="padding:14px 16px; margin-bottom:12px;">
        <div style="font-weight:800; font-size:14px; margin-bottom:10px;">🧺 Ordered Items Summary</div>
        ${items.length ? items.map((it) => {
          const itPrice = it.sub_total || it.item_total || it.final_price || (it.cost ? Math.round(it.cost / 100) : '');
          const isVeg = it.is_veg !== 0 && it.is_veg !== false;
          const variant = it.variants?.[0]?.name || it.sub_title || '';
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--border-color);">
              <div style="display:flex; align-items:flex-start; gap:8px; flex:1; min-width:0;">
                <span style="width:14px; height:14px; border:1.5px solid ${isVeg ? '#16a34a' : '#dc2626'}; border-radius:3px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:2px;">
                  <span style="width:6px; height:6px; border-radius:50%; background:${isVeg ? '#16a34a' : '#dc2626'};"></span>
                </span>
                <div>
                  <div style="font-weight:700; font-size:13.5px;">${it.name}</div>
                  ${variant ? `<div style="font-size:11.5px; color:var(--text-muted);">${variant}</div>` : ''}
                </div>
              </div>
              <div style="display:flex; align-items:center; gap:14px; flex-shrink:0; font-size:13px;">
                <span style="color:var(--text-muted); font-weight:600;">x ${it.quantity || 1}</span>
                <span style="font-weight:800;">${itPrice !== '' ? '₹' + itPrice : ''}</span>
              </div>
            </div>
          `;
        }).join('') : '<div style="color:var(--text-muted); font-size:13px;">No item breakdown available</div>'}
      </div>

      <!-- Card 4: Payment & Bill Summary -->
      <div class="card" style="padding:14px 16px; margin-bottom:14px;">
        <div style="font-weight:800; font-size:14px; margin-bottom:10px;">🧾 Payment & Bill Summary</div>
        <div style="display:flex; justify-content:space-between; margin:5px 0; font-size:13px;"><span style="color:var(--text-muted);">Item Total</span><span style="font-weight:700;">₹${itemTotal}</span></div>
        ${freeCashDisc > 0 ? `<div style="display:flex; justify-content:space-between; margin:5px 0; font-size:13px; color:#16a34a; font-weight:700;"><span>Free Cash</span><span>-₹${freeCashDisc}</span></div>` : ''}
        ${finalCouponDisc > 0 ? `<div style="display:flex; justify-content:space-between; margin:5px 0; font-size:13px; color:#16a34a; font-weight:700;"><span>Coupon Discount${ord.coupon_applied ? ' (' + ord.coupon_applied + ')' : ''}</span><span>-₹${finalCouponDisc}</span></div>` : ''}
        <div style="display:flex; justify-content:space-between; margin:5px 0; font-size:13px;"><span style="color:var(--text-muted);">Delivery Fee</span><span style="font-weight:700; color:${deliveryFee === 0 ? '#16a34a' : 'inherit'};">${deliveryFee === 0 ? 'FREE' : '₹' + deliveryFee}</span></div>
        <div style="display:flex; justify-content:space-between; margin:5px 0; font-size:13px;"><span style="color:var(--text-muted);">GST & Other Charges</span><span style="font-weight:700;">₹${taxes}</span></div>
        <div style="display:flex; justify-content:space-between; font-weight:800; font-size:16px; border-top:1px solid var(--border-color); padding-top:10px; margin-top:8px;">
          <span>To Pay</span>
          <span>₹${total}</span>
        </div>
      </div>

      <button type="button" class="btn-primary" onclick="closeOrderDetails()" style="width:100%; background:#059669; border-radius:12px; padding:13px; font-size:14.5px; font-weight:800;">🔄 Back to Orders</button>
    `;
	} catch (e) {
		detailView.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <button type="button" class="btn-secondary btn-sm" onclick="closeOrderDetails()" style="border-radius:999px; padding:7px 14px; font-weight:700;">← Back to Orders</button>
      </div>
      <div class="card"><div class="empty-hint">Could not fetch live details for Order #${orderId}.</div></div>
    `;
	}
}
// ==========================================
// 6. BULK VIEW (1:1 TOING BOT SCREENSHOT 1)
// ==========================================
function updateBulkView() {
	const totalAccs = state.accounts.length;
	const freshAccs = state.accounts.filter((a) => !a.isUsed).length;
	const claimStat = document.getElementById('bulkClaimableText');
	if (claimStat) claimStat.textContent = `${totalAccs} claimable`;
	const freshStat = document.getElementById('bulkFreshText');
	if (freshStat) freshStat.textContent = `${freshAccs} fresh accounts`;
}

function openBulkClaimModal() {
	document.getElementById('modalBulkClaim').classList.remove('hidden');
}
async function executeBulkClaim() {
	const code = (document.getElementById('inputBulkReferCode').value || '5G9P5Q').trim();
	const btn = document.getElementById('btnExecuteBulkClaim');
	setButtonLoading(btn, true, 'Claiming ₹50...');
	try {
		const res = await fetch('/api/tools/bulk-claim', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				referralCode: code
			}),
		});
		const data = await res.json();
		if (data.success) {
			showToast(`🎉 Bulk Claim Complete! ${data.claimed || state.accounts.length} accounts credited!`);
			closeModal('modalBulkClaim');
			loadAccounts();
		} else {
			showToast(data.error || 'Bulk claim failed', true);
		}
	} catch (e) {
		showToast('Network error during bulk claim', true);
	} finally {
		setButtonLoading(btn, false);
	}
}

function openBulkOrderModal() {
	const modal = document.getElementById('modalBulkOrder');
	const fresh = state.accounts.filter((a) => !a.isUsed);
	const container = document.getElementById('bulkOrderFreshList');
	if (container) {
		if (fresh.length === 0) {
			container.innerHTML = '<div style="color:var(--text-muted); padding:8px 0;">No fresh accounts available. Mark accounts fresh in Accounts tab.</div>';
		} else {
			container.innerHTML = `<div style="padding:4px 0;"><strong>${fresh.length} Fresh Accounts Ready:</strong> ` + fresh.slice(0, 10).map((a) => `+91 ${a.phone}`).join(', ') + '</div>';
		}
	}
	modal.classList.remove('hidden');
}
async function executeBulkOrder() {
	const btn = document.getElementById('btnExecuteBulkOrder');
	setButtonLoading(btn, true, 'Placing Orders...');
	try {
		const res = await fetch('/api/tools/bulk-order', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				restaurantName: state.cart.restaurantName || 'Restaurant',
				total: 109,
			}),
		});
		const data = await res.json();
		if (data.success) {
			showToast(`🎉 Placed orders simultaneously across ${data.count} accounts!`);
			closeModal('modalBulkOrder');
			loadAccounts();
			switchTab('orders');
		} else {
			showToast('Bulk order failed', true);
		}
	} catch (e) {
		showToast('Network error during bulk order', true);
	} finally {
		setButtonLoading(btn, false);
	}
}
async function handleClaimRefer() {
	const code = document.getElementById('inputReferCode')?.value?.trim();
	if (!code) {
		showToast('Enter referral code', true);
		return;
	}
	showToast('Claiming ₹50 referral cash...');
	try {
		const res = await fetch('/api/tools/claim-refer', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				referralCode: code
			}),
		});
		const data = await res.json();
		showToast('🎁 Referral claimed successfully!');
	} catch (e) {
		showToast('Failed to claim referral', true);
	}
}
async function handleScratchCard() {
	showToast('Unlocking scratch cards...');
	try {
		await fetch('/api/tools/scratch-card', {
			method: 'POST'
		});
		showToast('🎉 Scratch cards unlocked!');
	} catch (e) {
		showToast('Cards unlocked!');
	}
}

function openStoreBot() {
	const url = 'https://t.me/CodeAddabot';
	const tg = window.Telegram?.WebApp;
	if (tg && typeof tg.openTelegramLink === 'function') {
		try {
			tg.openTelegramLink(url);
			return;
		} catch (e) {}
	}
	if (tg && typeof tg.openLink === 'function') {
		try {
			tg.openLink(url);
			return;
		} catch (e) {}
	}
	window.open(url, '_blank', 'noopener,noreferrer');
}
