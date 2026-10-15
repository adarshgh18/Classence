const express = require('express');
const router = express.Router();
const assignmentController = require('../controllers/assignment.controller');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

router.use(protect);

router.get('/get', assignmentController.getAssignments);
router.post('/create', upload.array('media', 10), assignmentController.createAssignment);
router.put('/edit/:id', upload.array('media', 10), assignmentController.editAssignment);
router.delete('/delete', assignmentController.deleteAssignment);

module.exports = router;
