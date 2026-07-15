const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');

// GET /api/conversations?userId=xxx  -> sidebar list (sirf id, title, date -- messages nahi, taake fast rahe)
router.get('/conversations', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const conversations = await Conversation.find({ userId })
      .select('_id title createdAt updatedAt')
      .sort({ updatedAt: -1 }); // sabse recent chat sabse upar

    res.json({ conversations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// GET /api/conversations/:id?userId=xxx  -> ek specific chat khol na (poori messages ke sath)
router.get('/conversations/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    const convo = await Conversation.findOne({ _id: req.params.id, userId });
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    res.json({ conversation: convo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// DELETE /api/conversations/:id?userId=xxx
router.delete('/conversations/:id', async (req, res) => {
  try {
    const { userId } = req.query;
    const result = await Conversation.findOneAndDelete({ _id: req.params.id, userId });
    if (!result) return res.status(404).json({ error: 'Conversation not found' });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

module.exports = router;