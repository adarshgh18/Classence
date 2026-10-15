const express = require('express');
const router = express.Router();
const submissionController = require('../controllers/submission.controller');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

router.use(protect);

router.get('/my-submission', submissionController.getMySubmission);
router.post('/create', upload.array('media', 10), submissionController.createSubmission);
router.post('/grade', submissionController.gradeSubmission);

module.exports = router;
