const Announcement = require('../models/Announcement');
const Classroom = require('../models/Classroom');
const storageService = require('../services/storage.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

const createAnnouncement = async (req, res, next) => {
  try {
    const { title, description, code } = req.body;
    if (!title || !description || !code) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    if (!classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to create announcements' });
    }

    let media = [];
    let filesMetadata = [];

    if (req.files && req.files.length > 0) {
      const uploadResults = await Promise.all(
        req.files.map(file => storageService.uploadBuffer(file.buffer, {
          folder: 'Classence/announcements',
          originalname: file.originalname,
          mimetype: file.mimetype
        }))
      );
      media = uploadResults.map(r => r.url);
      filesMetadata = uploadResults.map(r => ({ publicId: r.publicId, resourceType: r.resourceType }));
    }

    const announcement = new Announcement({
      title,
      description,
      media,
      filesMetadata,
      classroom: classroom._id,
      author: req.user._id
    });

    await announcement.save();

    // Notify enrolled students of the classroom (excluding creator)
    if (classroom.students && classroom.students.length > 0) {
      const studentRecipients = classroom.students.filter(
        sid => sid.toString() !== req.user._id.toString()
      );
      if (studentRecipients.length > 0) {
        notificationService.createBatchNotifications({
          recipientIds: studentRecipients,
          type: 'ANNOUNCEMENT_CREATED',
          title: 'New Announcement',
          message: `New announcement in ${classroom.name}`,
          link: '/announcement',
          context: {
            classroomId: classroom._id,
            classCode: classroom.code,
            className: classroom.name,
            announcementId: announcement._id
          }
        }).catch(err => {
          logger.error('Failed to dispatch announcement notifications:', err.message);
        });
      }
    }

    return res.status(201).json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
};

const editAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, code } = req.body;
    
    if (!title || !description || !code) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    const announcement = await Announcement.findOne({ _id: id, classroom: classroom._id });
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    if (!classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this announcement' });
    }

    announcement.title = title;
    announcement.description = description;

    if (req.files && req.files.length > 0) {
      const uploadResults = await Promise.all(
        req.files.map(file => storageService.uploadBuffer(file.buffer, {
          folder: 'Classence/announcements',
          originalname: file.originalname,
          mimetype: file.mimetype
        }))
      );
      const newMedia = uploadResults.map(r => r.url);
      const newFilesMetadata = uploadResults.map(r => ({ publicId: r.publicId, resourceType: r.resourceType }));

      announcement.media = [...announcement.media, ...newMedia];
      announcement.filesMetadata = [...(announcement.filesMetadata || []), ...newFilesMetadata];
    }

    await announcement.save();

    return res.status(200).json({ success: true, announcement });
  } catch (error) {
    next(error);
  }
};

const deleteAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { code } = req.body; // Sent via data: { code: classCode }
    
    if (!code) {
      return res.status(400).json({ success: false, message: 'Classroom code is required' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    const announcement = await Announcement.findOne({ _id: id, classroom: classroom._id });
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    if (!classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this announcement' });
    }

    // Safe Cloudinary cleanup of announcement assets
    if (announcement.filesMetadata && announcement.filesMetadata.length > 0) {
      await storageService.deleteAssets(announcement.filesMetadata);
    }

    await Announcement.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: 'Announcement deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAnnouncement,
  editAnnouncement,
  deleteAnnouncement
};
