const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender: {
    id: { type: String, required: true },
    name: { type: String, required: true }
  },
  message: {
    type: String,
    default: ''
  },
  file: {
    url: { type: String },
    name: { type: String },
    type: { type: String },
    size: { type: Number }
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const assignmentChatSchema = new mongoose.Schema({
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
  participants: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: { type: String }
    }
  ],
  messages: [messageSchema]
}, { timestamps: true });

// Compound index to quickly find chat thread for assignment + student
assignmentChatSchema.index({ assignment: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('AssignmentChat', assignmentChatSchema);
