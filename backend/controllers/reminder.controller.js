const Reminder = require('../models/Reminder');
const Lecture = require('../models/Lecture');

const getReminders = async (req, res, next) => {
  try {
    const now = new Date();
    const reminders = await Reminder.find({ user: req.user._id })
      .populate({
        path: 'lecture',
        select: 'title description date time startTime classroom status',
        populate: {
          path: 'classroom',
          select: 'name code'
        }
      });
      
    // Filter out:
    // 1. Reminders whose lecture was deleted
    // 2. Reminders whose lecture's classroom was deleted
    // 3. Reminders whose scheduledTime is in the past (only upcoming reminders)
    const validUpcomingReminders = reminders.filter(r => {
      if (!r.lecture || !r.lecture.classroom) return false;
      if (!r.scheduledTime) return false;
      const scheduledDate = new Date(r.scheduledTime);
      if (isNaN(scheduledDate.getTime())) return false;
      return scheduledDate >= now;
    });

    // Sort chronologically (scheduledTime ascending)
    validUpcomingReminders.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

    return res.status(200).json({ success: true, reminders: validUpcomingReminders });
  } catch (error) {
    next(error);
  }
};

const createReminder = async (req, res, next) => {
  try {
    const { lectureId, scheduledTime } = req.body;
    if (!lectureId || !scheduledTime) {
      return res.status(400).json({ success: false, error: 'Lecture ID and scheduled time are required' });
    }

    const lecture = await Lecture.findById(lectureId).populate('classroom');
    if (!lecture) {
      return res.status(404).json({ success: false, error: 'Lecture not found' });
    }

    if (!lecture.classroom) {
      return res.status(404).json({ success: false, error: 'Classroom for this lecture not found or has been deleted' });
    }
    
    const isTeacher = lecture.classroom.teacher && lecture.classroom.teacher.equals(req.user._id);
    const isStudent = Array.isArray(lecture.classroom.students) && lecture.classroom.students.some(id => id.equals(req.user._id));

    if (!isTeacher && !isStudent) {
      return res.status(403).json({ success: false, error: 'Not authorized to set reminder for this lecture' });
    }

    if (lecture.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Cannot set a reminder for a completed lecture' });
    }

    const scheduledDate = new Date(scheduledTime);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid scheduled time format' });
    }

    if (scheduledDate < new Date()) {
      return res.status(400).json({ success: false, error: 'Cannot set a reminder in the past' });
    }

    const reminder = new Reminder({
      lecture: lecture._id,
      user: req.user._id,
      scheduledTime: scheduledDate.toISOString()
    });

    await reminder.save();
    return res.status(201).json({ success: true, reminder });
  } catch (error) {
    next(error);
  }
};

const updateReminder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { scheduledTime } = req.body;
    
    if (!scheduledTime || isNaN(new Date(scheduledTime).getTime())) {
      return res.status(400).json({ success: false, error: 'Valid scheduled time is required' });
    }

    const reminder = await Reminder.findOne({ _id: id, user: req.user._id });
    if (!reminder) {
      return res.status(404).json({ success: false, error: 'Reminder not found or unauthorized' });
    }

    const lecture = await Lecture.findById(reminder.lecture).populate('classroom');
    if (!lecture || !lecture.classroom) {
      return res.status(400).json({ success: false, error: 'Associated lecture or classroom no longer exists' });
    }

    const scheduledDate = new Date(scheduledTime);
    reminder.scheduledTime = scheduledDate.toISOString();
    await reminder.save();
    
    return res.status(200).json({ success: true, time: reminder.scheduledTime, reminder });
  } catch (error) {
    next(error);
  }
};

const deleteReminder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const reminder = await Reminder.findOne({ _id: id, user: req.user._id });
    if (!reminder) {
      return res.status(404).json({ success: false, error: 'Reminder not found or unauthorized' });
    }

    await Reminder.findByIdAndDelete(id);
    return res.status(200).json({ success: true, message: 'Reminder deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getReminders,
  createReminder,
  updateReminder,
  deleteReminder
};
