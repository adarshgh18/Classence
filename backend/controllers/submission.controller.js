const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const Classroom = require('../models/Classroom');
const storageService = require('../services/storage.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

// GET /api/submission/my-submission?assignmentId=...
exports.getMySubmission = async (req, res, next) => {
  try {
    const { assignmentId } = req.query;
    if (!assignmentId) {
      return res.status(400).json({ error: 'assignmentId is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      return res.status(400).json({ error: 'Invalid assignmentId' });
    }

    const assignment = await Assignment.findById(assignmentId).populate('classroom');
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Verify student is enrolled in the classroom
    const classroom = assignment.classroom;
    const isEnrolled = classroom && classroom.students && classroom.students.some(
      s => s.toString() === req.user._id.toString()
    );

    if (!isEnrolled) {
      return res.status(403).json({ error: 'You are not enrolled in this classroom' });
    }

    const submission = await Submission.findOne({
      assignment: assignmentId,
      student: req.user._id
    });

    if (!submission) {
      return res.json({
        success: true,
        submission: null
      });
    }

    return res.json({
      success: true,
      submission: {
        _id: submission._id,
        media: submission.media,
        marks: submission.marks,
        isGraded: submission.isGraded,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/submission/create
exports.createSubmission = async (req, res, next) => {
  try {
    const { assignmentId } = req.body;
    if (!assignmentId) {
      return res.status(400).json({ error: 'assignmentId is required' });
    }

    const assignment = await Assignment.findById(assignmentId).populate('classroom');
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Verify student is enrolled in the classroom
    const classroom = assignment.classroom;
    const isEnrolled = classroom && classroom.students && classroom.students.some(
      s => s.toString() === req.user._id.toString()
    );
    if (!isEnrolled) {
      return res.status(403).json({ error: 'You are not enrolled in this classroom' });
    }

    // Check if already submitted
    const existingSubmission = await Submission.findOne({
      assignment: assignmentId,
      student: req.user._id
    });

    if (existingSubmission) {
      return res.status(400).json({ error: 'You have already submitted this assignment' });
    }

    let mediaUrls = [];
    let filesMetadata = [];

    if (req.files && req.files.length > 0) {
      const uploadResults = await Promise.all(
        req.files.map(file => storageService.uploadBuffer(file.buffer, {
          folder: 'Classence/submissions',
          originalname: file.originalname,
          mimetype: file.mimetype
        }))
      );
      mediaUrls = uploadResults.map(r => r.url);
      filesMetadata = uploadResults.map(r => ({ publicId: r.publicId, resourceType: r.resourceType }));
    }

    const submission = new Submission({
      assignment: assignmentId,
      student: req.user._id,
      classroom: classroom._id,
      media: mediaUrls,
      filesMetadata
    });

    await submission.save();

    // Notify classroom owner/teacher of the new submission (excluding submitting student)
    if (classroom.teacher && classroom.teacher.toString() !== req.user._id.toString()) {
      notificationService.createNotification({
        recipientId: classroom.teacher,
        type: 'SUBMISSION_RECEIVED',
        title: 'New Submission',
        message: `${req.user.name || 'Student'} submitted "${assignment.name}"`,
        link: '/assignment-details',
        context: {
          classroomId: classroom._id,
          classCode: classroom.code,
          className: classroom.name,
          assignmentId: assignment._id,
          submissionId: submission._id
        }
      }).catch(err => {
        logger.error('Failed to dispatch submission notification:', err.message);
      });
    }

    res.status(201).json({ message: 'Files submitted successfully', submission });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'You have already submitted this assignment' });
    }
    next(error);
  }
};

// POST /api/submission/grade
exports.gradeSubmission = async (req, res, next) => {
  try {
    const { submissionId, marks } = req.body;

    if (!submissionId || marks === undefined) {
      return res.status(400).json({ error: 'submissionId and marks are required' });
    }

    const numericMarks = Number(marks);
    if (isNaN(numericMarks) || numericMarks < 0 || numericMarks > 10) {
      return res.status(400).json({ error: 'Marks must be a number between 0 and 10' });
    }

    const submission = await Submission.findById(submissionId).populate({
      path: 'assignment',
      select: 'name teacher classroom',
      populate: {
        path: 'classroom',
        select: 'code name'
      }
    });

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Verify user is the teacher of the assignment
    if (submission.assignment.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the teacher can grade this submission' });
    }

    submission.marks = numericMarks;
    submission.isGraded = true;
    await submission.save();

    // Notify the student who owns the submission
    if (submission.student) {
      notificationService.createNotification({
        recipientId: submission.student,
        type: 'ASSIGNMENT_GRADED',
        title: 'Assignment Graded',
        message: `"${submission.assignment?.name || 'Assignment'}" has been graded`,
        link: '/assignment-details',
        context: {
          classroomId: submission.assignment.classroom?._id || submission.assignment.classroom,
          classCode: submission.assignment.classroom?.code || '',
          className: submission.assignment.classroom?.name || '',
          assignmentId: submission.assignment._id,
          submissionId: submission._id
        }
      }).catch(err => {
        logger.error('Failed to dispatch assignment graded notification:', err.message);
      });
    }

    res.json({ message: 'Grade updated successfully', submission });
  } catch (error) {
    next(error);
  }
};
