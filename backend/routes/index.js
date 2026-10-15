const express = require('express');
const router = express.Router();
const healthRoutes = require('./health.routes');
const assignmentRoutes = require('./assignment.routes');
const submissionRoutes = require('./submission.routes');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const classroomRoutes = require('./classroom.routes');

// System Health Check
router.use('/health', healthRoutes);

// Phase 2: Authentication + User
router.use('/auth', authRoutes);
router.use('/user', userRoutes);

// Phase 3: Classroom Management
router.use('/classroom', classroomRoutes);
router.use('/assignment', assignmentRoutes);
router.use('/submission', submissionRoutes);

// Future Phase Routes:
const lectureRoutes = require('./lecture.routes');
// Phase 5:
router.use('/lecture', lectureRoutes);
const todoRoutes = require('./todo.routes');
const reminderRoutes = require('./reminder.routes');
// Phase 5: router.use('/attendance', attendanceRoutes);
// Phase 5: router.use('/calendar', calendarRoutes);
// Phase 6:
router.use('/todo', todoRoutes);
router.use('/reminder', reminderRoutes);
const announcementRoutes = require('./announcement.routes');
// Phase 7:
router.use('/announcement', announcementRoutes);

// Phase 2 Notification System:
const notificationRoutes = require('./notification.routes');
router.use('/notification', notificationRoutes);

module.exports = router;
