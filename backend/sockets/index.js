const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const corsOptions = require('../config/cors');
const env = require('../config/env');
const logger = require('../utils/logger');
const User = require('../models/User');
const Classroom = require('../models/Classroom');
const Assignment = require('../models/Assignment');
const AssignmentChat = require('../models/AssignmentChat');
const DevChat = require('../models/DevChat');

const storageService = require('../services/storage.service');
const { registerWebRTCSignaling } = require('./webrtc');

let io = null;

const SUPPORTED_SUPPORT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain'
];

// Helper to save uploaded file buffer via storageService and return public URL
const saveFileBuffer = async (fileData, folder = 'Classence/chat/assignments', allowedMimes = null) => {
  if (!fileData || !fileData.buffer || !fileData.name) return null;
  try {
    const buffer = Buffer.from(fileData.buffer);

    // Limit to 5MB max
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('File size exceeds 5MB limit');
    }

    if (allowedMimes && (!fileData.type || !allowedMimes.includes(fileData.type.toLowerCase()))) {
      throw new Error('Unsupported file type: ' + fileData.type);
    }

    const uploaded = await storageService.uploadBuffer(buffer, {
      folder,
      originalname: fileData.name,
      mimetype: fileData.type || ''
    });

    return {
      url: uploaded.url,
      name: fileData.name,
      type: fileData.type || (uploaded.resourceType === 'image' ? 'image/jpeg' : 'application/octet-stream'),
      size: fileData.size || buffer.length
    };
  } catch (err) {
    logger.error('Error saving chat attachment buffer:', err.message);
    return null;
  }
};

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 6 * 1024 * 1024 // 6MB to accommodate 5MB payload
  });

  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.query?.token || 
                    socket.handshake.auth?.token || 
                    socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

      if (!token) {
        return next(new Error('Authentication required. Missing token.'));
      }

      let decoded;
      try {
        decoded = jwt.verify(token, env.jwtSecret);
      } catch (err) {
        return next(new Error('Authentication failed: Invalid or expired token'));
      }

      const user = await User.findById(decoded.id).select('+tokenVersion +isAdmin');
      if (!user) {
        return next(new Error('User no longer exists'));
      }

      if (decoded.tv !== user.tokenVersion) {
        return next(new Error('Session invalidated'));
      }

      socket.user = user;
      next();
    } catch (err) {
      logger.error('Socket authentication error:', err.message);
      next(new Error('Internal server error during socket authentication'));
    }
  });

  io.on('connection', (socket) => {
    logger.info(`Socket authenticated & connected: ${socket.id} (User: ${socket.user.name} - ${socket.user._id})`);

    // Join authenticated user-specific notification room (strictly verified via JWT)
    socket.join(`user:${socket.user._id}`);

    // =========================================================================
    // 1. ASSIGNMENT CHAT
    // =========================================================================

    // Event: joinAssignmentChat
    // Payload: { studentId, assignmentId }
    socket.on('joinAssignmentChat', async (payload) => {
      try {
        if (!payload || !payload.assignmentId) {
          return socket.emit('error', 'assignmentId is required');
        }

        const { assignmentId } = payload;
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
          return socket.emit('error', 'Assignment not found');
        }

        const classroom = await Classroom.findById(assignment.classroom);
        if (!classroom) {
          return socket.emit('error', 'Classroom not found');
        }

        const isTeacher = classroom.teacher.toString() === socket.user._id.toString();
        const isEnrolled = classroom.students.some(s => s.toString() === socket.user._id.toString());

        if (!isTeacher && !isEnrolled) {
          return socket.emit('error', 'Unauthorized: You are not a member of this classroom');
        }

        // Determine effective student thread
        let targetStudentId;
        if (isTeacher) {
          // If teacher, they may pass payload.studentId or request participant list
          targetStudentId = payload.studentId;
        } else {
          // Student cannot impersonate another student
          targetStudentId = socket.user._id.toString();
        }

        // If teacher is connecting to the assignment root without a specific studentId,
        // or with their own userId (as emitted by studentSubmission.jsx on mount),
        // join teacher room and send all chat threads for this assignment ("AssignemntChats")
        if (isTeacher && (!targetStudentId || targetStudentId === socket.user._id.toString())) {
          socket.join(`assignment-teachers-${assignmentId}`);
          let chats = await AssignmentChat.find({ assignment: assignment._id, student: { $ne: classroom.teacher } }).populate('student', 'name email');
          if (chats.length === 0 && classroom.students.length > 0) {
            const enrolledStudents = await User.find({ _id: { $in: classroom.students } });
            for (const st of enrolledStudents) {
              await AssignmentChat.findOneAndUpdate(
                { assignment: assignmentId, student: st._id },
                {
                  $setOnInsert: {
                    assignment: assignmentId,
                    student: st._id,
                    participants: [{ _id: st._id, name: st.name }],
                    messages: []
                  }
                },
                { upsert: true, new: true }
              );
            }
            chats = await AssignmentChat.find({ assignment: assignment._id, student: { $ne: classroom.teacher } }).populate('student', 'name email');
          }
          socket.emit('AssignemntChats', chats);
          return;
        }

        if (!targetStudentId) {
          return socket.emit('error', 'studentId is required');
        }

        // Verify target student exists and is part of classroom
        const targetStudent = await User.findById(targetStudentId);
        if (!targetStudent) {
          return socket.emit('error', 'Target student not found');
        }

        const roomName = `assignment-${assignmentId}-${targetStudentId}`;
        socket.join(roomName);

        // Fetch or initialize chat history
        let chatRecord = await AssignmentChat.findOne({ assignment: assignmentId, student: targetStudentId });
        if (!chatRecord) {
          chatRecord = await AssignmentChat.create({
            assignment: assignmentId,
            student: targetStudentId,
            participants: [{ _id: targetStudent._id, name: targetStudent.name }],
            messages: []
          });
        }

        // Send chat history to the user
        // Frontend expects chatHistory as an array of chat documents: [ { messages: [...] } ]
        socket.emit('chatHistory', [chatRecord]);

        // If teacher joined, also notify/update participant list
        if (isTeacher) {
          const allThreads = await AssignmentChat.find({ assignment: assignment._id }).populate('student', 'name email');
          socket.emit('AssignemntChats', allThreads);
        }
      } catch (err) {
        logger.error('Error handling joinAssignmentChat:', err);
        socket.emit('error', 'Failed to join assignment chat');
      }
    });

    // Event: assignmentChatMessage
    // Payload: { message, studentId, assignmentId, file }
    socket.on('assignmentChatMessage', async (data) => {
      try {
        if (!data || !data.assignmentId) {
          return socket.emit('error', 'Invalid message payload: assignmentId required');
        }

        const { assignmentId, message } = data;
        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
          return socket.emit('error', 'Assignment not found');
        }

        const classroom = await Classroom.findById(assignment.classroom);
        if (!classroom) {
          return socket.emit('error', 'Classroom not found');
        }

        const isTeacher = classroom.teacher.toString() === socket.user._id.toString();
        const isEnrolled = classroom.students.some(s => s.toString() === socket.user._id.toString());

        if (!isTeacher && !isEnrolled) {
          return socket.emit('error', 'Unauthorized: You are not a member of this classroom');
        }

        const targetStudentId = isTeacher ? data.studentId : socket.user._id.toString();
        if (!targetStudentId) {
          return socket.emit('error', 'studentId is required');
        }

        // Save file if attached
        let savedFile = null;
        if (data.file) {
          savedFile = await saveFileBuffer(data.file);
        }

        if ((!message || !message.trim()) && !savedFile) {
          return; // nothing to send
        }

        const targetStudent = await User.findById(targetStudentId);
        if (!targetStudent) {
          return socket.emit('error', 'Student not found');
        }

        // Create message object matching frontend format
        const chatMessage = {
          sender: {
            id: socket.user._id.toString(),
            name: socket.user.name
          },
          message: message ? message.trim() : '',
          file: savedFile,
          timestamp: new Date()
        };

        // Persist message in database
        let chatRecord = await AssignmentChat.findOneAndUpdate(
          { assignment: assignmentId, student: targetStudentId },
          {
            $push: { messages: chatMessage },
            $setOnInsert: {
              participants: [{ _id: targetStudent._id, name: targetStudent.name }]
            }
          },
          { new: true, upsert: true }
        );

        const roomName = `assignment-${assignmentId}-${targetStudentId}`;
        // Broadcast to everyone in the room (including sender)
        io.to(roomName).emit('chatUpdate', chatMessage);

        // If newly created thread or new message, update teacher's participant list
        const allThreads = await AssignmentChat.find({ assignment: assignment._id, student: { $ne: classroom.teacher } });
        io.to(`assignment-teachers-${assignmentId}`).emit('AssignemntChats', allThreads);
      } catch (err) {
        logger.error('Error handling assignmentChatMessage:', err);
        socket.emit('error', 'Failed to send assignment chat message');
      }
    });

    // =========================================================================
    // 2. DEVELOPER / SUPPORT CHAT
    // =========================================================================

    // Event: getDevChats
    socket.on('getDevChats', async () => {
      try {
        if (!socket.user.isAdmin) {
          return socket.emit('notAdmin');
        }

        const devChats = await DevChat.find({}).populate('user', 'name email');
        socket.emit('devChats', devChats);
      } catch (err) {
        logger.error('Error handling getDevChats:', err);
        socket.emit('error', 'Failed to retrieve developer chats');
      }
    });

    // Event: joinDeveloperChat
    // Payload: { userId }
    socket.on('joinDeveloperChat', async (payload) => {
      try {
        let targetUserId;
        if (socket.user.isAdmin) {
          targetUserId = payload?.userId || socket.user._id.toString();
        } else {
          targetUserId = socket.user._id.toString();
        }

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
          return socket.emit('error', 'Target user not found');
        }

        const roomName = `devchat-${targetUserId}`;
        socket.join(roomName);

        let chatRecord = await DevChat.findOne({ user: targetUserId });
        if (!chatRecord) {
          chatRecord = await DevChat.create({
            user: targetUserId,
            participants: [{ _id: targetUser._id, name: targetUser.name }],
            messages: []
          });
        }

        socket.emit('chatHistory', [chatRecord]);
      } catch (err) {
        logger.error('Error handling joinDeveloperChat:', err);
        socket.emit('error', 'Failed to join developer chat');
      }
    });

    // Event: developerChatMessage
    // Payload: { message, userId, file }
    socket.on('developerChatMessage', async (data) => {
      try {
        if (!data) return socket.emit('error', 'Invalid payload');

        let targetUserId;
        if (socket.user.isAdmin) {
          targetUserId = data.userId || socket.user._id.toString();
        } else {
          targetUserId = socket.user._id.toString();
        }

        let savedFile = null;
        if (data.file) {
          const mimeType = (data.file.type || '').toLowerCase();
          if (!mimeType || !SUPPORTED_SUPPORT_MIMES.includes(mimeType)) {
            return socket.emit('error', 'Unsupported file type. Only JPEG, PNG, WEBP, PDF, and TXT are allowed.');
          }
          const bufferLength = data.file.buffer ? (Array.isArray(data.file.buffer) ? data.file.buffer.length : Buffer.from(data.file.buffer).length) : 0;
          const fileSize = data.file.size || bufferLength;
          if (fileSize > 5 * 1024 * 1024 || bufferLength > 5 * 1024 * 1024) {
            return socket.emit('error', 'File size exceeds 5MB limit');
          }

          savedFile = await saveFileBuffer(data.file, 'Classence/chat/support', SUPPORTED_SUPPORT_MIMES);
          if (!savedFile) {
            return socket.emit('error', 'Failed to process attachment');
          }
        }

        const message = data.message ? data.message.trim() : '';
        if (!message && !savedFile) return;

        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
          return socket.emit('error', 'User not found');
        }

        const chatMessage = {
          sender: {
            id: socket.user._id.toString(),
            name: socket.user.name
          },
          message,
          file: savedFile,
          timestamp: new Date()
        };

        await DevChat.findOneAndUpdate(
          { user: targetUserId },
          {
            $push: { messages: chatMessage },
            $setOnInsert: {
              participants: [{ _id: targetUser._id, name: targetUser.name }]
            }
          },
          { new: true, upsert: true }
        );

        const roomName = `devchat-${targetUserId}`;
        io.to(roomName).emit('chatUpdate', chatMessage);

        // Also update dev list for admins if needed
        if (socket.user.isAdmin) {
          const allDevChats = await DevChat.find({});
          io.emit('devChats', allDevChats);
        }
      } catch (err) {
        logger.error('Error handling developerChatMessage:', err);
        socket.emit('error', 'Failed to send developer chat message');
      }
    });

    // =========================================================================
    // 3. CLASSROOM SCHEDULE SYNCHRONIZATION
    // =========================================================================
    socket.on('join-classroom', async ({ classCode }) => {
      try {
        if (!classCode) return;
        const classroom = await Classroom.findOne({ code: classCode });
        if (!classroom) return;

        const isTeacher = classroom.teacher.toString() === socket.user._id.toString();
        const isEnrolled = classroom.students.some(s => s.toString() === socket.user._id.toString());

        if (isTeacher || isEnrolled) {
          socket.join(`classroom-${classCode}`);
          socket.emit('classroom-joined', { classCode });
        } else {
          socket.emit('classroom-join-error', { message: 'Not authorized to join classroom' });
        }
      } catch (err) {
        logger.error('Error in join-classroom:', err.message);
      }
    });

    socket.on('leave-classroom', ({ classCode }) => {
      if (classCode) {
        socket.leave(`classroom-${classCode}`);
      }
    });

    // =========================================================================
    // 4. LIVE LECTURE WEBRTC SIGNALING
    // =========================================================================
    registerWebRTCSignaling(io, socket);

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  logger.info('Socket.io server initialized and ready');
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialized yet!');
  }
  return io;
};

module.exports = {
  initSocket,
  getIO
};
