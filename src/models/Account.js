const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: String,
      required: true,
      index: true,
      default: 'default',
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    tid: {
      type: String,
      default: '',
    },
    token: {
      type: String,
      default: '',
    },
    userId: {
      type: String,
      default: '',
    },
    userName: {
      type: String,
      default: 'Toing User',
    },
    email: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    claimedReferral: {
      type: Boolean,
      default: false,
    },
    addresses: {
      type: Array,
      default: [],
    },
    selectedAddressId: {
      type: String,
      default: '',
    },
    rawSession: {
      type: Object,
      default: {},
    },
    lastLogin: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

accountSchema.index({ telegramUserId: 1, phone: 1 }, { unique: true });

let MongooseAccountModel;
try {
  MongooseAccountModel = mongoose.model('Account', accountSchema);
} catch (e) {
  MongooseAccountModel = mongoose.models.Account;
}

// Drop legacy global unique phone index if it exists so multiple Telegram users can add accounts independently
if (MongooseAccountModel && MongooseAccountModel.collection) {
  MongooseAccountModel.collection.dropIndex('phone_1').catch(() => {});
}

// In-memory cache only if MongoDB is still connecting (zero disk files)
const memAccounts = new Map();

const normTgId = (tgUserId) => String(tgUserId || 'default').trim() || 'default';

const AccountRepo = {
  async getAll(tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.find({ telegramUserId: uid }).sort({ updatedAt: -1 });
    }
    return Array.from(memAccounts.values()).filter((a) => normTgId(a.telegramUserId) === uid);
  },

  async getActive(tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      let active = await MongooseAccountModel.findOne({ telegramUserId: uid, isActive: true });
      if (!active) {
        active = await MongooseAccountModel.findOne({ telegramUserId: uid }).sort({ updatedAt: -1 });
      }
      return active;
    }
    const list = Array.from(memAccounts.values()).filter((a) => normTgId(a.telegramUserId) === uid);
    return list.find((a) => a.isActive) || list[0] || null;
  },

  async findByPhone(phone, tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.findOne({ telegramUserId: uid, phone });
    }
    return memAccounts.get(`${uid}:${phone}`) || null;
  },

  async findById(id, tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.findOne({ _id: id, telegramUserId: uid });
    }
    for (const acc of memAccounts.values()) {
      if (normTgId(acc.telegramUserId) === uid && (acc._id === id || acc.phone === id)) return acc;
    }
    return null;
  },

  async saveOrUpdate(accountData) {
    const uid = normTgId(accountData.telegramUserId);
    const payload = { ...accountData, telegramUserId: uid };
    if (mongoose.connection.readyState === 1) {
      if (payload.isActive) {
        await MongooseAccountModel.updateMany({ telegramUserId: uid }, { isActive: false });
      }
      const existing = await MongooseAccountModel.findOne({ telegramUserId: uid, phone: payload.phone });
      if (existing) {
        Object.assign(existing, payload);
        existing.lastLogin = new Date();
        return await existing.save();
      }
      return await MongooseAccountModel.create(payload);
    }

    if (payload.isActive) {
      for (const a of memAccounts.values()) {
        if (normTgId(a.telegramUserId) === uid) a.isActive = false;
      }
    }
    const saved = {
      _id: 'acc_' + Date.now(),
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    memAccounts.set(`${uid}:${payload.phone}`, saved);
    return saved;
  },

  async setActive(id, tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      await MongooseAccountModel.updateMany({ telegramUserId: uid }, { isActive: false });
      const acc = await MongooseAccountModel.findOne({ _id: id, telegramUserId: uid });
      if (acc) {
        acc.isActive = true;
        await acc.save();
      }
      return acc;
    }

    let target = null;
    for (const a of memAccounts.values()) {
      if (normTgId(a.telegramUserId) !== uid) continue;
      if (a._id === id || a.phone === id) {
        a.isActive = true;
        target = a;
      } else {
        a.isActive = false;
      }
    }
    return target;
  },

  async delete(id, tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.findOneAndDelete({ _id: id, telegramUserId: uid });
    }
    for (const [key, acc] of memAccounts.entries()) {
      if (normTgId(acc.telegramUserId) === uid && (acc._id === id || acc.phone === id)) {
        memAccounts.delete(key);
        return true;
      }
    }
    return false;
  },

  async toggleUsed(id, tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findOne({ _id: id, telegramUserId: uid });
      if (acc) {
        acc.isUsed = !acc.isUsed;
        return await acc.save();
      }
      return null;
    }
    for (const acc of memAccounts.values()) {
      if (normTgId(acc.telegramUserId) === uid && (acc._id === id || acc.phone === id)) {
        acc.isUsed = !acc.isUsed;
        return acc;
      }
    }
    return null;
  },

  async deleteAll(tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.deleteMany({ telegramUserId: uid });
    }
    for (const [key, acc] of memAccounts.entries()) {
      if (normTgId(acc.telegramUserId) === uid) memAccounts.delete(key);
    }
    return true;
  },

  async addAddress(accountId, addressObj) {
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(accountId);
      if (acc) {
        acc.addresses.push(addressObj);
        if (!acc.selectedAddressId) {
          acc.selectedAddressId = addressObj.id;
        }
        await acc.save();
        return acc;
      }
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === accountId || acc.phone === accountId) {
        if (!acc.addresses) acc.addresses = [];
        acc.addresses.push(addressObj);
        if (!acc.selectedAddressId) acc.selectedAddressId = addressObj.id;
        return acc;
      }
    }
    return null;
  },

  async deleteAddress(accountId, addressId) {
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(accountId);
      if (acc) {
        acc.addresses = acc.addresses.filter((addr) => (addr.id || addr._id) !== addressId);
        if (acc.selectedAddressId === addressId) {
          acc.selectedAddressId = acc.addresses[0]?.id || '';
        }
        await acc.save();
        return acc;
      }
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === accountId || acc.phone === accountId) {
        if (acc.addresses) {
          acc.addresses = acc.addresses.filter((addr) => (addr.id || addr._id) !== addressId);
          if (acc.selectedAddressId === addressId) {
            acc.selectedAddressId = acc.addresses[0]?.id || '';
          }
        }
        return acc;
      }
    }
    return null;
  },

  async setSelectedAddress(accountId, addressId) {
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(accountId);
      if (acc) {
        acc.selectedAddressId = addressId;
        await acc.save();
        return acc;
      }
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === accountId || acc.phone === accountId) {
        acc.selectedAddressId = addressId;
        return acc;
      }
    }
    return null;
  },
};

module.exports = { Account: MongooseAccountModel, AccountRepo };
