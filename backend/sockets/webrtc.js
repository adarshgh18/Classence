const logger = require('../utils/logger');
const Lecture = require('../models/Lecture');
const Classroom = require('../models/Classroom');

/**
 * Register WebRTC signaling handlers for live lectures.
 * Reuses the globally authenticated socket.user identity on the default namespace.
 *
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function registerWebRTCSignaling(io, socket) {
  // Helper to emit consistent error messages
  const emitSignalError = (event, message) => {
    socket.emit('lecture-signal-error', { event, message });
  };

  // Helper to clean up socket state on room exit or disconnect
  const cleanupLectureSocket = () => {
    const lectureId = socket.data?.lectureId;
    const role = socket.data?.role;
    if (!lectureId) return;

    const roomName = `lecture-${lectureId}`;

    // If an authorized student left/disconnected, notify the teacher(s) in this room
    if (role === 'student') {
      const roomSockets = io.sockets.adapter.rooms.get(roomName);
      if (roomSockets) {
        for (const sockId of roomSockets) {
          if (sockId !== socket.id) {
            const s = io.sockets.sockets.get(sockId);
            if (s && s.data?.role === 'teacher' && s.data?.lectureId === lectureId.toString()) {
              s.emit('student-left', { studentSocketId: socket.id });
            }
          }
        }
      }
    }

    socket.leave(roomName);
    delete socket.data.lectureId;
    delete socket.data.role;
  };

  // =========================================================================
  // 1. JOIN LECTURE ROOM: join-lecture-room
  // =========================================================================
  socket.on('join-lecture-room', async (payload) => {
    try {
      if (!payload || !payload.lectureId) {
        return emitSignalError('join-lecture-room', 'lectureId is required');
      }

      const { lectureId } = payload;
      const lecture = await Lecture.findById(lectureId);
      if (!lecture) {
        return emitSignalError('join-lecture-room', 'Lecture not found');
      }

      const classroom = await Classroom.findById(lecture.classroom);
      if (!classroom) {
        return emitSignalError('join-lecture-room', 'Classroom not found');
      }

      const isTeacher = classroom.teacher.equals(socket.user._id);
      const isStudent = classroom.students.some((s) => s.equals(socket.user._id));

      if (!isTeacher && !isStudent) {
        return emitSignalError('join-lecture-room', 'Unauthorized: Not a member of this classroom');
      }

      // If student, lecture MUST be live
      if (isStudent && !isTeacher) {
        if (!lecture.isLive) {
          return emitSignalError('join-lecture-room', 'Lecture is not currently live');
        }
      }

      const role = isTeacher ? 'teacher' : 'student';
      const roomName = `lecture-${lectureId}`;

      // Leave previous lecture room if any
      cleanupLectureSocket();

      // Join room and record in socket.data
      socket.join(roomName);
      socket.data = socket.data || {};
      socket.data.lectureId = lectureId.toString();
      socket.data.role = role;

      // Acknowledge join to the sender
      socket.emit('lecture-room-joined', {
        lectureId: lectureId.toString(),
        role
      });

      if (role === 'student') {
        // Notify any teachers currently in the room
        const roomSockets = io.sockets.adapter.rooms.get(roomName);
        if (roomSockets) {
          for (const sockId of roomSockets) {
            if (sockId !== socket.id) {
              const s = io.sockets.sockets.get(sockId);
              if (s && s.data?.role === 'teacher' && s.data?.lectureId === lectureId.toString()) {
                s.emit('student-joined', { studentSocketId: socket.id });
              }
            }
          }
        }
      } else if (role === 'teacher') {
        // Teacher refresh / rejoin discovery:
        // Find existing students in the room and notify the teacher so peer connections can be initiated
        const roomSockets = io.sockets.adapter.rooms.get(roomName);
        if (roomSockets) {
          for (const sockId of roomSockets) {
            if (sockId !== socket.id) {
              const s = io.sockets.sockets.get(sockId);
              if (s && s.data?.role === 'student' && s.data?.lectureId === lectureId.toString()) {
                socket.emit('student-joined', { studentSocketId: s.id });
              }
            }
          }
        }
      }
    } catch (err) {
      logger.error('Error handling join-lecture-room:', err.message);
      emitSignalError('join-lecture-room', 'Internal server error joining lecture room');
    }
  });

  // =========================================================================
  // 2. LEAVE LECTURE ROOM: leave-lecture-room
  // =========================================================================
  socket.on('leave-lecture-room', () => {
    cleanupLectureSocket();
  });

  // =========================================================================
  // 3. WEBRTC OFFER: webrtc-offer (Teacher -> Student)
  // =========================================================================
  socket.on('webrtc-offer', (payload) => {
    try {
      if (!payload || !payload.targetSocketId || !payload.sdp) {
        return emitSignalError('webrtc-offer', 'Invalid offer payload: targetSocketId and sdp required');
      }

      const senderLectureId = socket.data?.lectureId;
      const senderRole = socket.data?.role;

      if (!senderLectureId || senderRole !== 'teacher') {
        return emitSignalError('webrtc-offer', 'Unauthorized: Only teacher in room can send WebRTC offer');
      }

      const targetSocket = io.sockets.sockets.get(payload.targetSocketId);
      if (
        !targetSocket ||
        targetSocket.data?.lectureId !== senderLectureId ||
        targetSocket.data?.role !== 'student'
      ) {
        return emitSignalError('webrtc-offer', 'Invalid target: Target student not in this lecture room');
      }

      targetSocket.emit('webrtc-offer', {
        senderSocketId: socket.id,
        sdp: payload.sdp
      });
    } catch (err) {
      logger.error('Error relaying webrtc-offer:', err.message);
      emitSignalError('webrtc-offer', 'Failed to relay WebRTC offer');
    }
  });

  // =========================================================================
  // 4. WEBRTC ANSWER: webrtc-answer (Student -> Teacher)
  // =========================================================================
  socket.on('webrtc-answer', (payload) => {
    try {
      if (!payload || !payload.targetSocketId || !payload.sdp) {
        return emitSignalError('webrtc-answer', 'Invalid answer payload: targetSocketId and sdp required');
      }

      const senderLectureId = socket.data?.lectureId;
      const senderRole = socket.data?.role;

      if (!senderLectureId || senderRole !== 'student') {
        return emitSignalError('webrtc-answer', 'Unauthorized: Only student in room can send WebRTC answer');
      }

      const targetSocket = io.sockets.sockets.get(payload.targetSocketId);
      if (
        !targetSocket ||
        targetSocket.data?.lectureId !== senderLectureId ||
        targetSocket.data?.role !== 'teacher'
      ) {
        return emitSignalError('webrtc-answer', 'Invalid target: Target teacher not in this lecture room');
      }

      targetSocket.emit('webrtc-answer', {
        senderSocketId: socket.id,
        sdp: payload.sdp
      });
    } catch (err) {
      logger.error('Error relaying webrtc-answer:', err.message);
      emitSignalError('webrtc-answer', 'Failed to relay WebRTC answer');
    }
  });

  // =========================================================================
  // 5. WEBRTC ICE CANDIDATE: webrtc-ice-candidate (Teacher <-> Student)
  // =========================================================================
  socket.on('webrtc-ice-candidate', (payload) => {
    try {
      if (!payload || !payload.targetSocketId || !payload.candidate) {
        return emitSignalError('webrtc-ice-candidate', 'Invalid candidate payload: targetSocketId and candidate required');
      }

      const senderLectureId = socket.data?.lectureId;
      const senderRole = socket.data?.role;

      if (!senderLectureId || !senderRole) {
        return emitSignalError('webrtc-ice-candidate', 'Unauthorized: Must join lecture room before sending candidates');
      }

      const targetSocket = io.sockets.sockets.get(payload.targetSocketId);
      if (!targetSocket || targetSocket.data?.lectureId !== senderLectureId) {
        return emitSignalError('webrtc-ice-candidate', 'Invalid target: Target not in same lecture room');
      }

      // Reject student <-> student signaling
      if (senderRole === 'student' && targetSocket.data?.role !== 'teacher') {
        return emitSignalError('webrtc-ice-candidate', 'Unauthorized: Student-to-student candidate relay not allowed');
      }
      if (senderRole === 'teacher' && targetSocket.data?.role !== 'student') {
        return emitSignalError('webrtc-ice-candidate', 'Invalid target: Teacher can only send candidates to students');
      }

      targetSocket.emit('webrtc-ice-candidate', {
        senderSocketId: socket.id,
        candidate: payload.candidate
      });
    } catch (err) {
      logger.error('Error relaying webrtc-ice-candidate:', err.message);
      emitSignalError('webrtc-ice-candidate', 'Failed to relay ICE candidate');
    }
  });

  // =========================================================================
  // 6. DISCONNECT CLEANUP
  // =========================================================================
  socket.on('disconnecting', () => {
    cleanupLectureSocket();
  });
}

module.exports = {
  registerWebRTCSignaling
};
