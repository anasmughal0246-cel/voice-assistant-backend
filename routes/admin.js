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

router.get('/users/:userId/conversations', requireAdmin, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.params.userId })
      .select('_id title createdAt updatedAt')
      .sort({ updatedAt: -1 });
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/conversation/:id', requireAdmin, async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation: convo });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

module.exports = router;