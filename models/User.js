const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  name: { type: String, default: 'Guest' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);