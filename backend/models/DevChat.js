const mongoose = require('mongoose');

const devMessageSchema = new mongoose.Schema({
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

const devChatSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  participants: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: { type: String }
    }
  ],
  messages: [devMessageSchema]
}, { timestamps: true });

module.exports = mongoose.model('DevChat', devChatSchema);
