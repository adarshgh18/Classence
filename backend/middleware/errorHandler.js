const env = require('../config/env');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');

// 404 handler for undefined routes
const notFoundHandler = (req, res, next) => {
  next(new AppError(`Resource not found: ${req.method} ${req.originalUrl}`, 404));
};

// Centralized error handler
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.statusCode = err.statusCode || 500;

  // Log error
  if (error.statusCode >= 500) {
    logger.error(`[${req.method}] ${req.originalUrl} - Server Error: ${err.message}`, err.stack);
  } else {
    logger.warn(`[${req.method}] ${req.originalUrl} - Client Error (${error.statusCode}): ${err.message}`);
  }

  // Handle Mongoose Bad ObjectId (CastError)
  if (err.name === 'CastError') {
    const message = `Invalid resource identifier: ${err.value}`;
    error = new AppError(message, 400);
  }

  // Handle Mongoose Duplicate Key (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const message = `An account or record with that ${field} already exists.`;
    error = new AppError(message, 409);
  }

  // Handle Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    const message = `Validation error: ${messages.join('. ')}`;
    error = new AppError(message, 400);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid authentication token. Please log in again.', 401);
  }
  if (err.name === 'TokenExpiredError') {
    error = new AppError('Your authentication token has expired. Please log in again.', 401);
  }

  // Handle Multer errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      error = new AppError('Uploaded file exceeds the maximum allowed size limit.', 400);
    } else {
      error = new AppError(`File upload error: ${err.message}`, 400);
    }
  }

  const statusCode = error.statusCode || 500;
  const response = {
    success: false,
    message: error.message || 'Internal Server Error'
  };

  // Provide details in development
  if (env.isDevelopment) {
    response.stack = err.stack;
    if (err.errors) {
      response.errors = err.errors;
    }
  }

  res.status(statusCode).json(response);
};

module.exports = {
  notFoundHandler,
  errorHandler
};
