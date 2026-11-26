const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'app_config',
    },
    orderFee: {
      type: Number,
      default: 3,
      min: 0,
    },
    minDeposit: {
      type: Number,
      default: 15,
      min: 1,
    },
    forceJoinEnabled: {
      type: Boolean,
      default: false,
    },
    forceJoinChannel: {
      type: String,
      default: '',
      trim: true,
    },
    forceJoinUrl: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

let SettingsModel;
try {
  SettingsModel = mongoose.model('Settings', settingsSchema);
} catch (e) {
  SettingsModel = mongoose.models.Settings;
}

let memSettings = {
  key: 'app_config',
  orderFee: 3,
  minDeposit: 15,
  forceJoinEnabled: false,
  forceJoinChannel: '',
  forceJoinUrl: '',
};

const formatSettings = (doc) => ({
  orderFee: Number(doc?.orderFee ?? 3),
  minDeposit: Number(doc?.minDeposit ?? 15),
  forceJoinEnabled: Boolean(doc?.forceJoinEnabled),
  forceJoinChannel: String(doc?.forceJoinChannel || ''),
  forceJoinUrl: String(doc?.forceJoinUrl || ''),
});

const SettingsRepo = {
  async get() {
    if (mongoose.connection.readyState === 1) {
      let doc = await SettingsModel.findOne({ key: 'app_config' });
      if (!doc) {
        doc = await SettingsModel.create({ key: 'app_config', orderFee: 3, minDeposit: 15 });
      }
      return formatSettings(doc);
    }
    return formatSettings(memSettings);
  },

  async update({ orderFee, minDeposit, forceJoinEnabled, forceJoinChannel, forceJoinUrl }) {
    const patch = {};
    if (orderFee !== undefined && !isNaN(Number(orderFee)) && Number(orderFee) >= 0) {
      patch.orderFee = Math.round(Number(orderFee) * 100) / 100;
    }
    if (minDeposit !== undefined && !isNaN(Number(minDeposit)) && Number(minDeposit) >= 1) {
      patch.minDeposit = Math.round(Number(minDeposit));
    }
    if (forceJoinEnabled !== undefined) {
      patch.forceJoinEnabled = Boolean(forceJoinEnabled);
    }
    if (forceJoinChannel !== undefined) {
      patch.forceJoinChannel = String(forceJoinChannel).trim();
    }
    if (forceJoinUrl !== undefined) {
      patch.forceJoinUrl = String(forceJoinUrl).trim();
    }

    if (mongoose.connection.readyState === 1) {
      const updated = await SettingsModel.findOneAndUpdate(
        { key: 'app_config' },
        { $set: patch },
        { returnDocument: 'after', upsert: true }
      );
      return formatSettings(updated);
    }
    memSettings = { ...memSettings, ...patch };
    return formatSettings(memSettings);
  },
};

const isAdminUser = (tgUserId) => {
  const uid = String(tgUserId || '').trim();
  if (!uid) return false;
  const raw = process.env.ADMIN_TG_IDS || '5239857570';
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(uid);
};

module.exports = { Settings: SettingsModel, SettingsRepo, isAdminUser };
