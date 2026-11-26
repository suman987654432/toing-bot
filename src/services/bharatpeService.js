const axios = require('axios');

const BharatPeService = {
  getConfig() {
    return {
      merchantId: process.env.BHARATPE_MERCHANT_ID || '',
      token: process.env.BHARATPE_TOKEN || '',
      upiId: process.env.BHARATPE_UPI_ID || '',
      merchantName: process.env.BHARATPE_MERCHANT_NAME || 'Toing Pro',
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
    const { merchantId, token } = this.getConfig();
    if (!merchantId || !token) {
      return { success: false, error: 'BharatPe merchant credentials not configured', transactions: [] };
    }
    const now = Date.now();
    const sDate = new Date(now - days * 86400000).toISOString().slice(0, 10);
    const eDate = new Date(now + 86400000).toISOString().slice(0, 10);

    try {
      const response = await axios.get('https://payments-tesseract.bharatpe.in/api/v1/merchant/transactions', {
        params: {
          module: 'PAYMENT_QR',
          merchantId,
          sDate,
          eDate,
        },
        headers: {
          token,
          'user-agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      });

      const txns = response.data?.data?.transactions || [];
      return {
        success: Boolean(response.data?.status),
        transactions: txns,
      };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
        transactions: [],
      };
    }
  },
};

module.exports = BharatPeService;
