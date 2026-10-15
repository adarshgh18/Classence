const Assignment = require('../models/Assignment');
const Classroom = require('../models/Classroom');
const Submission = require('../models/Submission');
const storageService = require('../services/storage.service');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

// Helper to check if an assignment deadline has passed (treats YYYY-MM-DD as due through end of day)
const isAssignmentPastDue = (dueDateStr) => {
  if (!dueDateStr) return false;
  const now = new Date();
  const trimmed = String(dueDateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
    return now.getTime() > endOfDay.getTime();
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return false;
  return now.getTime() > parsed.getTime();
};

// GET /api/assignment/get?classroomId=... or ?assignmentId=...
exports.getAssignments = async (req, res, next) => {
  try {
    const { classroomId, assignmentId, id } = req.query;
    const targetAssignmentId = assignmentId || id;

    if (!classroomId && !targetAssignmentId) {
      return res.status(400).json({ error: 'classroomId or assignmentId is required' });
    }

    let classroom = null;
    let targetAssignment = null;

    if (targetAssignmentId) {
      targetAssignment = await Assignment.findById(targetAssignmentId);
      if (!targetAssignment) {
        return res.status(404).json({ error: 'Assignment not found' });
      }
      classroom = await Classroom.findById(targetAssignment.classroom);
      if (!classroom) {
        return res.status(404).json({ error: 'Classroom not found' });
      }
    } else {
      classroom = await Classroom.findById(classroomId);
      if (!classroom) {
        return res.status(404).json({ error: 'Classroom not found' });
      }
    }

    // Verify user is enrolled or is the teacher
    const isTeacher = classroom.teacher.toString() === req.user._id.toString();
    const isStudent = classroom.students.some(sid => sid.toString() === req.user._id.toString());

    if (!isTeacher && !isStudent) {
      return res.status(403).json({ error: 'Not authorized to view assignments for this classroom' });
    }

    const query = targetAssignmentId ? { _id: targetAssignmentId } : { classroom: classroomId };
    const queryBuilder = Assignment.find(query);

    if (!targetAssignmentId) {
      queryBuilder.sort({ createdAt: -1 });
    }

    const assignments = await queryBuilder
      .populate({
        path: 'submissions',
        populate: {
          path: 'student',
          select: 'name email'
        }
      })
      .populate('classroom', '_id name code subject students');

    // If student, batch-fetch this student's submissions for these assignments (avoids N+1)
    let mySubmissionsMap = new Map();
    if (isStudent) {
      const assignmentIds = assignments.map(a => a._id);
      const studentSubmissions = await Submission.find({
        student: req.user._id,
        assignment: { $in: assignmentIds }
      });
      studentSubmissions.forEach(sub => {
        mySubmissionsMap.set(sub.assignment.toString(), sub);
      });
    }

    // Formatting as requested by frontend
    const formattedAssignments = assignments.map(a => {
      const aObj = a.toObject();
      aObj.createdAt = a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      aObj.name = a.name;
      aObj.title = a.name;

      const isPastDue = isAssignmentPastDue(a.dueDate);

      if (isTeacher) {
        // Teacher status semantics: describes the assignment lifecycle
        const teacherStatus = isPastDue ? 'Past Due' : 'Active';
        aObj.status = teacherStatus;
        aObj.submissionStatus = teacherStatus;
        aObj.isPastDue = isPastDue;
        aObj.totalSubmissions = aObj.submissions ? aObj.submissions.length : 0;
        aObj.reviewedSubmissions = aObj.submissions ? aObj.submissions.filter(s => s.isGraded).length : 0;

        // Also format submissions date for teacher view
        if (aObj.submissions) {
          aObj.submissions = aObj.submissions.map(sub => {
            sub.createdAt = new Date(sub.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return sub;
          });
        }
      } else {
        // Student status semantics: role-aware & submission-aware
        const mySub = mySubmissionsMap.get(a._id.toString());
        const isGraded = mySub && Boolean(mySub.isGraded || (mySub.marks !== null && mySub.marks !== undefined));

        let studentStatus;
        if (isGraded) {
          studentStatus = 'Graded';
        } else if (mySub) {
          studentStatus = 'Submitted';
        } else if (isPastDue) {
          studentStatus = 'Missing';
        } else {
          studentStatus = 'Due';
        }

        aObj.status = studentStatus;
        aObj.submissionStatus = studentStatus;
        aObj.isPastDue = isPastDue;

        if (mySub) {
          aObj.mySubmission = {
            _id: mySub._id,
            isGraded: mySub.isGraded,
            marks: mySub.marks,
            media: mySub.media || [],
            filesMetadata: mySub.filesMetadata || [],
            createdAt: mySub.createdAt
          };
          // Student only receives their own submission in submissions array for security/privacy
          aObj.submissions = [{
            _id: mySub._id,
            marks: mySub.marks,
            isGraded: mySub.isGraded,
            media: mySub.media || [],
            filesMetadata: mySub.filesMetadata || [],
            createdAt: new Date(mySub.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }];
        } else {
          aObj.mySubmission = null;
          aObj.submissions = [];
        }
      }

      return aObj;
    });

    res.json({
      success: true,
      assignment: targetAssignmentId ? formattedAssignments[0] : (formattedAssignments[0] || null),
      assignments: formattedAssignments
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/assignment/create
exports.createAssignment = async (req, res, next) => {
  try {
    const { code, dueDate, name, description } = req.body;

    if (!code || !dueDate || !name) {
      return res.status(400).json({ error: 'code, dueDate, and name are required' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ error: 'Classroom not found' });
    }

    // Only teacher can create assignments
    if (classroom.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the teacher can create assignments' });
    }

    let mediaUrls = [];
    let filesMetadata = [];

    if (req.files && req.files.length > 0) {
      const uploadResults = await Promise.all(
        req.files.map(file => storageService.uploadBuffer(file.buffer, {
          folder: 'Classence/assignments',
          originalname: file.originalname,
          mimetype: file.mimetype
        }))
      );
      mediaUrls = uploadResults.map(r => r.url);
      filesMetadata = uploadResults.map(r => ({ publicId: r.publicId, resourceType: r.resourceType }));
    }

    const assignment = new Assignment({
      name,
      description,
      dueDate,
      media: mediaUrls,
      filesMetadata,
      classroom: classroom._id,
      teacher: req.user._id
    });

    await assignment.save();

    // Notify enrolled students of the classroom (excluding teacher/creator)
    if (classroom.students && classroom.students.length > 0) {
      const studentRecipients = classroom.students.filter(
        sid => sid.toString() !== req.user._id.toString()
      );
      if (studentRecipients.length > 0) {
        notificationService.createBatchNotifications({
          recipientIds: studentRecipients,
          type: 'ASSIGNMENT_CREATED',
          title: 'New Assignment',
          message: `"${assignment.name}" was posted in ${classroom.name}`,
          link: '/assignment-details',
          context: {
            classroomId: classroom._id,
            classCode: classroom.code,
            className: classroom.name,
            assignmentId: assignment._id
          }
        }).catch(err => {
          logger.error('Failed to dispatch assignment notifications:', err.message);
        });
      }
    }

    res.status(201).json({ message: 'Assignment created successfully', assignment });
  } catch (error) {
    next(error);
  }
};

// PUT /api/assignment/edit/:id
exports.editAssignment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { code, dueDate, name, description } = req.body;

    const assignment = await Assignment.findById(id).populate('classroom');
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Only teacher can edit
    if (assignment.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the teacher can edit this assignment' });
    }

    if (name) assignment.name = name;
    if (description) assignment.description = description;
    if (dueDate) assignment.dueDate = dueDate;

    // Handle media: Frontend sends NEW files via multipart.
    // We append new files to the existing media array.
    if (req.files && req.files.length > 0) {
      const uploadResults = await Promise.all(
        req.files.map(file => storageService.uploadBuffer(file.buffer, {
          folder: 'Classence/assignments',
          originalname: file.originalname,
          mimetype: file.mimetype
        }))
      );
      const newMediaUrls = uploadResults.map(r => r.url);
      const newFilesMetadata = uploadResults.map(r => ({ publicId: r.publicId, resourceType: r.resourceType }));

      assignment.media = [...assignment.media, ...newMediaUrls];
      assignment.filesMetadata = [...(assignment.filesMetadata || []), ...newFilesMetadata];
    }

    await assignment.save();

    res.json({ message: 'Assignment updated successfully', assignment });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/assignment/delete
exports.deleteAssignment = async (req, res, next) => {
  try {
    const { id, code } = req.query;

    if (!id || !code) {
      return res.status(400).json({ error: 'id and code query parameters are required' });
    }

    const assignment = await Assignment.findById(id).populate('classroom');
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    if (assignment.classroom.code !== code) {
      return res.status(400).json({ error: 'Classroom code mismatch' });
    }

    // Only teacher can delete
    if (assignment.teacher.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the teacher can delete this assignment' });
    }

    // Safe Cloudinary cleanup of assignment attachments
    if (assignment.filesMetadata && assignment.filesMetadata.length > 0) {
      await storageService.deleteAssets(assignment.filesMetadata);
    }

    // Also clean up submission attachments
    const submissions = await Submission.find({ assignment: id });
    for (const sub of submissions) {
      if (sub.filesMetadata && sub.filesMetadata.length > 0) {
        await storageService.deleteAssets(sub.filesMetadata);
      }
    }
    await Submission.deleteMany({ assignment: id });

    await Assignment.findByIdAndDelete(id);

    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    next(error);
  }
};
