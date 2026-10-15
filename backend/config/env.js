const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const isProduction = process.env.NODE_ENV === 'production';

// Production JWT safety: fail-fast if JWT_SECRET is missing or using known dev placeholder
let jwtSecret = process.env.JWT_SECRET;
if (isProduction) {
  if (!jwtSecret || jwtSecret === 'classence_jwt_secret_dev_fallback' || jwtSecret === 'classence_jwt_secret_key_change_in_production') {
    throw new Error('FATAL: In production, JWT_SECRET must be set to a secure, non-default secret key.');
  }
} else {
  jwtSecret = jwtSecret || 'classence_jwt_secret_dev_fallback';
}

const env = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/classence',
  backendUrl: process.env.BACKEND_URL || `http://localhost:${parseInt(process.env.PORT, 10) || 5000}`,
  clientOrigins: process.env.CLIENT_ORIGIN
    ? process.env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  uploadPath: process.env.UPLOAD_PATH || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024,
  isProduction,
  isDevelopment: !isProduction,
  // OTP
  otpExpiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10,
  otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
  // Password Reset
  resetTokenExpiryMinutes: parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES, 10) || 60,
  // Frontend URL (for reset-password email link)
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  // Email / SMTP
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@classence.app'
  },
  // Cloudinary
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || ''
  }
};

module.exports = env;
