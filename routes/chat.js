const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const Conversation = require('../models/Conversation');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/chat', async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: 'userId and message are required' });
    }
    let convo = await Conversation.findOne({ userId });
    if (!convo) convo = new Conversation({ userId, messages: [] });
    convo.messages.push({ role: 'user', text: message });

    const history = convo.messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    }));

    const completion = await groq.chat.completions.create({
      messages: history,
      model: 'llama-3.3-70b-versatile'
    });

    const reply = completion.choices[0].message.content;
    convo.messages.push({ role: 'assistant', text: reply });
    await convo.save();
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

router.get('/history/:userId', async (req, res) => {
  try {
    const convo = await Conversation.findOne({ userId: req.params.userId });
    res.json({ messages: convo ? convo.messages : [] });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});

module.exports = router;
