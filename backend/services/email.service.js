const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../utils/logger');

// -----------------------------------------------------------------------------
// Transport: if SMTP credentials are provided, use real SMTP.
// Otherwise, in development, log emails to the console (dev-safe fallback).
// This abstraction means production config just requires setting SMTP_* env vars.
// -----------------------------------------------------------------------------
let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const { smtp } = env;
  const hasSmtpConfig = smtp.host && smtp.user && smtp.pass;

  if (hasSmtpConfig) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      }
    });
    logger.info('Email service: using real SMTP transport');
  } else if (env.isProduction) {
    // In production, never print OTP codes or password-reset tokens to logs.
    // Fail safely and return a clear configuration error when email delivery is required.
    transporter = {
      sendMail: async () => {
        logger.error('CRITICAL: Email delivery requested in production, but SMTP is not configured.');
        throw new Error('Email service is not configured on this server.');
      }
    };
    logger.warn('Email service: running in production without SMTP credentials. Outgoing emails will fail safely.');
  } else {
    // Development console transport
    transporter = {
      sendMail: async (options) => {
        logger.info('');
        logger.info('════════════════════════════════════════════════════');
        logger.info('📧 DEV EMAIL (no SMTP configured)');
        logger.info(`  To:      ${options.to}`);
        logger.info(`  Subject: ${options.subject}`);
        logger.info(`  Body:`);
        // Strip HTML tags for console readability
        const text = (options.text || options.html || '')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        logger.info(`  ${text}`);
        logger.info('════════════════════════════════════════════════════');
        logger.info('');
        return { messageId: `dev-${Date.now()}` };
      }
    };
    logger.info('Email service: using DEV console logger (set SMTP_* env vars for real emails)');
  }

  return transporter;
};

// -----------------------------------------------------------------------------
// Sends an OTP verification email.
// Frontend flow: POST /auth/register → user gets OTP email → enters on /otp page
// -----------------------------------------------------------------------------
const sendOTPEmail = async (to, name, otp) => {
  const t = getTransporter();
  await t.sendMail({
    from: `"Classence" <${env.smtp.from}>`,
    to,
    subject: 'Verify Your Classence Account',
    text: `Hi ${name},\n\nYour OTP verification code is: ${otp}\n\nThis code expires in ${env.otpExpiryMinutes} minutes.\n\nIf you did not create an account, please ignore this email.\n\nClassence Team`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e0e0e0;border-radius:8px;">
        <h2 style="color:#066769;">Verify Your Email</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your 6-digit OTP code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#066769;padding:16px 0;">${otp}</div>
        <p>This code expires in <strong>${env.otpExpiryMinutes} minutes</strong>.</p>
        <p style="color:#888;font-size:12px;">If you did not create a Classence account, you can safely ignore this email.</p>
      </div>
    `
  });
};

// -----------------------------------------------------------------------------
// Sends a password-reset link email.
// Frontend: POST /auth/reset-password → email with link → user clicks →
//           /newpass?token=... → PUT /auth/reset-password/:token
// -----------------------------------------------------------------------------
const sendPasswordResetEmail = async (to, name, resetToken) => {
  const resetLink = `${env.frontendUrl}/reset-password?token=${resetToken}`;
  const t = getTransporter();
  await t.sendMail({
    from: `"Classence" <${env.smtp.from}>`,
    to,
    subject: 'Reset Your Classence Password',
    text: `Hi ${name},\n\nClick the link below to reset your password:\n\n${resetLink}\n\nThis link expires in ${env.resetTokenExpiryMinutes} minutes and can only be used once.\n\nIf you did not request a password reset, please ignore this email.\n\nClassence Team`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e0e0e0;border-radius:8px;">
        <h2 style="color:#066769;">Reset Your Password</h2>
        <p>Hi <strong>${name}</strong>,</p>
        <p>Click the button below to reset your Classence password.</p>
        <a href="${resetLink}" style="display:inline-block;margin:16px 0;padding:12px 28px;background:#066769;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
          Reset Password
        </a>
        <p>Or copy and paste this link:</p>
        <p style="word-break:break-all;color:#066769;">${resetLink}</p>
        <p style="color:#888;font-size:12px;">This link expires in <strong>${env.resetTokenExpiryMinutes} minutes</strong> and can only be used once.</p>
        <p style="color:#888;font-size:12px;">If you did not request a password reset, please ignore this email.</p>
      </div>
    `
  });
};

// -----------------------------------------------------------------------------
// Sends a classroom invitation email.
// -----------------------------------------------------------------------------
const sendClassroomInviteEmail = async ({ to, className, teacherName, classCode, joinLink }) => {
  const t = getTransporter();
  await t.sendMail({
    from: `"Classence" <${env.smtp.from}>`,
    to,
    subject: `Invitation to join ${className} on Classence`,
    text: `Hi,\n\n${teacherName} has invited you to join the class "${className}" on Classence.\n\nClass Code: ${classCode}\nJoin Link: ${joinLink}\n\nClick the link above or enter the class code on Classence to join the class.\n\nClassence Team`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;border:1px solid #e0e0e0;border-radius:8px;">
        <h2 style="color:#066769;">Class Invitation</h2>
        <p>Hi,</p>
        <p><strong>${teacherName}</strong> has invited you to join <strong>${className}</strong> on Classence.</p>
        <div style="background:#f4f9f9;padding:16px;border-radius:6px;margin:20px 0;">
          <p style="margin:0 0 8px 0;font-size:14px;color:#555;">Class Code:</p>
          <div style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#066769;">${classCode}</div>
        </div>
        <p>Click the button below to join the class:</p>
        <a href="${joinLink}" style="display:inline-block;margin:16px 0;padding:12px 28px;background:#066769;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
          Join Class
        </a>
        <p style="margin-top:16px;color:#888;font-size:12px;">Or copy and paste this link in your browser:</p>
        <p style="word-break:break-all;color:#066769;font-size:13px;">${joinLink}</p>
        <p style="color:#888;font-size:12px;margin-top:24px;">If you were not expecting this invitation, you can ignore this email.</p>
      </div>
    `
  });
};

module.exports = {
  sendOTPEmail,
  sendPasswordResetEmail,
  sendClassroomInviteEmail
};
