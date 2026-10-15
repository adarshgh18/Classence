const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  registerValidator,
  loginValidator,
  verifyOtpValidator,
  resendOtpValidator,
  forgotPasswordValidator,
  resetPasswordValidator
} = require('../validators/auth.validators');

// POST /auth/register
router.post('/register', authLimiter, registerValidator, authController.register);

// POST /auth/verify
router.post('/verify', authLimiter, verifyOtpValidator, authController.verifyOtp);

// POST /auth/resend-otp
router.post('/resend-otp', authLimiter, resendOtpValidator, authController.resendOtp);

// POST /auth/login
router.post('/login', authLimiter, loginValidator, authController.login);

// POST /auth/reset-password  (forgot password — sends email link)
router.post('/reset-password', authLimiter, forgotPasswordValidator, authController.forgotPassword);

// PUT /auth/reset-password/:token  (set new password with token from email)
router.put('/reset-password/:token', authLimiter, resetPasswordValidator, authController.resetPassword);

module.exports = router;
