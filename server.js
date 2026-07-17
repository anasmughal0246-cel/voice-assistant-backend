require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const chatRoutes = require('./routes/chat');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Bohat zyada messages bhej diye. Thodi der baad try karein.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Bohat zyada attempts. 15 minute baad try karein.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/chat', chatLimiter);
app.use('/api/auth', authLimiter);

app.use('/api', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.send('Voice assistant backend is running.');
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));