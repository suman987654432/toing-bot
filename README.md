# Toing Pro - Telegram Mini App & Automation Platform

Automated multi-account manager, discount coupon applier, and catalog tool for **Swiggy Toing**, built with **Node.js, Express.js, MongoDB Atlas**, and a Telegram Mini App (Web App) interface.

---

## 🌟 Features

* **Multi-Account Manager:**
  * Login via SMS OTP with device integrity emulation
  * Instant session import via JSON / HAR tokens
  * Quick-switch between multiple saved accounts
  * One-click account removal
* **Address & Location:**
  * View saved addresses from Swiggy API
* **Catalog & Food Search:**
  * Search restaurants and dishes across the Toing network
  * View detailed menus
* **Cart & Discount Coupons:**
  * Automatic coupon discovery (`fetch-coupons`)
  * Apply promo codes (e.g., `PAYTMUPI`, `BHIM`, `TOING50`)
* **Orders & Tracking:**
  * Order history with live status
* **Automation Tools:**
  * Referral code auto-claim (₹50 Toing cash / rewards)
  * Auto-unlock pending scratch cards
  * Incognito privacy toggle

---

## 🚀 Quick Start Guide

### 1. Configure `.env`
Open the `.env` file and set your credentials:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/toing_pro?retryWrites=true&w=majority
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
WEBAPP_URL=http://localhost:5000
```

> **Note:** If `MONGODB_URI` is left blank, the app runs with an automatic local JSON storage fallback (`data_accounts.json`), so it starts up immediately!

### 2. Start the Server
```bash
npm start
```
* **Local WebApp URL:** [http://localhost:5000](http://localhost:5000)
* **REST API:** `http://localhost:5000/api`

---

## 🤖 Connecting with Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Create a new bot with `/newbot` and copy your HTTP API token into `TELEGRAM_BOT_TOKEN` in `.env`.
3. To test your Telegram Mini App:
   * Expose port 5000 via [ngrok](https://ngrok.com/) or Cloudflare Tunnel:
     ```bash
     npx ngrok http 5000
     ```
   * Set your `WEBAPP_URL` in `.env` to your HTTPS ngrok URL (e.g. `https://xxxx.ngrok-free.app`).
   * Restart your server (`npm start`).
4. Type `/start` in your bot chat on Telegram to launch the **Toing Pro** Mini App!

---

## 📁 Project Structure

```
toing/
├── public/                 # Telegram Mini App Frontend
│   ├── css/style.css       # Purple-themed UI matching the screenshot
│   ├── js/app.js           # Client-side state, OTP handling, tabs
│   └── index.html          # HTML5 layout with 6 bottom tabs
├── src/
│   ├── config/db.js        # MongoDB Atlas connection (with local fallback)
│   ├── models/Account.js   # Account Schema & Multi-account Repo
│   ├── routes/api.js       # Express REST API for WebApp
│   ├── services/
│   │   └── swiggyService.js # Swiggy/Toing API integration engine
│   ├── bot.js              # Telegram Bot (/start & inline web_app button)
│   └── server.js           # Express app entry point
├── package.json
└── .env
```

