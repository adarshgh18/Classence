const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxLength: 100
  },
  description: {
    type: String,
    trim: true
  },
  dueDate: {
    type: String, // Stored as YYYY-MM-DD
    required: true
  },
  media: [{
    type: String // URL or file path
  }],
  filesMetadata: [{
    publicId: { type: String },
    resourceType: { type: String }
  }],
  classroom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: true
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { timestamps: true });

// Virtual for submissions
assignmentSchema.virtual('submissions', {
  ref: 'Submission',
  localField: '_id',
  foreignField: 'assignment'
});

// Helper for accurate deadline check (treats YYYY-MM-DD as due through end of day)
const isDatePastDue = (dueDateStr) => {
  if (!dueDateStr) return false;
  const now = new Date();
  const trimmed = String(dueDateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
    return now.getTime() > endOfDay.getTime();
  }
  const parsed = new Date(trimmed);
  return !isNaN(parsed.getTime()) && now.getTime() > parsed.getTime();
};

// Virtual for fallback status based on current date
assignmentSchema.virtual('status').get(function () {
  if (!this.dueDate) return 'Due';
  return isDatePastDue(this.dueDate) ? 'Past Due' : 'Due';
});

// Enable virtuals
assignmentSchema.set('toJSON', { virtuals: true });
assignmentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Assignment', assignmentSchema);
