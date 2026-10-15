const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { protect } = require('../middleware/auth');
const {
  changePasswordValidator,
  changeNameValidator,
  changeNotificationValidator
} = require('../validators/auth.validators');

// All user routes require authentication
router.use(protect);

// GET /user/details
router.get('/details', userController.getUserDetails);

// GET /user/assignment
router.get('/assignment', userController.getUserAssignments);

// GET /user/dashboard
router.get('/dashboard', userController.getDashboard);

// GET /user/calendar
router.get('/calendar', userController.getCalendar);

// POST /user/settings/change-name
router.post('/settings/change-name', changeNameValidator, userController.changeName);

// POST /user/settings/change-password
router.post('/settings/change-password', changePasswordValidator, userController.changePassword);

// POST /user/settings/sign-out-all-devices
router.post('/settings/sign-out-all-devices', userController.signOutAllDevices);

// POST /user/settings/change-is-notification-enabled
router.post('/settings/change-is-notification-enabled', changeNotificationValidator, userController.changeNotificationSetting);

module.exports = router;
