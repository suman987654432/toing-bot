const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDeposited: {
      type: Number,
      default: 0,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const walletTxnSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['CREDIT', 'DEBIT'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    utr: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    orderId: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

let WalletModel;
let WalletTxnModel;
try {
  WalletModel = mongoose.model('Wallet', walletSchema);
} catch (e) {
  WalletModel = mongoose.models.Wallet;
}
try {
  WalletTxnModel = mongoose.model('WalletTransaction', walletTxnSchema);
} catch (e) {
  WalletTxnModel = mongoose.models.WalletTransaction;
}

// In-memory fallback if MongoDB is disconnected
const memWallets = new Map();
const memTxns = [];
const claimedUtrs = new Set();

const normUid = (tgUserId) => String(tgUserId || 'default').trim() || 'default';

const WalletRepo = {
  async getWallet(tgUserId) {
    const uid = normUid(tgUserId);
    if (mongoose.connection.readyState === 1) {
      let w = await WalletModel.findOne({ telegramUserId: uid });
      if (!w) {
        w = await WalletModel.create({ telegramUserId: uid, balance: 0 });
      }
      return w;
    }
    if (!memWallets.has(uid)) {
      memWallets.set(uid, { telegramUserId: uid, balance: 0, totalDeposited: 0, totalOrders: 0 });
    }
    return memWallets.get(uid);
  },

  async getTransactions(tgUserId, limit = 20) {
    const uid = normUid(tgUserId);
    if (mongoose.connection.readyState === 1) {
      return await WalletTxnModel.find({ telegramUserId: uid }).sort({ createdAt: -1 }).limit(limit);
    }
    return memTxns.filter((t) => t.telegramUserId === uid).slice(0, limit);
  },

  async isUtrClaimed(utr) {
    const cleanUtr = String(utr || '').trim();
    if (!cleanUtr) return false;
    if (mongoose.connection.readyState === 1) {
      const exists = await WalletTxnModel.findOne({ utr: cleanUtr });
      return Boolean(exists);
    }
    return claimedUtrs.has(cleanUtr);
  },

  async creditByUtr(tgUserId, amount, utr, description = 'BharatPe Wallet Recharge') {
    const uid = normUid(tgUserId);
    const amt = Number(amount || 0);
    const cleanUtr = String(utr || '').trim();
    if (amt <= 0 || !cleanUtr) {
      return { success: false, error: 'Invalid amount or UTR' };
    }

    if (mongoose.connection.readyState === 1) {
      try {
        await WalletTxnModel.create({
          telegramUserId: uid,
          type: 'CREDIT',
          amount: amt,
          utr: cleanUtr,
          description,
        });
      } catch (err) {
        if (err && err.code === 11000) {
          return { success: false, error: 'This payment (UTR) has already been claimed.' };
        }
        throw err;
      }

      const wallet = await WalletModel.findOneAndUpdate(
        { telegramUserId: uid },
        { $inc: { balance: amt, totalDeposited: amt } },
        { new: true, upsert: true }
      );
      return { success: true, balance: wallet.balance };
    }

    if (claimedUtrs.has(cleanUtr)) {
      return { success: false, error: 'This payment (UTR) has already been claimed.' };
    }
    claimedUtrs.add(cleanUtr);
    const w = await this.getWallet(uid);
    w.balance += amt;
    w.totalDeposited += amt;
    memTxns.unshift({
      telegramUserId: uid,
      type: 'CREDIT',
      amount: amt,
      utr: cleanUtr,
      description,
      createdAt: new Date().toISOString(),
    });
    return { success: true, balance: w.balance };
  },

  async deductOrderFee(tgUserId, fee = 3, orderId = '') {
    const uid = normUid(tgUserId);
    const amt = Math.max(0, Number(fee ?? 3));

    if (mongoose.connection.readyState === 1) {
      if (orderId) {
        const existing = await WalletTxnModel.findOne({ orderId: String(orderId), type: 'DEBIT' });
        if (existing) {
          const w = await this.getWallet(uid);
          return { success: true, balance: w.balance, alreadyCharged: true };
        }
      }
      const query = amt > 0 ? { telegramUserId: uid, balance: { $gte: amt } } : { telegramUserId: uid };
      const updated = await WalletModel.findOneAndUpdate(
        query,
        { $inc: { balance: -amt, totalOrders: 1 } },
        { new: true, upsert: amt === 0 }
      );
      if (!updated) {
        return { success: false, error: 'Insufficient wallet balance' };
      }
      if (amt > 0) {
        await WalletTxnModel.create({
          telegramUserId: uid,
          type: 'DEBIT',
          amount: amt,
          orderId: String(orderId || ''),
          description: orderId ? `Order Fee (#${orderId})` : 'Order Fee',
        });
      }
      return { success: true, balance: updated.balance };
    }

    const w = await this.getWallet(uid);
    if (w.balance < amt) {
      return { success: false, error: 'Insufficient wallet balance' };
    }
    w.balance -= amt;
    w.totalOrders += 1;
    memTxns.unshift({
      telegramUserId: uid,
      type: 'DEBIT',
      amount: amt,
      orderId: String(orderId || ''),
      description: orderId ? `Order Fee (#${orderId})` : 'Order Fee',
      createdAt: new Date().toISOString(),
    });
    return { success: true, balance: w.balance };
  },

  async refundOrderFee(tgUserId, fee = 3, reason = 'Order Failed Refund') {
    const uid = normUid(tgUserId);
    const amt = Number(fee || 3);

    if (mongoose.connection.readyState === 1) {
      const updated = await WalletModel.findOneAndUpdate(
        { telegramUserId: uid },
        { $inc: { balance: amt, totalOrders: -1 } },
        { new: true }
      );
      await WalletTxnModel.create({
        telegramUserId: uid,
        type: 'CREDIT',
        amount: amt,
        description: reason,
      });
      return { success: true, balance: updated?.balance || 0 };
    }

    const w = await this.getWallet(uid);
    w.balance += amt;
    memTxns.unshift({
      telegramUserId: uid,
      type: 'CREDIT',
      amount: amt,
      description: reason,
      createdAt: new Date().toISOString(),
    });
    return { success: true, balance: w.balance };
  },

  async adminAdjustBalance(tgUserId, delta, reason = '') {
    const uid = normUid(tgUserId);
    const num = Math.round(Number(delta || 0) * 100) / 100;
    if (!uid || !num || isNaN(num)) {
      return { success: false, error: 'Invalid user ID or amount' };
    }

    const isCredit = num > 0;
    const absAmt = Math.abs(num);
    const desc = reason || (isCredit ? 'Admin Wallet Credit' : 'Admin Wallet Debit');

    if (mongoose.connection.readyState === 1) {
      const current = await this.getWallet(uid);
      const curBal = Number(current.balance || 0);
      const actualDelta = isCredit ? absAmt : -Math.min(curBal, absAmt);
      const nextBal = Math.round((curBal + actualDelta) * 100) / 100;

      await WalletModel.findOneAndUpdate(
        { telegramUserId: uid },
        { $set: { balance: nextBal } },
        { new: true, upsert: true }
      );
      await WalletTxnModel.create({
        telegramUserId: uid,
        type: isCredit ? 'CREDIT' : 'DEBIT',
        amount: Math.abs(actualDelta),
        description: desc,
      });
      return { success: true, balance: nextBal, adjusted: actualDelta };
    }

    const w = await this.getWallet(uid);
    const curBal = Number(w.balance || 0);
    const actualDelta = isCredit ? absAmt : -Math.min(curBal, absAmt);
    w.balance = Math.round((curBal + actualDelta) * 100) / 100;
    memTxns.unshift({
      telegramUserId: uid,
      type: isCredit ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(actualDelta),
      description: desc,
      createdAt: new Date().toISOString(),
    });
    return { success: true, balance: w.balance, adjusted: actualDelta };
  },

  async listUsers(page = 1, limit = 6) {
    const p = Math.max(1, Number(page || 1));
    const lim = Math.max(1, Number(limit || 6));

    if (mongoose.connection.readyState === 1) {
      const [totalUsers, users, agg] = await Promise.all([
        WalletModel.countDocuments({}),
        WalletModel.find({}).sort({ updatedAt: -1 }).skip((p - 1) * lim).limit(lim).lean(),
        WalletModel.aggregate([
          {
            $group: {
              _id: null,
              totalBalance: { $sum: '$balance' },
              totalOrders: { $sum: '$totalOrders' },
            },
          },
        ]),
      ]);
      const totals = agg?.[0] || { totalBalance: 0, totalOrders: 0 };
      return {
        users,
        totalUsers,
        totalBalance: Math.round(Number(totals.totalBalance || 0) * 100) / 100,
        totalOrders: Number(totals.totalOrders || 0),
        page: p,
        totalPages: Math.max(1, Math.ceil(totalUsers / lim)),
      };
    }

    const all = Array.from(memWallets.values());
    const totalUsers = all.length;
    const totalBalance = Math.round(all.reduce((s, u) => s + Number(u.balance || 0), 0) * 100) / 100;
    const totalOrders = all.reduce((s, u) => s + Number(u.totalOrders || 0), 0);
    const users = all.slice((p - 1) * lim, p * lim);
    return {
      users,
      totalUsers,
      totalBalance,
      totalOrders,
      page: p,
      totalPages: Math.max(1, Math.ceil(totalUsers / lim)),
    };
  },

  async getUserReport(tgUserId) {
    const uid = normUid(tgUserId);
    const [wallet, txns] = await Promise.all([
      this.getWallet(uid),
      this.getTransactions(uid, 50),
    ]);
    const list = (txns || []).map((t) => (t.toObject ? t.toObject() : t));
    const deposits = list.filter((t) => t.type === 'CREDIT');
    const debits = list.filter((t) => t.type === 'DEBIT');
    const totalSpent = Math.round(debits.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100;
    const totalDeposited = Math.max(
      Number(wallet?.totalDeposited || 0),
      Math.round(deposits.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100
    );
    return {
      telegramUserId: uid,
      balance: Number(wallet?.balance || 0),
      totalDeposited,
      totalSpent,
      totalOrders: Number(wallet?.totalOrders || 0),
      deposits,
      debits,
    };
  },
};

module.exports = { Wallet: WalletModel, WalletTransaction: WalletTxnModel, WalletRepo };
