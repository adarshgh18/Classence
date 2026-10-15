const crypto = require('crypto');
const User = require('../models/User');
const { signToken } = require('../middleware/auth');
const { sendOTPEmail, sendPasswordResetEmail } = require('../services/email.service');
const AppError = require('../utils/appError');
const env = require('../config/env');
const logger = require('../utils/logger');

// ------------------------------------------------------------------
// Helper: generate cryptographically random 6-digit OTP
// ------------------------------------------------------------------
const generateOTP = () => {
  return String(Math.floor(100000 + crypto.randomInt(900000))).padStart(6, '0');
};

// ------------------------------------------------------------------
// Helper: generate a cryptographically random opaque token for
// password-reset. The raw token is sent in the email; a SHA-256
// hash is stored in the database (never the raw token).
// ------------------------------------------------------------------
const generateResetToken = () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hashed };
};

// ==================================================================
// POST /auth/register
// Body: { name, email, password }
// Success: { success: true, message: "..." }
// Error: { success: false, error: "..." }
// ==================================================================
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    // Reject if already verified (duplicate account)
    const existing = await User.findOne({ email });
    if (existing && existing.isVerified) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists. Please log in.'
      });
    }

    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);

    if (existing && !existing.isVerified) {
      // Re-use unverified account — refresh OTP
      existing.name = name;
      existing.password = password;   // pre-save hook re-hashes
      existing.otp = { code: otp, expiresAt: otpExpiresAt, attempts: 0 };
      await existing.save();
    } else {
      await User.create({
        name,
        email,
        password,
        otp: { code: otp, expiresAt: otpExpiresAt, attempts: 0 }
      });
    }

    await sendOTPEmail(email, name, otp);

    return res.status(201).json({
      success: true,
      message: 'Account created! Please check your email for the OTP verification code.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /auth/verify
// Body: { email, otp }
// Success: { success: true, message: "..." }
// Error: { success: false, error: "..." }
// ==================================================================
const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select('+otp.code +otp.expiresAt +otp.attempts');
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP.' });
    }
    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Email is already verified. Please log in.' });
    }

    // Attempt limit
    if (user.otp.attempts >= env.otpMaxAttempts) {
      return res.status(429).json({
        success: false,
        error: 'Too many failed attempts. Please request a new OTP.'
      });
    }

    // Expiry check
    if (!user.otp.expiresAt || user.otp.expiresAt < new Date()) {
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    // Compare
    if (user.otp.code !== String(otp).trim()) {
      user.otp.attempts += 1;
      await user.save();
      return res.status(400).json({ success: false, error: 'Incorrect OTP. Please try again.' });
    }

    // Mark verified and clear OTP
    user.isVerified = true;
    user.otp = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now log in.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /auth/resend-otp
// Body: { email }
// Success: { success: true, message: "..." }
// Error: { success: false, error: "..." }
// ==================================================================
const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, error: 'No account found with this email.' });
    }
    if (user.isVerified) {
      return res.status(400).json({ success: false, error: 'Email is already verified. Please log in.' });
    }

    const otp = generateOTP();
    const otpExpiresAt = new Date(Date.now() + env.otpExpiryMinutes * 60 * 1000);

    user.otp = { code: otp, expiresAt: otpExpiresAt, attempts: 0 };
    await user.save();

    await sendOTPEmail(email, user.name, otp);

    return res.status(200).json({
      success: true,
      message: 'A new OTP has been sent to your email.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /auth/login
// Body: { email, password }
// Success: { success: true, token: "..." }
// Error: { success: false, error: "..." }
//
// Frontend reads: response.data.token → stores as 'authToken'
// Error check: error.response.data.error.includes('Password')
// ==================================================================
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Fetch password and tokenVersion explicitly (both select:false)
    const user = await User.findOne({ email }).select('+password +tokenVersion');
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'No account found with this email.'
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before logging in.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        // Frontend checks: error.includes('Password') → sets password field error
        error: 'Password is incorrect. Please try again.'
      });
    }

    const token = signToken(user._id, user.tokenVersion);

    return res.status(200).json({
      success: true,
      token
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /auth/reset-password   (forgot-password — sends email link)
// Body: { email }
// Success: { success: true }
// Error: { success: false, error: "..." }
//
// Frontend: pwreset.jsx checks response.data.success === true, shows
// "Link sent!" state. No toast on success. Error toasts use .data.error
// ==================================================================
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email, isVerified: true });

    // Deliberately ambiguous response for non-existent emails (prevents user enumeration)
    if (!user) {
      return res.status(200).json({ success: true });
    }

    const { raw, hashed } = generateResetToken();
    const expiresAt = new Date(Date.now() + env.resetTokenExpiryMinutes * 60 * 1000);

    user.passwordReset = { token: hashed, expiresAt, usedAt: null };
    await user.save();

    await sendPasswordResetEmail(email, user.name, raw);

    return res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// PUT /auth/reset-password/:token
// Body: { password }
// Success: { success: true, message: "..." }
// Error: { success: false, error: "..." }
//
// Frontend: newpass.jsx — uses PUT, sends { password }
// ==================================================================
const resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Hash the raw token from URL to compare with stored hash
    const hashed = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      'passwordReset.token': hashed,
      'passwordReset.expiresAt': { $gt: new Date() },
      'passwordReset.usedAt': null      // single-use
    }).select('+passwordReset.token +passwordReset.expiresAt +passwordReset.usedAt +tokenVersion');

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Password reset link is invalid or has expired. Please request a new one.'
      });
    }

    // Set new password and invalidate the token + all existing sessions
    user.password = password;                     // pre-save hook hashes it
    user.passwordReset.usedAt = new Date();       // mark single-use
    user.passwordReset.token = undefined;
    user.passwordReset.expiresAt = undefined;
    user.tokenVersion += 1;                       // invalidate all existing JWTs
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  verifyOtp,
  resendOtp,
  login,
  forgotPassword,
  resetPassword
};
