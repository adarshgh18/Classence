const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    // ------------------------------------------------------------------
    // Core identity — from dashboard.jsx/userSlice.js expectations:
    //   response.data.user.name, .email, ._id, .joinedClasses, .createdClasses
    // ------------------------------------------------------------------
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [3, 'Name must be at least 3 characters'],
      maxlength: [60, 'Name must be at most 60 characters']
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address']
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false  // never returned in queries by default
    },

    // ------------------------------------------------------------------
    // Email verification state (registration OTP flow)
    // ------------------------------------------------------------------
    isVerified: {
      type: Boolean,
      default: false
    },
    otp: {
      code: { type: String, select: false },        // 6-digit stored as string
      expiresAt: { type: Date, select: false },
      attempts: { type: Number, default: 0, select: false }
    },

    // ------------------------------------------------------------------
    // Password reset (forgot-password → token email → PUT /auth/reset-password/:token)
    // ------------------------------------------------------------------
    passwordReset: {
      token: { type: String, select: false },       // hashed token
      expiresAt: { type: Date, select: false },
      usedAt: { type: Date, select: false }         // marks single-use
    },

    // ------------------------------------------------------------------
    // Session invalidation — sign-out-all-devices uses tokenVersion.
    // JWT payload carries tokenVersion; if it mismatches, token is rejected.
    // ------------------------------------------------------------------
    tokenVersion: {
      type: Number,
      default: 0,
      select: false
    },

    // ------------------------------------------------------------------
    // Settings / preferences
    // ------------------------------------------------------------------
    isNotification: {
      type: Boolean,
      default: true
    },

    // ------------------------------------------------------------------
    // Admin flag (for support chat authorization — Phase 7)
    // ------------------------------------------------------------------
    isAdmin: {
      type: Boolean,
      default: false,
      select: false
    },

    // ------------------------------------------------------------------
    // Classroom relationships — populated by Phase 3.
    // Stored as ObjectId refs; counts derived on read.
    // dashboard.jsx reads: user.joinedClasses, user.createdClasses,
    //                       user.noOfJoinedClasses, user.noOfCreatedClasses
    // ------------------------------------------------------------------
    joinedClasses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom'
      }
    ],
    createdClasses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Classroom'
      }
    ]
  },
  {
    timestamps: true
  }
);

// ------------------------------------------------------------------
// Virtual: counts (computed, never stored)
// ------------------------------------------------------------------
userSchema.virtual('noOfJoinedClasses').get(function () {
  return this.joinedClasses ? this.joinedClasses.length : 0;
});
userSchema.virtual('noOfCreatedClasses').get(function () {
  return this.createdClasses ? this.createdClasses.length : 0;
});

// Enable virtuals in toJSON/toObject so they appear in API responses
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

// ------------------------------------------------------------------
// Pre-save: hash password when it changes
// ------------------------------------------------------------------
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ------------------------------------------------------------------
// Instance method: compare plaintext to hash
// ------------------------------------------------------------------
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ------------------------------------------------------------------
// Instance method: get safe public projection (no sensitive fields)
// ------------------------------------------------------------------
userSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    isVerified: this.isVerified,
    isNotification: typeof this.isNotification === 'boolean' ? this.isNotification : true,
    joinedClasses: this.joinedClasses,
    createdClasses: this.createdClasses,
    noOfJoinedClasses: this.noOfJoinedClasses,
    noOfCreatedClasses: this.noOfCreatedClasses,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User;
