const express = require('express');
const router = express.Router();
const lectureController = require('../controllers/lecture.controller');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', lectureController.getLectures);
router.post('/create', lectureController.createLecture);
// Using POST or PATCH for update based on frontend requirement, but I will provide PATCH 
// Wait, the frontend uses axios.patch('/lecture/update')
router.patch('/update', lectureController.updateLecture);
router.delete('/delete', lectureController.deleteLecture);

router.post('/start-live-session', lectureController.startLiveSession);
router.post('/stop-live-session', lectureController.stopLiveSession);
router.post('/complete-lecture', lectureController.completeLecture);
router.post('/mark', lectureController.markAttendance);

module.exports = router;
