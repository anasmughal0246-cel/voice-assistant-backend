const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const Conversation = require('../models/Conversation');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL = 'openai/gpt-oss-20b';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_HISTORY_MESSAGES = 10;

router.post('/chat', async (req, res) => {
  try {
    const { userId, message, image, pdfBase64, pdfName } = req.body;
    if (!userId || (!message && !image && !pdfBase64)) {
      return res.status(400).json({ error: 'userId and message are required' });
    }
    let convo = await Conversation.findOne({ userId });
    if (!convo) convo = new Conversation({ userId, messages: [] });
    const userLabel = pdfBase64 ? (message || `[PDF: ${pdfName || 'document'}]`) : (message || '[Image sent]');
    convo.messages.push({ role: 'user', text: userLabel });
    const recentMessages = convo.messages.slice(-(MAX_HISTORY_MESSAGES + 1), -1);
    const priorHistory = recentMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    }));
    let currentContent;
    let modelToUse = TEXT_MODEL;

    if (pdfBase64) {
      const base64Data = pdfBase64.split(',')[1] || pdfBase64;
      const buffer = Buffer.from(base64Data, 'base64');
      let parsed;
      try {
        const pdfParse = require('pdf-parse');
        parsed = await pdfParse(buffer);
      } catch (pdfErr) {
        console.error('PDF parse failed:', pdfErr);
        convo.messages.push({ role: 'assistant', text: 'Sorry, I could not read this PDF. It may be a scanned or corrupted file. Please try a different one.' });
        await convo.save();
        return res.json({ reply: 'Sorry, I could not read this PDF. It may be a scanned or corrupted file. Please try a different one.' });
      }
      let pdfText = parsed.text || '';
      if (pdfText.trim().length < 20) {
        currentContent = `The user uploaded a PDF named "${pdfName || 'document.pdf'}" but no readable text could be extracted from it — it is likely a scanned document or image-based PDF. Politely tell the user that this PDF appears to be scanned/image-based and text couldn't be extracted, and suggest they try a text-based PDF instead.`;
      } else {
        if (pdfText.length > 15000) pdfText = pdfText.slice(0, 15000) + '\n...[truncated]';
        currentContent = `The user uploaded a PDF document named "${pdfName || 'document.pdf'}". Here is its extracted content:\n\n${pdfText}\n\nUser's question about this document: ${message || 'Summarize this document.'}`;
      }
      modelToUse = TEXT_MODEL;
    } else if (image) {
      currentContent = [
        { type: 'text', text: message || 'What is in this image?' },
        { type: 'image_url', image_url: { url: image } }
      ];
      modelToUse = VISION_MODEL;
    } else {
      currentContent = message;
    }

    const completion = await groq.chat.completions.create({
      messages: [...priorHistory, { role: 'user', content: currentContent }],
      model: modelToUse,
      max_completion_tokens: 600
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
