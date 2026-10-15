const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  lecture: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scheduledTime: {
    type: String,
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Reminder', reminderSchema);
