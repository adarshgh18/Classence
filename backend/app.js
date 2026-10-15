const express = require('express');
const cors = require('cors');
const path = require('path');

const corsOptions = require('./config/cors');
const { securityHeaders } = require('./middleware/security');
const { apiLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const healthController = require('./controllers/health.controller');

const app = express();

// Trust proxy if deployed behind reverse proxy
app.set('trust proxy', 1);

// Disable ETags to prevent 304 Not Modified responses from causing empty body issues in frontend Axios cache
app.disable('etag');

// Security Headers (Helmet)
app.use(securityHeaders);

// Cross-Origin Resource Sharing
app.use(cors(corsOptions));

// Request Logging (Morgan)
app.use(requestLogger);

// Global Rate Limiter
app.use(apiLimiter);

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving for uploads
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')));

// Health check endpoints accessible directly at root and /api
app.get('/health', healthController.getHealthStatus);
app.get('/ping', healthController.ping);
app.use('/api/health', healthController.getHealthStatus);

// API router mount
app.use('/api', routes);

// 404 Not Found Catch-All
app.use(notFoundHandler);

// Centralized Error Handling Middleware
app.use(errorHandler);

module.exports = app;
