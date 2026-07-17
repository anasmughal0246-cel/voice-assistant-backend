const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const Conversation = require('../models/Conversation');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_HISTORY_MESSAGES = 10;

const BASE_IDENTITY = `You are Anas AI, a helpful voice assistant app created by Anas.
Only mention your name (Anas AI) or your creator (Anas) if the user explicitly asks a direct question like "who made you", "who are you", "who created you", or similar identity questions. In all other conversations, do NOT bring up your name, your creator, or your identity unprompted — just answer the question naturally like a normal helpful assistant would, without self-introduction or repeating "As Anas AI..." or similar phrases. Never mention Groq, Llama, Meta, or any underlying AI model/company.
Respond in the same language/style the user writes in (English, Urdu, or Roman Urdu).`;
const MODE_PROMPTS = {
  general: `${BASE_IDENTITY}\nKeep answers clear, friendly and concise unless the user asks for something detailed.`,
  study: `${BASE_IDENTITY}\nYou are in Study Helper mode: explain concepts step by step like a patient teacher, use simple examples, and break down complex topics into easy parts. Encourage the user and check if they understood before moving on.`,
  casual: `${BASE_IDENTITY}\nYou are in Casual Chat mode: be warm, friendly, and conversational like a close friend. Use light humor where appropriate, keep replies relaxed and natural, not overly formal.`,
  code: `${BASE_IDENTITY}\nYou are in Code Helper mode: give precise, well-structured technical answers with code examples when relevant. Use code blocks for code. Be direct and avoid unnecessary fluff, but still explain briefly what the code does.`,
  debate: `${BASE_IDENTITY}\nYou are in Debate Mode: deliberately take the OPPOSITE stance to whatever the user argues, even if you personally would agree with them. Push back with genuine, well-reasoned counter-arguments — don't just agree or be wishy-washy. Be respectful but firm and challenging. The goal is to sharpen the user's thinking by forcing them to defend their position. If the user asks you to stop debating or switch topics naturally, follow their lead. Keep arguments concise and punchy, not lecture-like.`
};



function getSystemPrompt(mode) {
  return MODE_PROMPTS[mode] || MODE_PROMPTS.general;
}
function getSystemPrompt(mode) {
  return MODE_PROMPTS[mode] || MODE_PROMPTS.general;
}

function detectImageGenPrompt(message) {
  if (!message) return null;
  const text = message.trim();
  const lower = text.toLowerCase();

  const englishPatterns = [
    /^(?:please\s+)?(?:generate|create|make|draw|paint)\s+(?:an?\s+)?(?:image|photo|picture|pic|drawing|painting)\s*(?:of\s+)?(.*)/i,
    /^(?:image|photo|picture|pic)\s+(?:of\s+)?(.*)/i
  ];
  for (const p of englishPatterns) {
    const m = text.match(p);
    if (m) return (m[1] || '').trim() || 'a beautiful image';
  }

  const hasImageWord = /(tasveer|tasvir|image|photo|picture)/i.test(lower);
  const hasMakeWord = /(bana|banado|bana do|banaiye|banayen|banao)/i.test(lower);
  if (hasImageWord && hasMakeWord) {
    let rest = text.replace(/tasveer|tasvir|image|photo|picture|banado|bana do|banaiye|banayen|banao|bana/gi, '').trim();
    return rest || text;
  }

  return null;
}

router.post('/chat', async (req, res) => {
  try {
    const { userId, message, image, pdfBase64, pdfName, conversationId, mode, vault } = req.body;
    if (!userId || (!message && !image && !pdfBase64)) {
      return res.status(400).json({ error: 'userId and message are required' });
    }

    let convo;
    let isNewConversation = false;

    if (vault) {
      convo = new Conversation({ userId, messages: [] });
      isNewConversation = false;
    } else if (conversationId) {
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
     const imagePrompt = (!image && !pdfBase64) ? detectImageGenPrompt(message) : null;

    if (imagePrompt) {
      const encodedPrompt = encodeURIComponent(imagePrompt);
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${seed}`;

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      if (res.flushHeaders) res.flushHeaders();

      res.write(`data:meta:${JSON.stringify({ conversationId: convo._id, title: convo.title })}\n\n`);
      res.write(`data:image:${encodeURIComponent(imageUrl)}\n\n`);

      if (!vault) {
        convo.messages.push({ role: 'assistant', text: `IMG::${imageUrl}` });
        try {
          await convo.save();
        } catch (saveErr) {
          console.error('Failed to save conversation:', saveErr);
        }
      }

      res.write(`data:done\n\n`);
      res.end();
      return;
    }
    const recentMessages = convo.messages.slice(-(MAX_HISTORY_MESSAGES + 1), -1);
    const priorHistory = recentMessages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.text
    }));

    const systemMessage = { role: 'system', content: getSystemPrompt(mode) };

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

    if (fullReply && !vault) {
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