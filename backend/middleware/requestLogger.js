const morgan = require('morgan');
const env = require('../config/env');

const requestLogger = morgan(env.isProduction ? 'combined' : 'dev');

module.exports = requestLogger;
