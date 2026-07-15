const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { requireAdmin } = require('../middleware/authMiddleware');

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/conversations/:userId', requireAdmin, async (req, res) => {
  try {
    const convo = await Conversation.findOne({ userId: req.params.userId });
    res.json({ messages: convo ? convo.messages : [] });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

module.exports = router;