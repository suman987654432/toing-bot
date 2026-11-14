const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;

  if (!uri || uri.trim() === '') {
    console.log('[MongoDB] Notice: MONGODB_URI is not set in .env. Running with local fallback in-memory cache.');
    return false;
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`[MongoDB] Atlas Connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`[MongoDB] Connection error: ${error.message}`);
    console.log('[MongoDB] Running with local fallback cache until Atlas URI is configured.');
    return false;
  }
};

const getStatus = () => isConnected;

module.exports = { connectDB, getStatus };

