const express = require('express');
const router = express.Router();
const classroomController = require('../controllers/classroom.controller');
const { protect } = require('../middleware/auth');

// All classroom routes require authentication
router.use(protect);

// POST /classroom/create
router.post('/create', classroomController.createClassroom);

// POST /classroom/join
router.post('/join', classroomController.joinClassroom);

// POST /classroom/leave
router.post('/leave', classroomController.leaveClassroom);

// GET /classroom/details
router.get('/details', classroomController.getClassroomDetails);

// POST /classroom/invite
router.post('/invite', classroomController.inviteToClassroom);

// POST /classroom/remove
router.post('/remove', classroomController.removeStudent);

// POST /classroom/delete
router.post('/delete', classroomController.deleteClassroom);

// GET /classroom/attendance
router.get('/attendance', classroomController.getAttendance);

module.exports = router;
