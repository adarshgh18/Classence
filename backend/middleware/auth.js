const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/appError');
const User = require('../models/User');

// -----------------------------------------------------------------------------
// Issue a JWT for an authenticated user.
// Payload includes tokenVersion for sign-out-all-devices invalidation.
// -----------------------------------------------------------------------------
const signToken = (userId, tokenVersion) => {
  return jwt.sign(
    { id: userId, tv: tokenVersion },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
};

// -----------------------------------------------------------------------------
// protect middleware — attached to every authenticated route.
//
// Contract (from frontend):
//   - Token stored in sessionStorage/localStorage as 'authToken'
//   - Sent as: Authorization: Bearer <token>
// -----------------------------------------------------------------------------
const protect = async (req, res, next) => {
  try {
    // 1. Extract token
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      return next(new AppError('Authentication required. Please log in.', 401));
    }

    // 2. Verify signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, env.jwtSecret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AppError('Your session has expired. Please log in again.', 401));
      }
      return next(new AppError('Invalid authentication token. Please log in again.', 401));
    }

    // 3. Fetch user (select tokenVersion for invalidation check)
    const user = await User.findById(decoded.id).select('+tokenVersion');
    if (!user) {
      return next(new AppError('User no longer exists.', 401));
    }

    // 4. Check tokenVersion — sign-out-all-devices bumps this, invalidating old JWTs
    if (decoded.tv !== user.tokenVersion) {
      return next(new AppError('Session has been invalidated. Please log in again.', 401));
    }

    // 5. Attach user to request
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// -----------------------------------------------------------------------------
// restrictToAdmin — for developer/admin-only endpoints (Phase 7 support chat)
// -----------------------------------------------------------------------------
const restrictToAdmin = async (req, res, next) => {
  const user = await User.findById(req.user._id).select('+isAdmin');
  if (!user || !user.isAdmin) {
    return next(new AppError('You do not have permission to perform this action.', 403));
  }
  next();
};

module.exports = {
  signToken,
  protect,
  restrictToAdmin
};
