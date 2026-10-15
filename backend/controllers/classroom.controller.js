const Classroom = require('../models/Classroom');
const User = require('../models/User');
const AppError = require('../utils/appError');
const Lecture = require('../models/Lecture');
const crypto = require('crypto');
const env = require('../config/env');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');

// Generate unique 6-character class code
const generateUniqueCode = async () => {
  let isUnique = false;
  let code = '';
  while (!isUnique) {
    code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const existing = await Classroom.findOne({ code });
    if (!existing) isUnique = true;
  }
  return code;
};

// ==================================================================
// POST /classroom/create
// Auth: required
// Body: { name, subject, privacy }
// ==================================================================
const createClassroom = async (req, res, next) => {
  try {
    const { name, subject, privacy } = req.body;

    if (!name || !subject || !privacy) {
      return res.status(400).json({ success: false, error: 'Please fill in all fields.' });
    }

    const code = await generateUniqueCode();

    const classroom = await Classroom.create({
      name,
      subject,
      privacy,
      code,
      teacher: req.user._id,
      students: []
    });

    // Add to teacher's createdClasses
    await User.findByIdAndUpdate(req.user._id, {
      $push: { createdClasses: classroom._id }
    });

    return res.status(201).json({
      success: true,
      message: 'Class created successfully!',
      classroom
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /classroom/join
// Auth: required
// Body: { code, token? }
// ==================================================================
const joinClassroom = async (req, res, next) => {
  try {
    let { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Class code is required.' });
    }
    
    code = code.toUpperCase().trim();

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found. Please check the code and try again.' });
    }

    if (classroom.teacher.equals(req.user._id)) {
      return res.status(400).json({ success: false, error: 'You are the owner of this class and cannot join as a student.' });
    }

    const isAlreadyMember = classroom.students.some(id => id.equals(req.user._id));
    if (isAlreadyMember) {
      return res.status(400).json({ success: false, error: 'You have already joined this class.' });
    }

    // Add student to classroom
    classroom.students.push(req.user._id);
    await classroom.save();

    // Add classroom to student's joinedClasses ($addToSet ensures duplicate-free)
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { joinedClasses: classroom._id }
    });

    return res.status(200).json({
      success: true,
      message: 'Class joined successfully!'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /classroom/leave
// Auth: required
// Body: { code }
// ==================================================================
const leaveClassroom = async (req, res, next) => {
  try {
    let { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Class code is required.' });
    }

    code = String(code).trim().toUpperCase();

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    // Owner check: Teacher cannot leave their own class as a student
    if (classroom.teacher.equals(req.user._id)) {
      return res.status(400).json({
        success: false,
        error: 'You are the owner of this class and cannot leave it as a student.'
      });
    }

    // Enrolled check: Student must be an enrolled member
    const isEnrolled = classroom.students.some(id => id.equals(req.user._id));
    if (!isEnrolled) {
      return res.status(400).json({
        success: false,
        error: 'You are not enrolled in this class.'
      });
    }

    // Remove student from classroom.students
    classroom.students = classroom.students.filter(id => !id.equals(req.user._id));
    await classroom.save();

    // Remove classroom from student's joinedClasses
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { joinedClasses: classroom._id }
    });

    return res.status(200).json({
      success: true,
      message: 'You have left the class successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// GET /classroom/details
// Auth: required
// Query: ?code=...
// ==================================================================
const getClassroomDetails = async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Class code is required.' });
    }

    const classroom = await Classroom.findOne({ code })
      .populate('teacher', 'name email')
      .populate('students', 'name email');

    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    // Authorization: Must be owner or student
    const isOwner = classroom.teacher._id.equals(req.user._id);
    const isStudent = classroom.students.some(s => s._id.equals(req.user._id));

    if (!isOwner && !isStudent) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this class.' });
    }

    // Phase 7: Fetch announcements
    const Announcement = require('../models/Announcement');
    const announcements = await Announcement.find({ classroom: classroom._id }).sort({ createdAt: -1 });

    const classroomObj = classroom.toObject();
    classroomObj.announcements = announcements;

    return res.status(200).json({
      success: true,
      classroom: classroomObj
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /classroom/invite
// Auth: required
// Body: { email, code }
// ==================================================================
const inviteToClassroom = async (req, res, next) => {
  try {
    let { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and class code are required.' });
    }

    email = String(email).trim().toLowerCase();
    code = String(code).trim().toUpperCase();

    // Validate email syntax
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const classroom = await Classroom.findOne({ code })
      .populate('teacher', 'name email')
      .populate('students', 'email');

    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    // Only owner can invite
    const teacherId = classroom.teacher._id ? classroom.teacher._id : classroom.teacher;
    if (!teacherId.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only the class owner can send invites.' });
    }

    // Reject inviting classroom teacher's own email
    const teacherEmail = (classroom.teacher.email || req.user.email || '').toLowerCase();
    if (teacherEmail && teacherEmail === email) {
      return res.status(400).json({ success: false, error: 'You cannot invite yourself to your own class.' });
    }

    // Reject if already an enrolled student in this classroom
    const isAlreadyMember = classroom.students.some(s => s && s.email && s.email.toLowerCase() === email);
    if (isAlreadyMember) {
      return res.status(400).json({ success: false, error: 'This user is already a member of this class.' });
    }

    // Construct direct invitation / join link
    const encodedCode = encodeURIComponent(code);
    const joinLink = `${env.frontendUrl}/classroom/join/${encodedCode}?code=${encodedCode}`;

    const teacherName = classroom.teacher.name || req.user.name || 'Your Teacher';
    const className = classroom.name;

    try {
      await emailService.sendClassroomInviteEmail({
        to: email,
        className,
        teacherName,
        classCode: code,
        joinLink
      });
      logger.info(`Classroom invite sent to ${email} for class ${code}`);
    } catch (sendError) {
      logger.error(`Failed to dispatch classroom invite email to ${email} for class ${code}: ${sendError.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to send invitation email. Please check your email configuration or try again later.'
      });
    }

    return res.status(200).json({
      success: true,
      message: `Invitation sent successfully to ${email}`
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /classroom/remove
// Auth: required
// Body: { code, studentId }
// ==================================================================
const removeStudent = async (req, res, next) => {
  try {
    const { code, studentId } = req.body;
    if (!code || !studentId) {
      return res.status(400).json({ success: false, error: 'Class code and studentId are required.' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    // Only owner can remove
    if (!classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only the class owner can remove students.' });
    }

    // Remove from classroom
    classroom.students = classroom.students.filter(id => !id.equals(studentId));
    await classroom.save();

    // Remove from student's joinedClasses
    await User.findByIdAndUpdate(studentId, {
      $pull: { joinedClasses: classroom._id }
    });

    return res.status(200).json({
      success: true,
      message: 'Student removed successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /classroom/delete
// Auth: required
// Body: { code }
// ==================================================================
const deleteClassroom = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Class code is required.' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    // Only owner can delete
    if (!classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only the class owner can delete the class.' });
    }

    // Remove from owner's createdClasses
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { createdClasses: classroom._id }
    });

    // Remove from all students' joinedClasses
    for (const studentId of classroom.students) {
      await User.findByIdAndUpdate(studentId, {
        $pull: { joinedClasses: classroom._id }
      });
    }

    // Delete classroom
    await Classroom.findByIdAndDelete(classroom._id);

    return res.status(200).json({
      success: true,
      message: 'Class deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// GET /classroom/attendance
// Auth: required
// Query: ?classCode=...
// ==================================================================
const getAttendance = async (req, res, next) => {
  try {
    const { classCode } = req.query;
    if (!classCode) {
      return res.status(400).json({ success: false, error: 'Class code is required.' });
    }

    const classroom = await Classroom.findOne({ code: classCode });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    const isTeacher = classroom.teacher.equals(req.user._id);
    const isStudent = classroom.students.some(id => id.equals(req.user._id));

    if (!isTeacher && !isStudent) {
      return res.status(403).json({ success: false, error: 'Not authorized to view attendance.' });
    }

    const lectures = await Lecture.find({ classroom: classroom._id })
      .populate('attendance.student', 'name')
      .sort({ startTime: 1 });

    const completedLectures = lectures.filter(
      lecture => lecture.status === 'completed'
    );

    if (isTeacher) {
      let totalPresent = 0;
      let totalAbsent = 0;
      const enrolledStudentIds = new Set(classroom.students.map(id => id.toString()));
      const totalEnrolled = classroom.students.length;

      const lectureData = completedLectures.map(l => {
        const presentStudents = l.attendance.map(a => ({
          name: a.student && a.student.name ? a.student.name : 'Unknown'
        }));
        const lecturePresent = l.attendance.length;
        totalPresent += lecturePresent;

        // Valid enrolled students who attended this lecture (duplicate-safe)
        const uniquePresentEnrolledIds = new Set();
        l.attendance.forEach(a => {
          const sId = (a.student && a.student._id) ? a.student._id.toString() : (a.student ? a.student.toString() : null);
          if (sId && enrolledStudentIds.has(sId)) {
            uniquePresentEnrolledIds.add(sId);
          }
        });

        const lectureAbsent = Math.max(0, totalEnrolled - uniquePresentEnrolledIds.size);
        totalAbsent += lectureAbsent;

        return {
          title: l.title,
          date: l.date,
          time: l.time,
          totalPresent: lecturePresent,
          presentStudents
        };
      });

      const recent7 = completedLectures.slice(-7);
      const last7Lectures = recent7.map(l => ({
        date: l.date,
        attendance: l.attendance.length
      }));

      return res.status(200).json({
        success: true,
        isTeacher: true,
        totalPresent,
        totalAbsent,
        last7Lectures,
        lectureData
      });
    }

    // Student logic
    const studentId = req.user._id;
    let totalPresent = 0;
    let totalAbsent = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const lectureData = completedLectures.map(l => {
      const present = l.attendance.some(a => {
        const sId = (a.student && a.student._id) ? a.student._id : a.student;
        return sId && sId.equals(studentId);
      });
      if (present) {
        totalPresent++;
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
      } else {
        totalAbsent++;
        tempStreak = 0;
      }
      return {
        title: l.title,
        date: l.date,
        time: l.time,
        attendance: present ? 'Present' : 'Absent'
      };
    });

    currentStreak = tempStreak;

    return res.status(200).json({
      success: true,
      isTeacher: false,
      totalPresent,
      totalAbsent,
      currentStreak,
      longestStreak,
      lectureData
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createClassroom,
  joinClassroom,
  leaveClassroom,
  getClassroomDetails,
  inviteToClassroom,
  removeStudent,
  deleteClassroom,
  getAttendance
};
