const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcement.controller');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
 });

router.use(protect);

router.post('/create', upload.array('media', 5), announcementController.createAnnouncement);
router.put('/edit/:id', upload.array('media', 5), announcementController.editAnnouncement);
router.delete('/delete/:id', announcementController.deleteAnnouncement);

module.exports = router;
