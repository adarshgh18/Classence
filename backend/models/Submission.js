const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  assignment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Assignment',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  classroom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: true
  },
  media: [{
    type: String // URL or file path
  }],
  filesMetadata: [{
    publicId: { type: String },
    resourceType: { type: String }
  }],
  marks: {
    type: Number,
    min: 0,
    max: 10,
    default: null
  },
  isGraded: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

// Prevent multiple submissions per student per assignment
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('Submission', submissionSchema);
