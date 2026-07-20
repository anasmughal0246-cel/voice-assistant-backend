const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/suggestions', async (req, res) => {
  try {
    const { userMessage, assistantMessage } = req.body;
    if (!assistantMessage) return res.json({ suggestions: [] });

    const prompt = `Based on this exchange:\nUser: ${userMessage || ''}\nAssistant: ${assistantMessage}\n\nSuggest exactly 3 short, natural follow-up questions or requests the user might want to ask next. Each under 8 words. Respond with ONLY a JSON array of 3 strings, nothing else.`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'openai/gpt-oss-120b',
      max_completion_tokens: 150
    });

    let text = completion.choices?.[0]?.message?.content || '[]';
    text = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    let suggestions = [];
    try {
      suggestions = JSON.parse(text);
      if (!Array.isArray(suggestions)) suggestions = [];
    } catch (e) {
      suggestions = [];
    }
    res.json({ suggestions: suggestions.slice(0, 3) });
  } catch (err) {
    console.error('Suggestions error:', err.message);
    res.json({ suggestions: [] });
  }
});

module.exports = router;