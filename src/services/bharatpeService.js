const axios = require('axios');
const http = require('http');
const https = require('https');
const tls = require('tls');

function createProxyAgent(proxyUrl) {
  const p = new URL(proxyUrl);
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (options, cb) => {
    const targetPort = options.port || 443;
    const headers = { Host: `${options.host}:${targetPort}` };
    if (p.username || p.password) {
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64');
    }
    const req = http.request({
      host: p.hostname,
      port: Number(p.port || 80),
      method: 'CONNECT',
      path: `${options.host}:${targetPort}`,
      headers,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return cb(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      }
      const tlsSocket = tls.connect({ socket, servername: options.servername || options.host });
      cb(null, tlsSocket);
    });
    req.on('error', (err) => cb(err));
    req.end();
  };
  return agent;
}

const BharatPeService = {
  getConfig() {
    return {
      merchantId: process.env.BHARATPE_MERCHANT_ID || '',
      token: process.env.BHARATPE_TOKEN || '',
      upiId: process.env.BHARATPE_UPI_ID || '',
      merchantName: process.env.BHARATPE_MERCHANT_NAME || 'Toing Pro',
      proxyUrl: process.env.BHARATPE_PROXY_URL || '',
    };
  },

  buildUpiPayment(amount, refId) {
    const { upiId, merchantName } = this.getConfig();
    if (!upiId) return { upiUri: '', qrUrl: '' };
    const params = new URLSearchParams({
      pa: upiId,
      pn: merchantName,
      am: String(Number(amount).toFixed(2)),
      cu: 'INR',
      tr: refId,
      tn: `ToingFee ${refId}`,
    });
    const upiUri = `upi://pay?${params.toString().replace('%40', '@')}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(upiUri)}`;
    return { upiUri, qrUrl };
  },

  async fetchTransactions(days = 2) {
    const { merchantId, token, proxyUrl } = this.getConfig();
    if (!merchantId || !token) {
      return { success: false, error: 'BharatPe merchant credentials not configured', transactions: [] };
    }
    const now = Date.now();
    const sDate = new Date(now - days * 86400000).toISOString().slice(0, 10);
    const eDate = new Date(now + 86400000).toISOString().slice(0, 10);

    try {
      const axiosCfg = {
        params: {
          module: 'PAYMENT_QR',
          merchantId,
          sDate,
          eDate,
        },
        headers: {
          token,
          accept: 'application/json, text/plain, */*',
          origin: 'https://enterprise.bharatpe.in',
          referer: 'https://enterprise.bharatpe.in/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      };
      if (proxyUrl) {
        axiosCfg.httpsAgent = createProxyAgent(proxyUrl);
        axiosCfg.proxy = false;
      }
      const response = await axios.get('https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions', axiosCfg);

      const txns = response.data?.data?.transactions || [];
      return {
        success: Boolean(response.data?.status),
        transactions: txns,
      };
    } catch (err) {
      console.error('[BharatPe API Error]:', err.response?.status, err.response?.data || err.message);
      return {
        success: false,
        error: err.response?.data?.message || `BharatPe API ${err.response?.status || ''} ${err.message}`.trim(),
        transactions: [],
      };
    }
  },
};

module.exports = BharatPeService;
