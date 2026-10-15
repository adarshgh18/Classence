const mongoose = require('mongoose');

const classroomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxLength: 50
  },
  subject: {
    type: String,
    trim: true,
    maxLength: 50
  },
  code: {
    type: String,
    required: true,
    unique: true
  },
  privacy: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

// Virtual for noOfStudents
classroomSchema.virtual('noOfStudents').get(function () {
  return this.students ? this.students.length : 0;
});

// Enable virtuals
classroomSchema.set('toJSON', { virtuals: true });
classroomSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Classroom', classroomSchema);
