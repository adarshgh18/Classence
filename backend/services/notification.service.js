const Notification = require('../models/Notification');
const User = require('../models/User');
const logger = require('../utils/logger');
const { getIO } = require('../sockets');

/**
 * Safely obtain Socket.io server instance without throwing if uninitialized.
 */
const safeGetIO = () => {
  try {
    return getIO();
  } catch (err) {
    return null;
  }
};

/**
 * Emit a new notification event to an authenticated user's room.
 * @param {Object} notification - Persisted Notification document/object
 */
const emitNotificationToUser = (notification) => {
  try {
    const io = safeGetIO();
    if (!io) return;

    const recipientId = notification.recipient ? notification.recipient.toString() : null;
    if (!recipientId) return;

    const payload = notification.toObject ? notification.toObject() : notification;
    io.to(`user:${recipientId}`).emit('notification:new', payload);
  } catch (err) {
    logger.error(`[NotificationService] Failed to emit real-time notification to user ${notification.recipient}:`, err.message);
  }
};

/**
 * Create and deliver an individual notification if the user has isNotification enabled.
 * 
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.recipientId - Target user ID
 * @param {string} params.type - Approved notification type
 * @param {string} params.title - Human-readable title
 * @param {string} params.message - Human-readable message
 * @param {string} [params.link] - Navigation link
 * @param {Object} [params.context] - Minimal contextual IDs (classroomId, assignmentId, etc.)
 * @returns {Promise<Object|null>} - Created notification or null if muted/failed
 */
const createNotification = async ({
  recipientId,
  type,
  title,
  message,
  link = '',
  context = {}
}) => {
  try {
    if (!recipientId) return null;

    // Check recipient's notification preference
    const recipient = await User.findById(recipientId).select('isNotification');
    if (!recipient || recipient.isNotification === false) {
      // User has notifications disabled or does not exist
      return null;
    }

    const notification = new Notification({
      recipient: recipientId,
      type,
      title,
      message,
      link,
      classroomId: context.classroomId || null,
      classCode: context.classCode || '',
      className: context.className || '',
      assignmentId: context.assignmentId || null,
      submissionId: context.submissionId || null,
      announcementId: context.announcementId || null,
      lectureId: context.lectureId || null
    });

    await notification.save();

    // Emit real-time socket event to the authenticated user room
    emitNotificationToUser(notification);

    return notification;
  } catch (error) {
    logger.error('[NotificationService] Error creating notification:', error.message);
    // Never propagate error to cause rollback of primary academic operations
    return null;
  }
};

/**
 * Create and deliver notifications to multiple recipients, respecting each recipient's isNotification preference.
 * 
 * @param {Object} params
 * @param {Array<string|mongoose.Types.ObjectId>} params.recipientIds - Target user IDs
 * @param {string} params.type - Approved notification type
 * @param {string} params.title - Human-readable title
 * @param {string} params.message - Human-readable message
 * @param {string} [params.link] - Navigation link
 * @param {Object} [params.context] - Minimal contextual IDs
 * @returns {Promise<Array<Object>>} - Array of created notifications
 */
const createBatchNotifications = async ({
  recipientIds,
  type,
  title,
  message,
  link = '',
  context = {}
}) => {
  try {
    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
      return [];
    }

    // Deduplicate recipient IDs and convert to strings
    const uniqueIds = Array.from(new Set(recipientIds.map(id => id.toString())));

    // Find users with isNotification !== false
    const eligibleUsers = await User.find({
      _id: { $in: uniqueIds },
      isNotification: { $ne: false }
    }).select('_id');

    if (!eligibleUsers || eligibleUsers.length === 0) {
      return [];
    }

    const docs = eligibleUsers.map(user => ({
      recipient: user._id,
      type,
      title,
      message,
      link,
      classroomId: context.classroomId || null,
      classCode: context.classCode || '',
      className: context.className || '',
      assignmentId: context.assignmentId || null,
      submissionId: context.submissionId || null,
      announcementId: context.announcementId || null,
      lectureId: context.lectureId || null
    }));

    const createdNotifications = await Notification.insertMany(docs);

    // Emit real-time socket events for each created notification
    createdNotifications.forEach(notif => {
      emitNotificationToUser(notif);
    });

    return createdNotifications;
  } catch (error) {
    logger.error('[NotificationService] Error creating batch notifications:', error.message);
    return [];
  }
};

module.exports = {
  createNotification,
  createBatchNotifications,
  emitNotificationToUser
};
