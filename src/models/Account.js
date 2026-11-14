const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
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

let MongooseAccountModel;
try {
  MongooseAccountModel = mongoose.model('Account', accountSchema);
} catch (e) {
  MongooseAccountModel = mongoose.models.Account;
}

// In-memory cache only if MongoDB is still connecting (zero disk files)
const memAccounts = new Map();

const AccountRepo = {
  async getAll() {
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.find({}).sort({ updatedAt: -1 });
    }
    return Array.from(memAccounts.values());
  },

  async getActive() {
    if (mongoose.connection.readyState === 1) {
      let active = await MongooseAccountModel.findOne({ isActive: true });
      if (!active) {
        active = await MongooseAccountModel.findOne({}).sort({ updatedAt: -1 });
      }
      return active;
    }
    const list = Array.from(memAccounts.values());
    return list.find((a) => a.isActive) || list[0] || null;
  },

  async findByPhone(phone) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.findOne({ phone });
    }
    return memAccounts.get(phone) || null;
  },

  async findById(id) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.findById(id);
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === id || acc.phone === id) return acc;
    }
    return null;
  },

  async saveOrUpdate(accountData) {
    if (mongoose.connection.readyState === 1) {
      if (accountData.isActive) {
        await MongooseAccountModel.updateMany({}, { isActive: false });
      }
      const existing = await MongooseAccountModel.findOne({ phone: accountData.phone });
      if (existing) {
        Object.assign(existing, accountData);
        existing.lastLogin = new Date();
        return await existing.save();
      }
      return await MongooseAccountModel.create(accountData);
    }

    if (accountData.isActive) {
      for (const a of memAccounts.values()) a.isActive = false;
    }
    const saved = {
      _id: 'acc_' + Date.now(),
      ...accountData,
      updatedAt: new Date().toISOString(),
    };
    memAccounts.set(accountData.phone, saved);
    return saved;
  },

  async setActive(id) {
    if (mongoose.connection.readyState === 1) {
      await MongooseAccountModel.updateMany({}, { isActive: false });
      const acc = await MongooseAccountModel.findById(id);
      if (acc) {
        acc.isActive = true;
        await acc.save();
      }
      return acc;
    }

    let target = null;
    for (const a of memAccounts.values()) {
      if (a._id === id || a.phone === id) {
        a.isActive = true;
        target = a;
      } else {
        a.isActive = false;
      }
    }
    return target;
  },

  async delete(id) {
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.findByIdAndDelete(id);
    }
    for (const [phone, acc] of memAccounts.entries()) {
      if (acc._id === id || acc.phone === id) {
        memAccounts.delete(phone);
        return true;
      }
    }
    return false;
  },

  async toggleUsed(id) {
    if (mongoose.connection.readyState === 1) {
      const acc = await MongooseAccountModel.findById(id);
      if (acc) {
        acc.isUsed = !acc.isUsed;
        return await acc.save();
      }
      return null;
    }
    for (const acc of memAccounts.values()) {
      if (acc._id === id || acc.phone === id) {
        acc.isUsed = !acc.isUsed;
        return acc;
      }
    }
    return null;
  },

  async deleteAll() {
    if (mongoose.connection.readyState === 1) {
      return await MongooseAccountModel.deleteMany({});
    }
    memAccounts.clear();
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
