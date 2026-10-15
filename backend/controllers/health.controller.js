const mongoose = require('mongoose');
const env = require('../config/env');
const apiResponse = require('../utils/apiResponse');

const getDbStateString = (state) => {
  switch (state) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
};

const getHealthStatus = (req, res) => {
  const dbState = mongoose.connection.readyState;
  const isDbHealthy = dbState === 1;

  const healthData = {
    service: 'classence-backend',
    status: isDbHealthy ? 'healthy' : 'degraded',
    uptime: `${Math.floor(process.uptime())}s`,
    timestamp: new Date().toISOString(),
    environment: env.nodeEnv,
    database: {
      status: getDbStateString(dbState),
      readyState: dbState,
      name: mongoose.connection.name || 'uninitialized'
    }
  };

  const statusCode = isDbHealthy ? 200 : 503;
  return apiResponse.success(res, healthData, 'System health check completed', statusCode);
};

const ping = (req, res) => {
  res.status(200).send('pong');
};

module.exports = {
  getHealthStatus,
  ping
};
