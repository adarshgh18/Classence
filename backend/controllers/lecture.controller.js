const Lecture = require('../models/Lecture');
const Classroom = require('../models/Classroom');
const User = require('../models/User');
const { getIO } = require('../sockets');
const notificationService = require('../services/notification.service');
const logger = require('../utils/logger');

const getLectures = async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Class code is required.' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    const isTeacher = classroom.teacher.equals(req.user._id);
    const isStudent = classroom.students.some(id => id.equals(req.user._id));

    if (!isTeacher && !isStudent) {
      return res.status(403).json({ success: false, error: 'Not authorized to view lectures.' });
    }

    const futureLectures = await Lecture.find({
      classroom: classroom._id,
      status: { $ne: 'completed' }
    })
      .populate('teacher', '_id name')
      .sort({ startTime: 1 });

    const completedLectures = await Lecture.find({
      classroom: classroom._id,
      status: 'completed'
    })
      .populate('teacher', '_id name')
      .sort({ startTime: -1 });

    return res.status(200).json({
      success: true,
      futureLectures,
      completedLectures
    });
  } catch (error) {
    next(error);
  }
};

const createLecture = async (req, res, next) => {
  try {
    const { title, description, date, time, code } = req.body;
    
    if (!title || !description || !date || !time || !code) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ success: false, error: 'Class not found.' });
    }

    if (!classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only teacher can create lectures.' });
    }

    let startTime;
    try {
      startTime = new Date(`${date}T${time}`);
    } catch(err) {
      startTime = new Date();
    }

    const lecture = new Lecture({
      title,
      description,
      date,
      time,
      startTime,
      classroom: classroom._id,
      teacher: req.user._id
    });

    await lecture.save();

    // Notify enrolled students of the classroom (excluding creator/teacher)
    if (classroom.students && classroom.students.length > 0) {
      const studentRecipients = classroom.students.filter(
        sid => sid.toString() !== req.user._id.toString()
      );
      if (studentRecipients.length > 0) {
        notificationService.createBatchNotifications({
          recipientIds: studentRecipients,
          type: 'LECTURE_SCHEDULED',
          title: 'Lecture Scheduled',
          message: `"${lecture.title}" was scheduled in ${classroom.name}`,
          link: '/calendar',
          context: {
            classroomId: classroom._id,
            classCode: classroom.code,
            className: classroom.name,
            lectureId: lecture._id
          }
        }).catch(err => {
          logger.error('Failed to dispatch lecture scheduled notifications:', err.message);
        });
      }
    }

    return res.status(201).json({ success: true, lecture });
  } catch (error) {
    next(error);
  }
};

const updateLecture = async (req, res, next) => {
  try {
    const { lectureId } = req.query;
    const { title, description, date, time, code } = req.body;

    if (!lectureId) {
      return res.status(400).json({ success: false, error: 'Lecture ID is required.' });
    }

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) {
      return res.status(404).json({ success: false, error: 'Lecture not found.' });
    }

    if (!lecture.classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only teacher can update lectures.' });
    }

    if (title) lecture.title = title;
    if (description) lecture.description = description;
    if (date) lecture.date = date;
    if (time) lecture.time = time;
    if (date || time) {
      try {
        lecture.startTime = new Date(`${lecture.date}T${lecture.time}`);
      } catch(err) {}
    }

    await lecture.save();
    return res.status(200).json({ success: true, lecture });
  } catch (error) {
    next(error);
  }
};

const deleteLecture = async (req, res, next) => {
  try {
    const { lectureId } = req.query;
    if (!lectureId) {
      return res.status(400).json({ success: false, error: 'Lecture ID is required.' });
    }

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) {
      return res.status(404).json({ success: false, error: 'Lecture not found.' });
    }

    if (!lecture.classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only teacher can delete lectures.' });
    }

    await Lecture.findByIdAndDelete(lectureId);
    return res.status(200).json({ success: true, message: 'Lecture deleted' });
  } catch (error) {
    next(error);
  }
};

const startLiveSession = async (req, res, next) => {
  try {
    const { lectureId } = req.body;
    if (!lectureId) return res.status(400).json({ success: false, error: 'Lecture ID required.' });

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) return res.status(404).json({ success: false, error: 'Lecture not found.' });

    if (!lecture.classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only teacher can start live session.' });
    }

    if (lecture.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot start a completed lecture.'
      });
    }

    const currentStatus = lecture.status || 'upcoming';
    const isFirstStart = currentStatus === 'upcoming';

    // Only enforce 15-minute start rule on first start
    if (isFirstStart) {
      const now = Date.now();
      const startTime = new Date(lecture.startTime).getTime();
      const earliestStart = startTime - (15 * 60 * 1000);

      if (now < earliestStart) {
        return res.status(400).json({
          success: false,
          error: 'Lecture can be started only within 15 minutes of its scheduled time.'
        });
      }
    }

    lecture.isLive = true;
    lecture.status = 'live';
    await lecture.save();

    try {
      const io = getIO();
      const eventName = isFirstStart ? 'lecture-started' : 'lecture-resumed';
      io.to(`classroom-${lecture.classroom.code}`).emit(eventName, {
        lectureId: lecture._id.toString(),
        status: 'live',
        isLive: true
      });
      io.to(`lecture-${lectureId}`).emit(eventName, {
        lectureId: lecture._id.toString(),
        status: 'live',
        isLive: true
      });
    } catch (err) {
      // Ignore if socket server not initialized in certain test environments
    }

    return res.status(200).json({ success: true, lecture });
  } catch (error) {
    next(error);
  }
};

const stopLiveSession = async (req, res, next) => {
  try {
    const { lectureId } = req.body;
    if (!lectureId) return res.status(400).json({ success: false, error: 'Lecture ID required.' });

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) return res.status(404).json({ success: false, error: 'Lecture not found.' });

    if (!lecture.classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only teacher can stop live session.' });
    }

    if (lecture.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Lecture is already completed.' });
    }

    lecture.isLive = false;
    lecture.status = 'paused';
    await lecture.save();

    try {
      const io = getIO();
      // Room-scoped lifecycle event to lecture room
      io.to(`lecture-${lectureId}`).emit('lecture-paused', { lectureId: lectureId.toString() });
      // Classroom-scoped event for Schedule synchronization
      io.to(`classroom-${lecture.classroom.code}`).emit('lecture-paused', {
        lectureId: lectureId.toString(),
        status: 'paused',
        isLive: false
      });
    } catch (err) {
      // Ignore if socket server not initialized in certain test environments
    }

    return res.status(200).json({ success: true, lecture });
  } catch (error) {
    next(error);
  }
};

const completeLecture = async (req, res, next) => {
  try {
    const { lectureId } = req.body;
    if (!lectureId) return res.status(400).json({ success: false, error: 'Lecture ID required.' });

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) return res.status(404).json({ success: false, error: 'Lecture not found.' });

    if (!lecture.classroom.teacher.equals(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Only teacher can complete the lecture.' });
    }

    if (lecture.status === 'completed') {
      return res.status(200).json({ success: true, message: 'Lecture is already completed.', lecture });
    }

    lecture.isLive = false;
    lecture.status = 'completed';
    await lecture.save();

    try {
      const io = getIO();
      io.to(`lecture-${lectureId}`).emit('lecture-completed', { lectureId: lectureId.toString() });
      io.to(`lecture-${lectureId}`).emit('lecture-ended', { lectureId: lectureId.toString() });
      io.to(`classroom-${lecture.classroom.code}`).emit('lecture-completed', {
        lectureId: lectureId.toString(),
        status: 'completed',
        isLive: false
      });
    } catch (err) {
      // Ignore if socket server not initialized in certain test environments
    }

    return res.status(200).json({ success: true, lecture });
  } catch (error) {
    next(error);
  }
};

const markAttendance = async (req, res, next) => {
  try {
    const { lectureId } = req.body;
    if (!lectureId) return res.status(400).json({ success: false, error: 'Lecture ID required.' });

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) return res.status(404).json({ success: false, error: 'Lecture not found.' });

    const isStudent = lecture.classroom.students.some(id => id.equals(req.user._id));
    if (!isStudent) {
      return res.status(403).json({ success: false, error: 'Only enrolled students can mark attendance.' });
    }

    const alreadyMarked = lecture.attendance.some(a => a.student.equals(req.user._id));
    if (!alreadyMarked) {
      lecture.attendance.push({ student: req.user._id });
      await lecture.save();
    }

    // As per requirements: do not fake streaming.
    // Return empty string for youtubeLiveStreamURL so frontend replace() does not crash,
    // and it will truthfully display "Waiting for lecture to start..." since streaming is unsupported.
    return res.status(200).json({
      success: true,
      lecture: {
        ...lecture.toObject(),
        youtubeLiveStreamURL: ""
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getLectures,
  createLecture,
  updateLecture,
  deleteLecture,
  startLiveSession,
  stopLiveSession,
  completeLecture,
  markAttendance
};
