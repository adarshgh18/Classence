const { body, validationResult } = require('express-validator');

// -----------------------------------------------------------------------------
// Returns validation errors if any, formatted as { error: "...", errors: [...] }
// This matches the frontend's: error.response?.data?.error toast pattern
// -----------------------------------------------------------------------------
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg);
    return res.status(400).json({
      success: false,
      error: messages[0],          // primary message for toast display
      errors: messages             // full list for debugging
    });
  }
  next();
};

// -----------------------------------------------------------------------------
// Auth validators
// -----------------------------------------------------------------------------

const registerValidator = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 3 }).withMessage('Name must be at least 3 characters')
    .isLength({ max: 60 }).withMessage('Name must be at most 60 characters')
    .matches(/^[A-Za-z]/).withMessage('Username must start with a letter'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character'),

  validate
];

const loginValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required'),

  validate
];

const verifyOtpValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),

  body('otp')
    .trim()
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits')
    .isNumeric().withMessage('OTP must contain only digits'),

  validate
];

const resendOtpValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),

  validate
];

const forgotPasswordValidator = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Please enter a valid email address')
    .normalizeEmail(),

  validate
];

const resetPasswordValidator = [
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/).withMessage('Password must contain at least one special character'),

  validate
];

// -----------------------------------------------------------------------------
// Settings validators
// -----------------------------------------------------------------------------

const changePasswordValidator = [
  body('oldPassword')
    .notEmpty().withMessage('Old password is required'),

  body('newPassword')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain at least one number')
    .matches(/[@#$%^&*()_+\-=[\]{};':"|,.<>/?]/).withMessage('Password must contain at least one special character'),

  validate
];

const changeNameValidator = [
  validate  // name will be accepted from req.body.name OR req.body.newName — validated in controller
];

const changeNotificationValidator = [
  body('isNotification')
    .notEmpty().withMessage('isNotification field is required')
    .isBoolean().withMessage('isNotification must be a boolean'),

  validate
];

module.exports = {
  registerValidator,
  loginValidator,
  verifyOtpValidator,
  resendOtpValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  changeNameValidator,
  changeNotificationValidator
};
