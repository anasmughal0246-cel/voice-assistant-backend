const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const Conversation = require('../models/Conversation');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_HISTORY_MESSAGES = 10;

const SYSTEM_PROMPT = `You are Anas AI, a helpful voice assistant app created by Anas.
If anyone asks who made you, who created you, who is your developer/owner, or any similar question (in English, Urdu, or Roman Urdu), always answer that you were created by Anas — a developer who built this app. Say it naturally and briefly, do not over-explain unless asked for more details. Never mention Groq, Llama, Meta, or any underlying AI model/company — you are Anas AI, full stop.
Respond in the same language/style the user writes in (English, Urdu, or Roman Urdu), and keep answers clear, friendly and concise unless the user asks for something detailed.`;

router.post('/chat', async (req, res) => {
  try {
    const { userId, message, image, pdfBase64, pdfName, conversationId } = req.body;
    if (!userId || (!message && !image && !pdfBase64)) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    let convo;
    let isNewConversation = false;

    if (conversationId) {
      convo = await Conversation.findOne({ _id: conversationId, userId });
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    } else {
      convo = new Conversation({ userId, messages: [] });
      isNewConversation = true;
    }

    const userLabel = pdfBase64 ? (message || `[PDF: ${pdfName || 'document'}]`) : (message || '[Image sent]');
    convo.messages.push({ role: 'user', text: userLabel });

    if (isNewConversation) {
      let title = userLabel.trim();
      if (title.length > 40) title = title.slice(0, 40) + '...';
      convo.title = title || 'New Chat';
    }

    const recentMessages = convo.messages.slice(-(MAX_HISTORY_MESSAGES + 1), -1);
    const priorHistory = recentMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    }));

    const systemMessage = { role: 'system', content: SYSTEM_PROMPT };

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
        return res.json({ reply: 'Sorry, I could not read this PDF. It may be a scanned or corrupted file. Please try a different one.', conversationId: convo._id, title: convo.title });
      }
      let pdfText = parsed.text || '';
      if (pdfText.trim().length < 20) {
        currentContent = `The user uploaded a PDF named "${pdfName || 'document.pdf'}" but no readable text could be extracted from it   it is likely a scanned document or image-based PDF. Politely tell the user that this PDF appears to be scanned/image-based and text couldn't be extracted, and suggest they try a text-based PDF instead.`;
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

    // ===== Streaming response setup =====
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (res.flushHeaders) res.flushHeaders();

    res.write(`data:meta:${JSON.stringify({ conversationId: convo._id, title: convo.title })}\n\n`);

    let fullReply = '';
    let clientDisconnected = false;

    try {
      const stream = await groq.chat.completions.create({
        messages: [systemMessage, ...priorHistory, { role: 'user', content: currentContent }],
        model: modelToUse,
        max_completion_tokens: 600,
        stream: true
      });

      for await (const chunk of stream) {
        const token = chunk.choices?.[0]?.delta?.content || '';
        if (token) {
          fullReply += token;
          try {
            res.write(`data:chunk:${encodeURIComponent(token)}\n\n`);
          } catch (writeErr) {
            clientDisconnected = true;
            break;
          }
        }
      }
    } catch (streamErr) {
      console.error('Streaming error:', streamErr);
      if (!res.writableEnded) {
        try {
          res.write(`data:error:${encodeURIComponent('Something went wrong while generating the response.')}\n\n`);
        } catch (e) {}
      }
    }

    if (fullReply) {
      convo.messages.push({ role: 'assistant', text: fullReply });
      try {
        await convo.save();
      } catch (saveErr) {
        console.error('Failed to save conversation:', saveErr);
      }
    }

    if (!clientDisconnected && !res.writableEnded) {
      res.write(`data:done\n\n`);
      res.end();
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Something went wrong' });
    } else if (!res.writableEnded) {
      try {
        res.write(`data:error:${encodeURIComponent('Something went wrong')}\n\n`);
        res.end();
      } catch (e) {}
    }
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