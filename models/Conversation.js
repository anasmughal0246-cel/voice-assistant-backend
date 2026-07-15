const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const conversationSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  title: { type: String, default: 'New Chat' },
  messages: [messageSchema]
}, { timestamps: true }); // adds createdAt aur updatedAt automatically

module.exports = mongoose.model('Conversation', conversationSchema);