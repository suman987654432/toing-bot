const axios = require('axios');
const http = require('http');
const https = require('https');
const tls = require('tls');

function createProxyAgent(proxyUrl, rejectUnauthorized = true) {
  const p = new URL(proxyUrl);
  const agent = new https.Agent({ keepAlive: false, rejectUnauthorized });
  agent.createConnection = (options, cb) => {
    const targetPort = options.port || 443;
    const headers = { Host: `${options.host}:${targetPort}` };
    if (p.username || p.password) {
      headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password)}`).toString('base64');
    }
    const transport = p.protocol === 'https:' ? https : http;
    const req = transport.request({
      host: p.hostname,
      port: Number(p.port || (p.protocol === 'https:' ? 443 : 80)),
      method: 'CONNECT',
      path: `${options.host}:${targetPort}`,
      headers,
      ...(p.protocol === 'https:' ? { rejectUnauthorized } : {}),
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return cb(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      }
      const tlsSocket = tls.connect({
        socket,
        servername: options.servername || options.host,
        rejectUnauthorized,
      });
      cb(null, tlsSocket);
    });
    req.on('error', (err) => cb(err));
    req.end();
  };
  return agent;
}

function isTlsCertError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return /SELF_SIGNED_CERT|UNABLE_TO_VERIFY|CERT_/i.test(code) || /self-signed certificate|certificate chain|unable to verify/i.test(msg);
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
    if (!upiId) return { upiUri: '', qrUrl: '', upiId: '' };
    const amt = Number(amount).toFixed(2);
    const pn = encodeURIComponent(String(merchantName || 'Toing Pro').trim());
    const tn = encodeURIComponent(`Deposit ${refId}`);
    // Pre-fill exact amount in QR so scanning automatically fills ₹amount (omit unsigned tr= to avoid UPI app rejections)
    const upiUri = `upi://pay?pa=${upiId}&pn=${pn}&am=${amt}&cu=INR&tn=${tn}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(upiUri)}`;
    return { upiUri, qrUrl, upiId };
  },

  async fetchTransactions(days = 2) {
    const { merchantId, token, proxyUrl } = this.getConfig();
    if (!merchantId || !token) {
      return { success: false, error: 'BharatPe merchant credentials not configured', transactions: [] };
    }
    const now = Date.now();
    const sDate = new Date(now - days * 86400000).toISOString().slice(0, 10);
    const eDate = new Date(now + 86400000).toISOString().slice(0, 10);

    const url = 'https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions';
    const baseCfg = {
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

    const requestWithMode = async (useProxy, rejectUnauthorized) => {
      const cfg = { ...baseCfg };
      if (useProxy && proxyUrl) {
        cfg.httpsAgent = createProxyAgent(proxyUrl, rejectUnauthorized);
        cfg.proxy = false;
      } else if (!rejectUnauthorized) {
        cfg.httpsAgent = new https.Agent({ keepAlive: false, rejectUnauthorized: false });
      }
      const response = await axios.get(url, cfg);
      return {
        success: Boolean(response.data?.status),
        transactions: response.data?.data?.transactions || [],
      };
    };

    try {
      return await requestWithMode(Boolean(proxyUrl), true);
    } catch (err) {
      // If a proxy/network injects a self-signed cert in the chain, retry with relaxed TLS on BharatPe socket only
      if (isTlsCertError(err)) {
        console.warn('[BharatPe TLS Cert Error]:', err.message, '— retrying with relaxed TLS...');
        try {
          return await requestWithMode(Boolean(proxyUrl), false);
        } catch (tlsRetryErr) {
          if (proxyUrl && !tlsRetryErr.response) {
            try {
              return await requestWithMode(false, false);
            } catch (directErr) {
              console.error('[BharatPe Direct TLS Fallback Error]:', directErr.response?.status, directErr.response?.data || directErr.message);
            }
          }
          err = tlsRetryErr;
        }
      }
      // Residential proxies can occasionally hit a bad exit node (502/ECONNRESET); retry proxy once, then direct
      if (proxyUrl && !err.response) {
        console.warn('[BharatPe Proxy Failed]:', err.message, '— retrying proxy once...');
        try {
          return await requestWithMode(true, true);
        } catch (proxyRetryErr) {
          console.warn('[BharatPe Proxy Retry Failed]:', proxyRetryErr.message, '— retrying direct...');
          try {
            return await requestWithMode(false, true);
          } catch (directErr) {
            if (isTlsCertError(directErr)) {
              try {
                return await requestWithMode(false, false);
              } catch (directTlsErr) {
                console.error('[BharatPe Direct TLS Error]:', directTlsErr.response?.status, directTlsErr.response?.data || directTlsErr.message);
              }
            }
            console.error('[BharatPe Direct Fallback Error]:', directErr.response?.status, directErr.response?.data || directErr.message);
          }
        }
      }
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
