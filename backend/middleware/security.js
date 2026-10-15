const helmet = require('helmet');

const securityHeaders = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows frontend to load images/uploads
  crossOriginEmbedderPolicy: false
});

module.exports = {
  securityHeaders
};
