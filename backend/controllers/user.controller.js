const User = require('../models/User');
const Classroom = require('../models/Classroom');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Lecture = require('../models/Lecture');
const { signToken } = require('../middleware/auth');
const AppError = require('../utils/appError');

// ==================================================================
// GET /user/details
// Auth: Bearer token required
//
// Frontend reads (dashboard.jsx):
//   response.data.success
//   response.data.user._id          → sessionStorage.setItem('userId', ...)
//   response.data.user.name         → dispatch(setUserName)
//   response.data.user.email        → dispatch(setUserMail)
//   response.data.user.joinedClasses  → dispatch(setJoinedClasses)
//   response.data.user.createdClasses → dispatch(setCreatedClasses)
//   response.data.user.noOfJoinedClasses  → dispatch(setNoOfJoinedClasses)
//   response.data.user.noOfCreatedClasses → dispatch(setNoOfCreatedClasses)
// ==================================================================
const getUserDetails = async (req, res, next) => {
  try {
    // req.user attached by protect middleware (without sensitive fields)
    const user = await User.findById(req.user._id)
      .populate({
        path: 'joinedClasses',
        select: '_id name code subject teacher students privacy',
        populate: { path: 'teacher', select: 'name' }
      })
      .populate({
        path: 'createdClasses',
        select: '_id name code subject teacher students privacy',
        populate: { path: 'teacher', select: 'name' }
      });

    if (!user) {
      return next(new AppError('User not found.', 404));
    }

    return res.status(200).json({
      success: true,
      user: user.toPublicJSON()
    });
  } catch (error) {
    next(error);
  }
};

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

// ==================================================================
// GET /user/assignment
// Auth: Bearer token required
// ==================================================================
const getUserAssignments = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('joinedClasses createdClasses');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const joinedIds = user.joinedClasses.map(c => c._id);
    const createdIds = user.createdClasses.map(c => c._id);

    // Fetch assignments
    const joinedAssignments = await Assignment.find({ classroom: { $in: joinedIds } })
      .sort({ createdAt: -1 })
      .populate('classroom');
    const createdAssignments = await Assignment.find({ classroom: { $in: createdIds } })
      .sort({ createdAt: -1 })
      .populate('classroom');

    // Helper to format assignments
    const formatAssignments = (assignments, submissions, isTeacher = false) => {
      let completed = 0;
      let active = 0;
      let dueSoon = 0;
      let overdue = 0;
      
      const now = new Date();
      now.setHours(0,0,0,0);

      const submissionsMap = new Map();
      if (submissions && submissions.length > 0) {
        submissions.forEach(sub => {
          submissionsMap.set(sub.assignment.toString(), sub);
        });
      }
      
      const formatted = assignments.map(a => {
        const dueDate = new Date(a.dueDate);
        const timeDiff = dueDate.getTime() - now.getTime();
        const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));
        
        const mySub = submissionsMap.get(a._id.toString());
        const hasSubmitted = Boolean(mySub);
        const isGraded = mySub && Boolean(mySub.isGraded || (mySub.marks !== null && mySub.marks !== undefined));
        const isPastDue = isAssignmentPastDue(a.dueDate);

        let status;
        if (isTeacher) {
          status = isPastDue ? 'Past Due' : 'Active';
          if (isPastDue) {
            overdue++;
          } else {
            active++;
            if (daysDiff <= 3 && daysDiff >= 0) {
              dueSoon++;
            }
          }
        } else {
          // Student role status semantics
          if (isGraded) {
            status = 'Graded';
          } else if (hasSubmitted) {
            status = 'Submitted';
          } else if (isPastDue) {
            status = 'Missing';
          } else {
            status = 'Due';
          }

          if (hasSubmitted) {
            completed++;
          } else if (isPastDue) {
            overdue++;
          } else if (daysDiff <= 3) {
            dueSoon++;
          }
        }

        return {
          _id: a._id,
          name: a.name,
          title: a.name, // Frontend expects 'title'
          classroomSubject: a.classroom ? (a.classroom.subject || a.classroom.name) : '',
          dueDate: a.dueDate,
          createdAt: a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
          description: a.description || '',
          media: a.media || [],
          classroom: a.classroom ? {
            _id: a.classroom._id,
            name: a.classroom.name,
            code: a.classroom.code,
            subject: a.classroom.subject
          } : null,
          status,
          submissionStatus: status,
          isPastDue,
          marks: (mySub && (mySub.marks !== null && mySub.marks !== undefined)) ? mySub.marks : null,
          mySubmission: mySub ? {
            _id: mySub._id,
            isGraded: mySub.isGraded,
            marks: mySub.marks,
            media: mySub.media || [],
            filesMetadata: mySub.filesMetadata || [],
            createdAt: mySub.createdAt
          } : null,
          submissions: mySub ? [{
            _id: mySub._id,
            marks: mySub.marks,
            isGraded: mySub.isGraded,
            createdAt: new Date(mySub.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }] : []
        };
      });

      return {
        allAssignments: formatted,
        activeAssignments: active,
        completedAssignments: isTeacher ? active : completed,
        dueSoonAssignments: dueSoon,
        overdueAssignments: overdue
      };
    };

    // Submissions for joined classes to calculate status
    const mySubmissions = await Submission.find({
      student: req.user._id,
      assignment: { $in: joinedAssignments.map(a => a._id) }
    });

    const joinedData = formatAssignments(joinedAssignments, mySubmissions, false);
    const createdData = formatAssignments(createdAssignments, [], true);

    // Recent grades
    const gradedSubmissions = await Submission.find({
      student: req.user._id,
      isGraded: true
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate({
        path: 'assignment',
        populate: {
          path: 'classroom',
          select: '_id name code subject'
        }
      });
    
    const validGradedSubmissions = gradedSubmissions.filter(sub => sub.assignment);

    const recentGrades = validGradedSubmissions.map(sub => `${sub.assignment.name}: ${sub.marks}/10`);

    const recentGradesDetails = validGradedSubmissions.map(sub => ({
      assignmentId: sub.assignment._id,
      title: sub.assignment.name,
      marks: sub.marks,
      maxMarks: 10,
      formattedGrade: `${sub.assignment.name}: ${sub.marks}/10`,
      assignment: {
        _id: sub.assignment._id,
        name: sub.assignment.name,
        title: sub.assignment.name,
        dueDate: sub.assignment.dueDate,
        createdAt: sub.assignment.createdAt ? new Date(sub.assignment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
        description: sub.assignment.description || '',
        media: sub.assignment.media || [],
        classroom: sub.assignment.classroom ? {
          _id: sub.assignment.classroom._id,
          name: sub.assignment.classroom.name,
          code: sub.assignment.classroom.code,
          subject: sub.assignment.classroom.subject
        } : null,
        status: 'Graded',
        submissionStatus: 'Graded',
        marks: sub.marks,
        isHistorical: !sub.assignment.classroom,
        mySubmission: {
          _id: sub._id,
          isGraded: true,
          marks: sub.marks,
          media: sub.media || [],
          filesMetadata: sub.filesMetadata || [],
          createdAt: sub.createdAt
        }
      }
    }));

    return res.json({
      user: {
        recentGrades,
        recentGradesDetails,
        joinedClassrooms: joinedData,
        createdClassrooms: createdData
      }
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// GET /user/dashboard
// Auth: Bearer token required
//
// dashboard.jsx calls both /user/details AND /user/dashboard, then checks:
//   response2.data.success === true
// Phase 2: return an empty-but-success dashboard stub.
// Business aggregations (assignments, attendance, etc.) come in later phases.
// ==================================================================
const getDashboard = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('joinedClasses createdClasses');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    
    const buildClassroomStats = async (classrooms, isTeacher) => {
      const assignments = [];
      const averageAttendance = [];
      const dueSoonAssignments = [];
      let completedTotalAssignments = 0;
      let dueSoonTotalAssignments = 0;
      let overdueTotalAssignments = 0;
      
      const now = new Date();
      now.setHours(0,0,0,0);
      
      for (const classroom of classrooms) {
        if (!classroom || !classroom._id) continue;

        const clsAssignments = await Assignment.find({ classroom: classroom._id }).sort({ createdAt: -1 });
        const formattedAssignments = [];
        
        // Enrolled students in current classroom
        const enrolledStudentIds = new Set((classroom.students || []).map(s => s.toString()));
        const enrolledStudentsCount = enrolledStudentIds.size;

        for (const assignment of clsAssignments) {
          const subs = await Submission.find({ assignment: assignment._id });
          const actualTotalSubmissions = subs.length;
          const reviewedSubmissions = subs.filter(s => s.isGraded || (s.marks !== null && s.marks !== undefined)).length;
          const pendingReviews = actualTotalSubmissions - reviewedSubmissions;
          
          // Unique enrolled students who submitted (for authoritative completion percentage)
          const uniqueEnrolledSubmitters = new Set(
            subs
              .map(s => (s.student ? s.student.toString() : null))
              .filter(sid => sid && enrolledStudentIds.has(sid))
          ).size;

          let completionPercentage = 0;
          if (enrolledStudentsCount > 0) {
            completionPercentage = Math.round((uniqueEnrolledSubmitters / enrolledStudentsCount) * 100);
          }

          let isGraded = false;
          let hasSubmitted = false;
          if (!isTeacher) {
             const mySub = subs.find(s => s.student.toString() === req.user._id.toString());
             hasSubmitted = Boolean(mySub);
             isGraded = mySub ? Boolean(mySub.isGraded || (mySub.marks !== null && mySub.marks !== undefined)) : false;
          } else {
             isGraded = (actualTotalSubmissions > 0 && reviewedSubmissions === actualTotalSubmissions);
          }
          
          const isPastDue = isAssignmentPastDue(assignment.dueDate);
          let daysDiff = 0;
          if (assignment.dueDate) {
            const trimmed = String(assignment.dueDate).trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
              const [y, m, d] = trimmed.split('-').map(Number);
              const dueObj = new Date(y, m - 1, d);
              daysDiff = Math.ceil((dueObj.getTime() - now.getTime()) / (1000 * 3600 * 24));
            } else {
              const parsed = new Date(trimmed);
              if (!isNaN(parsed.getTime())) {
                daysDiff = Math.ceil((parsed.getTime() - now.getTime()) / (1000 * 3600 * 24));
              }
            }
          }

          if (!isTeacher) {
            if (hasSubmitted) {
              completedTotalAssignments++;
            } else if (isPastDue) {
              overdueTotalAssignments++;
            } else if (daysDiff <= 3 && daysDiff >= 0) {
              dueSoonTotalAssignments++;
            }
          } else {
            if (isPastDue) {
              overdueTotalAssignments++;
            } else {
              completedTotalAssignments++;
              if (daysDiff <= 3 && daysDiff >= 0) {
                dueSoonTotalAssignments++;
              }
            }
          }

          formattedAssignments.push({
             _id: assignment._id,
             title: assignment.name,
             dueDate: assignment.dueDate,
             isGraded,
             hasSubmitted,
             isPastDue,
             status: !isTeacher 
               ? (isGraded ? 'Graded' : hasSubmitted ? 'Submitted' : isPastDue ? 'Missing' : 'Due')
               : (isPastDue ? 'Past Due' : 'Active'),
             createdAt: assignment.createdAt,
             totalSubmissions: actualTotalSubmissions,
             reviewedSubmissions,
             pendingReviews,
             completionPercentage,
             totalStudents: enrolledStudentsCount
          });
          
          if (!isTeacher) {
            // Student Due Soon: unsubmitted, not past due, within 3 days
            if (!isPastDue && daysDiff <= 3 && daysDiff >= 0 && !hasSubmitted) {
               dueSoonAssignments.push({
                 _id: assignment._id,
                 name: assignment.name,
                 title: assignment.name,
                 classroomSubject: classroom.subject || classroom.name,
                 classCode: classroom.code,
                 className: classroom.name,
                 classroom: {
                   _id: classroom._id,
                   name: classroom.name,
                   code: classroom.code,
                   subject: classroom.subject
                 },
                 dueDate: assignment.dueDate,
                 reviewedSubmissions,
                 totalSubmissions: actualTotalSubmissions,
                 isGraded,
                 hasSubmitted,
                 createdAt: assignment.createdAt
               });
            }
          } else {
            // Teacher Review Queue: included IF AND ONLY IF pendingReviews > 0
            if (pendingReviews > 0) {
               dueSoonAssignments.push({
                 _id: assignment._id,
                 name: assignment.name,
                 title: assignment.name,
                 classroomSubject: classroom.subject || classroom.name,
                 classCode: classroom.code,
                 className: classroom.name,
                 classroom: {
                   _id: classroom._id,
                   name: classroom.name,
                   code: classroom.code,
                   subject: classroom.subject
                 },
                 dueDate: assignment.dueDate,
                 reviewedSubmissions,
                 totalSubmissions: actualTotalSubmissions,
                 pendingReviews,
                 isGraded,
                 hasSubmitted,
                 createdAt: assignment.createdAt
               });
            }
          }
        }
        
        if (formattedAssignments.length > 0) {
          assignments.push({
            classroomSubject: classroom.subject || classroom.name,
            assignments: formattedAssignments
          });
        }
        
        // Attendance - ONLY completed lectures contribute to finalized attendance
        const completedLectures = await Lecture.find({ classroom: classroom._id, status: 'completed' });
        if (completedLectures.length > 0) {
           let attPercentage = 0;
           if (!isTeacher) {
              const attendedLectures = completedLectures.filter(l => 
                l.attendance && l.attendance.some(a => {
                  const sId = (a.student && a.student._id) ? a.student._id.toString() : (a.student ? a.student.toString() : null);
                  return sId === req.user._id.toString();
                })
              ).length;
              attPercentage = (attendedLectures / completedLectures.length) * 100;
           } else {
              let totalAttended = 0;
              let possibleAttends = completedLectures.length * (classroom.students ? classroom.students.length : 0);
              if (possibleAttends > 0) {
                 completedLectures.forEach(l => { 
                   if (l.attendance) totalAttended += l.attendance.length; 
                 });
                 attPercentage = (totalAttended / possibleAttends) * 100;
              }
           }
           averageAttendance.push({
              className: classroom.subject || classroom.name,
              date: classroom.createdAt,
              attendance: attPercentage,
              totalLectures: completedLectures.length,
              attendedLectures: !isTeacher ? completedLectures.filter(l => 
                l.attendance && l.attendance.some(a => {
                  const sId = (a.student && a.student._id) ? a.student._id.toString() : (a.student ? a.student.toString() : null);
                  return sId === req.user._id.toString();
                })
              ).length : undefined
           });
        } else {
           averageAttendance.push({
              className: classroom.subject || classroom.name,
              date: classroom.createdAt,
              attendance: 0,
              totalLectures: 0,
              attendedLectures: 0
           });
        }
      }
      
      return { 
        assignments, 
        averageAttendance, 
        dueSoonAssignments,
        stats: {
          completedTotalAssignments,
          dueSoonTotalAssignments,
          overdueTotalAssignments
        }
      };
    };

    const validJoinedClasses = (user.joinedClasses || []).filter(c => c && c._id);
    const validCreatedClasses = (user.createdClasses || []).filter(c => c && c._id);

    const joined = await buildClassroomStats(validJoinedClasses, false);
    const created = await buildClassroomStats(validCreatedClasses, true);

    const formatUpcomingLectures = async (classIds) => {
      if (!classIds || classIds.length === 0) return [];
      const upcomingLectures = await Lecture.find({
        classroom: { $in: classIds },
        status: 'upcoming'
      })
        .sort({ startTime: 1, date: 1, time: 1 })
        .limit(5)
        .populate({
          path: 'classroom',
          select: '_id name subject code teacher students'
        })
        .populate('teacher', 'name email');

      return upcomingLectures.map(l => {
        const cls = l.classroom || {};
        const teacherObj = l.teacher || cls.teacher || {};
        return {
          _id: l._id,
          lectureId: l._id,
          title: l.title,
          description: l.description || '',
          date: l.date,
          time: l.time,
          startTime: l.startTime,
          status: l.status,
          subject: cls.subject || cls.name || '',
          classroomSubject: cls.subject || cls.name || '',
          classroomId: cls._id,
          classCode: cls.code || '',
          classroom: {
            _id: cls._id,
            name: cls.name,
            subject: cls.subject,
            code: cls.code
          },
          teacher: {
            _id: teacherObj._id,
            name: teacherObj.name || 'Teacher',
            email: teacherObj.email
          },
          students: cls.students || []
        };
      });
    };

    const joinedUpcoming = await formatUpcomingLectures(validJoinedClasses.map(c => c._id));
    const createdUpcoming = await formatUpcomingLectures(validCreatedClasses.map(c => c._id));

    return res.status(200).json({
      success: true,
      message: 'Dashboard data',
      details: {
        name: user.name,
        joined: {
          ...joined,
          upcomingClasses: joinedUpcoming
        },
        created: {
          ...created,
          upcomingClasses: createdUpcoming
        }
      },
      user: {
        recentClasses: joinedUpcoming
      }
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// GET /user/calendar
// Auth: Bearer token required
//
// calenderComp.jsx calls this and expects:
//   response.data.details.joined (array of classes with assignments/lectures)
//   response.data.details.created (array of classes with lectures)
// 
// Phase 2: Return a safe empty structure since Classroom/Lecture domain 
// is implemented in Phase 3/5.
// ==================================================================
const getCalendar = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('joinedClasses')
      .populate('createdClasses');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Null safety: filter out any deleted/unpopulated classrooms
    const validJoined = (user.joinedClasses || []).filter(c => c && c._id);
    const validCreated = (user.createdClasses || []).filter(c => c && c._id);

    const allClassroomIds = [...validJoined, ...validCreated].map(c => c._id);

    // Batch query all assignments and lectures in parallel (avoids N+1 sequential queries)
    const [allAssignments, allLectures] = await Promise.all([
      allClassroomIds.length > 0
        ? Assignment.find({ classroom: { $in: allClassroomIds } }).sort({ dueDate: 1 }).lean()
        : [],
      allClassroomIds.length > 0
        ? Lecture.find({ classroom: { $in: allClassroomIds } }).sort({ startTime: 1 }).lean()
        : []
    ]);

    const assignmentsByClassroom = new Map();
    for (const a of allAssignments) {
      const cid = a.classroom.toString();
      if (!assignmentsByClassroom.has(cid)) assignmentsByClassroom.set(cid, []);
      assignmentsByClassroom.get(cid).push({
        ...a,
        title: a.title || a.name || '',
        formattedDueDate: a.dueDate ? `${a.dueDate}` : ''
      });
    }

    const lecturesByClassroom = new Map();
    for (const l of allLectures) {
      const cid = l.classroom.toString();
      if (!lecturesByClassroom.has(cid)) lecturesByClassroom.set(cid, []);
      lecturesByClassroom.get(cid).push({
        ...l,
        formattedStartTime: l.time || ''
      });
    }

    const mapClassrooms = (classrooms) => classrooms.map(c => {
      const cObj = typeof c.toObject === 'function' ? c.toObject() : c;
      const cid = cObj._id.toString();
      return {
        ...cObj,
        assignments: assignmentsByClassroom.get(cid) || [],
        lectures: lecturesByClassroom.get(cid) || []
      };
    });

    const joined = mapClassrooms(validJoined);
    const created = mapClassrooms(validCreated);

    return res.status(200).json({
      success: true,
      details: {
        joined,
        created
      }
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /user/settings/change-name
// Auth: Bearer token required
//
// Two callers in the frozen frontend:
//   settings.jsx       → { name: editedName }
//   changeNameModal.jsx → { newName: newName }
//
// Backend MUST accept EITHER field name.
// ==================================================================
const changeName = async (req, res, next) => {
  try {
    // Accept either field name (both callers in frozen frontend)
    const newName = req.body.name || req.body.newName;

    if (!newName || !newName.trim()) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }
    if (newName.trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Name must be at least 3 characters.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name: newName.trim() },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Name updated successfully.',
      user: user.toPublicJSON()
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /user/settings/change-password
// Auth: Bearer token required
// Body: { oldPassword, newPassword }
//
// changePasswordModal.jsx reads on success:
//   response.data.token  → localStorage.setItem('authToken', token)
//   response.data.message
// changePasswordModal.jsx reads on error:
//   err.response.data.message
// ==================================================================
const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both old and new password are required.' });
    }

    // Fetch password hash explicitly
    const user = await User.findById(req.user._id).select('+password +tokenVersion');
    if (!user) return next(new AppError('User not found.', 404));

    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Old password is incorrect.' });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from the current password.' });
    }

    // Update and issue a fresh token (frontend replaces stored token)
    user.password = newPassword;  // pre-save hook hashes
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    const token = signToken(user._id, user.tokenVersion);

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully! Please use your new password next time.',
      token
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /user/settings/sign-out-all-devices
// Auth: Bearer token required
// Body: {} (empty)
//
// settings.jsx checks: response.status === 200
// Mechanism: increment tokenVersion → all existing JWTs are rejected
//            by the protect middleware tokenVersion check.
// ==================================================================
const signOutAllDevices = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });

    return res.status(200).json({
      success: true,
      message: 'Signed out from all devices successfully.'
    });
  } catch (error) {
    next(error);
  }
};

// ==================================================================
// POST /user/settings/change-is-notification-enabled
// Auth: Bearer token required
// Body: { isNotification: boolean }
//
// settings.jsx: handleNotificationSetting(isOn) → { isNotification: isOn }
// ==================================================================
const changeNotificationSetting = async (req, res, next) => {
  try {
    const { isNotification } = req.body;

    if (typeof isNotification !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isNotification must be a boolean.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { isNotification },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: `Notifications ${isNotification ? 'enabled' : 'disabled'}.`,
      isNotification: user.isNotification
    });
  } catch (error) {
    next(error);
  }
};

Object.assign(module.exports, {
  getUserDetails,
  getUserAssignments,
  getDashboard,
  getCalendar,
  changeName,
  changePassword,
  signOutAllDevices,
  changeNotificationSetting
});
