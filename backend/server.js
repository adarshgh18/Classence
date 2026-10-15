const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const { initSocket } = require('./sockets');
const logger = require('./utils/logger');

const server = http.createServer(app);

// Initialize Socket.io on the HTTP server
initSocket(server);

// Start server function
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start listening
    server.listen(env.port, () => {
      logger.info(`==================================================`);
      logger.info(`🚀 Classence Backend Server Running`);
      logger.info(`📡 Port: ${env.port}`);
      logger.info(`🌐 Environment: ${env.nodeEnv}`);
      logger.info(`🏥 Health Check: http://localhost:${env.port}/health`);
      logger.info(`==================================================`);
    });
  } catch (error) {
    logger.error('Failed to start server due to startup error:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  logger.warn(`Received ${signal}. Initiating graceful shutdown...`);

  try {
    const { getIO } = require('./sockets');
    getIO().close();
    logger.info('Socket.io connections closed.');
  } catch (err) {
    // Ignore if not initialized
  }

  if (server.closeAllConnections) {
    server.closeAllConnections();
  }

  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await disconnectDB();
      logger.info('Clean shutdown complete. Exiting process.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during database disconnection:', err.message);
      process.exit(1);
    }
  });

  // Force close after 3 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 3000);
};

// Handle process signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGQUIT', () => gracefulShutdown('SIGQUIT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception thrown:', error);
  process.exit(1);
});

// Launch server
startServer();
