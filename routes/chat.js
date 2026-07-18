const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const mongoose = require('mongoose');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_HISTORY_MESSAGES = 10;

const BASE_IDENTITY = `You are Anas AI, a helpful voice assistant app created by Anas.
Only mention your name (Anas AI) or your creator (Anas) if the user explicitly asks a direct question like "who made you", "who are you", "who created you", or similar identity questions. In all other conversations, do NOT bring up your name, your creator, or your identity unprompted — just answer the question naturally like a normal helpful assistant would, without self-introduction or repeating "As Anas AI..." or similar phrases. Never mention Groq, Llama, Meta, or any underlying AI model/company.
Respond in the same language/style the user writes in (English, Urdu, or Roman Urdu).
Format your responses using Markdown when it genuinely improves clarity: use **bold** for key terms, ## or ### headings to organize longer explanations into sections, numbered or bulleted lists for steps, and fenced code blocks with a language tag (e.g. \`\`\`python) for any code. Keep formatting proportional — a short casual reply doesn't need headings or lists, but tutorials, comparisons, and step-by-step guides should be well structured.`;
const MODE_PROMPTS = {
  general: `${BASE_IDENTITY}\nKeep answers clear, friendly and concise unless the user asks for something detailed.`,
  study: `${BASE_IDENTITY}\nYou are in Study Helper mode: explain concepts step by step like a patient teacher, use simple examples, and break down complex topics into easy parts. Encourage the user and check if they understood before moving on.`,
  casual: `${BASE_IDENTITY}\nYou are in Casual Chat mode: be warm, friendly, and conversational like a close friend. Use light humor where appropriate, keep replies relaxed and natural, not overly formal.`,
  code: `${BASE_IDENTITY}\nYou are in Code Helper mode: give precise, well-structured technical answers with code examples when relevant. Use code blocks for code. Be direct and avoid unnecessary fluff, but still explain briefly what the code does.`
};

function getSystemPrompt(mode, userName) {
  let prompt = MODE_PROMPTS[mode] || MODE_PROMPTS.general;
  if (userName) {
    prompt += `\nThe user's name is ${userName}. Address them by their name naturally and occasionally (not every message) to make the conversation feel personal and warm, especially at the start of a conversation or when it fits naturally.`;
  }
  return prompt;
}

router.post('/chat', async (req, res) => {
  let convo;
  let streamStarted = false;

  try {
const { userId, message, image, pdfBase64, pdfName, conversationId, mode, editIndex } = req.body;
    if (!userId || (!message && !image && !pdfBase64)) {
      return res.status(400).json({ error: 'userId and message are required' });
    }
let isNewConversation = false;

    if (conversationId) {
      convo = await Conversation.findOne({ _id: conversationId, userId });
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });
    } else {
      convo = new Conversation({ userId, messages: [] });
      isNewConversation = true;
    }

    if (typeof editIndex === 'number' && editIndex >= 0 && editIndex < convo.messages.length) {
      convo.messages = convo.messages.slice(0, editIndex);
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

    let userName = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      try {
        const userDoc = await User.findById(userId).select('name');
        if (userDoc && userDoc.name && userDoc.name !== 'Guest') {
          userName = userDoc.name;
        }
      } catch (e) {
        console.error('User name lookup failed:', e.message);
      }
    }

    const systemMessage = { role: 'system', content: getSystemPrompt(mode, userName) };

    let currentContent;
    let modelToUse = TEXT_MODEL;
    let isVisionRequest = false;

    if (pdfBase64) {
      try {
        const base64Data = pdfBase64.split(',')[1] || pdfBase64;
        const buffer = Buffer.from(base64Data, 'base64');
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(buffer);
        let pdfText = parsed.text || '';

        if (pdfText.trim().length < 20) {
          currentContent = `The user uploaded a PDF named "${pdfName || 'document.pdf'}" but no readable text could be extracted from it — it is likely a scanned document or image-based PDF. Politely tell the user that this PDF appears to be scanned/image-based and text couldn't be extracted, and suggest they try a text-based PDF instead.`;
        } else {
          if (pdfText.length > 15000) pdfText = pdfText.slice(0, 15000) + '\n...[truncated]';
          currentContent = `The user uploaded a PDF document named "${pdfName || 'document.pdf'}". Here is its extracted content:\n\n${pdfText}\n\nUser's question about this document: ${message || 'Summarize this document.'}`;
        }
      } catch (pdfErr) {
        console.error('PDF parse failed:', pdfErr.message);
        const errText = 'Sorry, I could not read this PDF. It may be a scanned, corrupted, or password-protected file. Please try a different one.';
        convo.messages.push({ role: 'assistant', text: errText });
        await convo.save();
        return res.json({ reply: errText, conversationId: convo._id, title: convo.title });
      }
      modelToUse = TEXT_MODEL;
    } else if (image) {
      currentContent = [
        { type: 'text', text: message || 'What is in this image?' },
        { type: 'image_url', image_url: { url: image } }
      ];
      modelToUse = VISION_MODEL;
      isVisionRequest = true;
    } else {
      currentContent = message;
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (res.flushHeaders) res.flushHeaders();
    streamStarted = true;

    res.write(`data:meta:${JSON.stringify({ conversationId: convo._id, title: convo.title })}\n\n`);

    let fullReply = '';
    let clientDisconnected = false;

    try {
      if (isVisionRequest) {
        // Vision model: non-streaming call (Groq vision models may not support streaming reliably),
        // then send the full reply as a single chunk so the frontend still displays it normally.
        const completion = await groq.chat.completions.create({
          messages: [systemMessage, ...priorHistory, { role: 'user', content: currentContent }],
          model: modelToUse,
          max_completion_tokens: 600
        });
        fullReply = completion.choices?.[0]?.message?.content || '';
        if (fullReply) {
          res.write(`data:chunk:${encodeURIComponent(fullReply)}\n\n`);
        }
      } else {
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
      }
    } catch (streamErr) {
      console.error('Groq request error:', streamErr.message || streamErr);
      if (!res.writableEnded) {
        try {
          res.write(`data:error:${encodeURIComponent('Something went wrong while generating the response. Please try again.')}\n\n`);
        } catch (e) {}
      }
    }

    if (fullReply) {
      convo.messages.push({ role: 'assistant', text: fullReply });
      try {
        await convo.save();
      } catch (saveErr) {
        console.error('Failed to save conversation:', saveErr.message);
      }
    }

    if (!clientDisconnected && !res.writableEnded) {
      res.write(`data:done\n\n`);
      res.end();
    }
  } catch (err) {
    console.error('Chat route error:', err.message || err);
    if (!streamStarted && !res.headersSent) {
      res.status(500).json({ error: 'Something went wrong' });
    } else if (!res.writableEnded) {
      try {
        res.write(`data:error:${encodeURIComponent('Something went wrong. Please try again.')}\n\n`);
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