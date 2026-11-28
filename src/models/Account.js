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

// Persistent per-user saved addresses (survives account logout / deletion, subject to 2-hour cleanup)
const userAddressSchema = new mongoose.Schema(
  {
    telegramUserId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    addresses: {
      type: Array,
      default: [],
    },
    selectedAddressId: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

let MongooseUserAddressModel;
try {
  MongooseUserAddressModel = mongoose.model('UserAddress', userAddressSchema);
} catch (e) {
  MongooseUserAddressModel = mongoose.models.UserAddress;
}

// In-memory cache only if MongoDB is still connecting (zero disk files)
const memAccounts = new Map();
const memUserAddresses = new Map();

const normTgId = (tgUserId) => String(tgUserId || 'default').trim() || 'default';

const addrDedupKey = (a) => {
  if (!a) return '';
  if (a.id) return `id:${String(a.id)}`;
  const lat = a.lat ? Number(a.lat).toFixed(4) : '';
  const lng = a.lng ? Number(a.lng).toFixed(4) : '';
  const line = String(a.address_line1 || a.address || '').trim().toLowerCase();
  return `loc:${lat},${lng},${line}`;
};

const mergeAddressLists = (primary = [], secondary = []) => {
  const out = [];
  const seenIds = new Set();
  const seenLocs = new Set();
  const push = (item) => {
    if (!item) return;
    const id = item.id ? String(item.id) : '';
    const lat = item.lat ? Number(item.lat).toFixed(4) : '';
    const lng = item.lng ? Number(item.lng).toFixed(4) : '';
    const line = String(item.address_line1 || item.address || '').trim().toLowerCase();
    const locKey = (lat && lng && line) ? `${lat},${lng},${line}` : '';
    if (id && seenIds.has(id)) return;
    if (locKey && seenLocs.has(locKey)) return;
    if (id) seenIds.add(id);
    if (locKey) seenLocs.add(locKey);
    out.push(item);
  };
  (Array.isArray(primary) ? primary : []).forEach(push);
  (Array.isArray(secondary) ? secondary : []).forEach(push);
  return out;
};

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
      const existing = await MongooseAccountModel.findOne({ _id: id, telegramUserId: uid });
      if (existing) {
        await this.preserveAccountAddresses(existing, uid);
        return await MongooseAccountModel.findOneAndDelete({ _id: id, telegramUserId: uid });
      }
      return null;
    }
    for (const [key, acc] of memAccounts.entries()) {
      if (normTgId(acc.telegramUserId) === uid && (acc._id === id || acc.phone === id)) {
        await this.preserveAccountAddresses(acc, uid);
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
      const accs = await MongooseAccountModel.find({ telegramUserId: uid });
      for (const acc of accs) {
        await this.preserveAccountAddresses(acc, uid);
      }
      return await MongooseAccountModel.deleteMany({ telegramUserId: uid });
    }
    for (const [key, acc] of memAccounts.entries()) {
      if (normTgId(acc.telegramUserId) === uid) {
        await this.preserveAccountAddresses(acc, uid);
        memAccounts.delete(key);
      }
    }
    return true;
  },

  async addAddress(accountId, addressObj) {
    if (addressObj && !addressObj.addedAt) addressObj.addedAt = Date.now();
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

  async updateAddress(accountId, addressId, updatedFields) {
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(accountId);
      if (acc) {
        acc.addresses = acc.addresses.map((addr) =>
          String(addr.id || addr._id) === String(addressId) ? { ...addr, ...updatedFields } : addr
        );
        acc.markModified('addresses');
        await acc.save();
        return acc;
      }
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === accountId || acc.phone === accountId) {
        if (acc.addresses) {
          acc.addresses = acc.addresses.map((addr) =>
            (addr.id || addr._id) === addressId ? { ...addr, ...updatedFields } : addr
          );
        }
        return acc;
      }
    }
    return null;
  },

  async deleteAddress(accountId, addressId) {
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(accountId);
      if (acc) {
        acc.addresses = acc.addresses.filter((addr) => String(addr.id || addr._id) !== String(addressId));
        if (String(acc.selectedAddressId) === String(addressId)) {
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

  async updateAddresses(accountId, addresses) {
    const list = Array.isArray(addresses) ? addresses : [];
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(accountId);
      if (acc) {
        acc.addresses = list;
        acc.markModified('addresses');
        await acc.save();
        return acc;
      }
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === accountId || acc.phone === accountId) {
        acc.addresses = list;
        return acc;
      }
    }
    return null;
  },

  async getUserAddresses(tgUserId = 'default') {
    const uid = normTgId(tgUserId);
    if (mongoose.connection.readyState === 1) {
      const doc = await MongooseUserAddressModel.findOne({ telegramUserId: uid });
      return {
        addresses: Array.isArray(doc?.addresses) ? doc.addresses : [],
        selectedAddressId: doc?.selectedAddressId || '',
      };
    }
    const mem = memUserAddresses.get(uid);
    return {
      addresses: Array.isArray(mem?.addresses) ? mem.addresses : [],
      selectedAddressId: mem?.selectedAddressId || '',
    };
  },

  async _saveUserAddressState(tgUserId, addresses, selectedAddressId) {
    const uid = normTgId(tgUserId);
    const list = Array.isArray(addresses) ? addresses : [];
    const sel = selectedAddressId || list[0]?.id || '';
    if (mongoose.connection.readyState === 1) {
      await MongooseUserAddressModel.findOneAndUpdate(
        { telegramUserId: uid },
        { $set: { telegramUserId: uid, addresses: list, selectedAddressId: sel } },
        { upsert: true, new: true }
      );
      return { addresses: list, selectedAddressId: sel };
    }
    memUserAddresses.set(uid, { addresses: list, selectedAddressId: sel });
    return { addresses: list, selectedAddressId: sel };
  },

  async preserveAccountAddresses(acc, tgUserId = 'default') {
    if (!acc) return;
    const uid = normTgId(tgUserId || acc.telegramUserId);
    const accAddrs = Array.isArray(acc.addresses) ? acc.addresses : [];
    if (accAddrs.length === 0) return;
    const cur = await this.getUserAddresses(uid);
    const merged = mergeAddressLists(cur.addresses, accAddrs);
    const sel = cur.selectedAddressId || acc.selectedAddressId || merged[0]?.id || '';
    await this._saveUserAddressState(uid, merged, sel);
  },

  async syncUserAddress(tgUserId, addrObj, makeSelected = true) {
    if (!addrObj) return;
    const uid = normTgId(tgUserId);
    const withTs = { ...addrObj, addedAt: addrObj.addedAt || Date.now() };
    const cur = await this.getUserAddresses(uid);
    const filtered = cur.addresses.filter((a) => String(a.id || a._id) !== String(withTs.id));
    const merged = mergeAddressLists([withTs], filtered);
    const sel = makeSelected ? withTs.id : (cur.selectedAddressId || withTs.id);
    return await this._saveUserAddressState(uid, merged, sel);
  },

  async updateUserAddress(tgUserId, addressId, updatedFields) {
    const uid = normTgId(tgUserId);
    const cur = await this.getUserAddresses(uid);
    let found = false;
    const next = cur.addresses.map((addr) => {
      if (String(addr.id || addr._id) === String(addressId)) {
        found = true;
        return { ...addr, ...updatedFields };
      }
      return addr;
    });
    if (!found) {
      next.unshift({ ...updatedFields, addedAt: updatedFields.addedAt || Date.now() });
    }
    const nextSel = String(cur.selectedAddressId) === String(addressId) && updatedFields.id
      ? updatedFields.id
      : cur.selectedAddressId;
    return await this._saveUserAddressState(uid, next, nextSel);
  },

  async deleteUserAddress(tgUserId, addressId) {
    const uid = normTgId(tgUserId);
    const cur = await this.getUserAddresses(uid);
    const next = cur.addresses.filter((addr) => String(addr.id || addr._id) !== String(addressId));
    const nextSel = String(cur.selectedAddressId) === String(addressId) ? (next[0]?.id || '') : cur.selectedAddressId;
    return await this._saveUserAddressState(uid, next, nextSel);
  },

  async setUserSelectedAddress(tgUserId, addressId) {
    const uid = normTgId(tgUserId);
    const cur = await this.getUserAddresses(uid);
    return await this._saveUserAddressState(uid, cur.addresses, addressId);
  },

  mergeAddressLists,

  async cleanupExpiredAddresses(maxAgeMs = 2 * 60 * 60 * 1000, onDelete = null) {
    const cutoff = Date.now() - maxAgeMs;
    let removedCount = 0;
    const processAcc = async (acc, saveFn) => {
      const list = Array.isArray(acc.addresses) ? acc.addresses : [];
      const expired = list.filter((a) => a && a.addedAt && Number(a.addedAt) <= cutoff);
      if (expired.length === 0) return;
      const expiredIds = new Set(expired.map((a) => String(a.id || a._id)));
      acc.addresses = list.filter((a) => !expiredIds.has(String(a.id || a._id)));
      if (expiredIds.has(String(acc.selectedAddressId))) {
        acc.selectedAddressId = acc.addresses[0]?.id || '';
      }
      removedCount += expired.length;
      await saveFn();
      if (typeof onDelete === 'function') {
        for (const ex of expired) {
          try { await onDelete(acc, ex); } catch (e) {}
        }
      }
    };
    const processUserDoc = async (doc, saveFn) => {
      const list = Array.isArray(doc.addresses) ? doc.addresses : [];
      const expired = list.filter((a) => a && a.addedAt && Number(a.addedAt) <= cutoff);
      if (expired.length === 0) return;
      const expiredIds = new Set(expired.map((a) => String(a.id || a._id)));
      doc.addresses = list.filter((a) => !expiredIds.has(String(a.id || a._id)));
      if (expiredIds.has(String(doc.selectedAddressId))) {
        doc.selectedAddressId = doc.addresses[0]?.id || '';
      }
      removedCount += expired.length;
      await saveFn();
    };
    if (mongoose.connection.readyState === 1) {
      const accs = await MongooseAccountModel.find({ 'addresses.0': { $exists: true } });
      for (const acc of accs) {
        await processAcc(acc, async () => {
          acc.markModified('addresses');
          await acc.save();
        });
      }
      const userDocs = await MongooseUserAddressModel.find({ 'addresses.0': { $exists: true } });
      for (const doc of userDocs) {
        await processUserDoc(doc, async () => {
          doc.markModified('addresses');
          await doc.save();
        });
      }
      return removedCount;
    }
    for (const acc of memAccounts.values()) {
      await processAcc(acc, async () => {});
    }
    for (const doc of memUserAddresses.values()) {
      await processUserDoc(doc, async () => {});
    }
    return removedCount;
  },
};

module.exports = { Account: MongooseAccountModel, AccountRepo };
