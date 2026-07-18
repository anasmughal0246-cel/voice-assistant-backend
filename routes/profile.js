const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { requireAuth } = require('../middleware/authMiddleware');

// GET current profile
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      isAdmin: req.user.isAdmin,
      profilePhoto: req.user.profilePhoto || ''
    }
  });
});

// UPDATE name and/or photo
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const { name, profilePhoto } = req.body;
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      req.user.name = name.trim().slice(0, 50);
    }
    if (profilePhoto !== undefined) {
      req.user.profilePhoto = profilePhoto;
    }
    await req.user.save();
    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        isAdmin: req.user.isAdmin,
        profilePhoto: req.user.profilePhoto || ''
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// CHANGE password
router.patch('/me/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    if (!req.user.password) {
      return res.status(400).json({ error: 'This account uses Google Sign-In and has no password to change' });
    }
    const isMatch = await bcrypt.compare(currentPassword || '', req.user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    req.user.password = await bcrypt.hash(newPassword, 10);
    await req.user.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

module.exports = router;