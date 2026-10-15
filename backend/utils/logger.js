const getTimestamp = () => new Date().toISOString();

const logger = {
  info: (msg, ...meta) => {
    console.log(`[${getTimestamp()}] [INFO] ${msg}`, ...meta);
  },
  warn: (msg, ...meta) => {
    console.warn(`[${getTimestamp()}] [WARN] ${msg}`, ...meta);
  },
  error: (msg, ...meta) => {
    console.error(`[${getTimestamp()}] [ERROR] ${msg}`, ...meta);
  },
  debug: (msg, ...meta) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[${getTimestamp()}] [DEBUG] ${msg}`, ...meta);
    }
  }
};

module.exports = logger;
