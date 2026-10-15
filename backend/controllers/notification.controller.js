const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const AppError = require('../utils/appError');

/**
 * GET /api/notification
 * Fetch latest 30 notifications for authenticated user and current unread count.
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Fetch latest 30 notifications, newest first
    const notifications = await Notification.find({ recipient: userId })
      .populate('classroomId', 'code name subject')
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    // Compute unread count for the authenticated user
    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    res.status(200).json({
      success: true,
      unreadCount,
      notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/notification/:id/read
 * Mark an individual notification as read.
 * User can only mark their own notifications as read.
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid notification ID' });
    }

    const notification = await Notification.findById(id);

    if (!notification) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }

    // Verify ownership: recipient must match authenticated user
    if (notification.recipient.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized to update this notification' });
    }

    if (!notification.isRead) {
      notification.isRead = true;
      await notification.save();
    }

    res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/notification/read-all
 * Mark all unread notifications for the authenticated user as read.
 */
exports.markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { recipient: userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};
