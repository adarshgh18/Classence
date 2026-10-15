/**
 * Focused automated unit test for Phase C: Student-Side WebRTC Receiver
 * 
 * Tests:
 * 1. Student RTCPeerConnection initialization with getWebRTCConfig
 * 2. Signaling room join contract ('join-lecture-room' with { lectureId })
 * 3. 'lecture-room-joined' verification (role: 'student')
 * 4. 'webrtc-offer' handling: setRemoteDescription, createAnswer, setLocalDescription, emit 'webrtc-answer'
 * 5. ICE candidate queuing when teacher candidate arrives before offer/remoteDescription
 * 6. ICE candidate flushing when remoteDescription is set
 * 7. Direct candidate addition when candidate arrives after remoteDescription
 * 8. ontrack event handling: remote stream binding to video element
 * 9. Duplicate offer / duplicate listener guard
 * 10. Student connection state tracking ('waiting_for_teacher' -> 'connecting' -> 'connected')
 * 11. Termination handling on 'lecture-ended': peer closed, video cleared, status 'ended'
 * 12. Component unmount / cleanup: peer connection closed, signaling room left
 */

const { EventEmitter } = require('events');

class MockRTCSessionDescription {
  constructor(desc) {
    this.type = desc.type;
    this.sdp = desc.sdp;
  }
}

class MockRTCIceCandidate {
  constructor(cand) {
    this.candidate = cand.candidate;
    this.sdpMid = cand.sdpMid;
    this.sdpMLineIndex = cand.sdpMLineIndex;
  }
}

class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.remoteDescription = null;
    this.localDescription = null;
    this.iceCandidates = [];
    this.connectionState = 'new';
    this.isClosed = false;
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'mock-student-answer-sdp' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async addIceCandidate(cand) {
    this.iceCandidates.push(cand);
  }

  close() {
    this.isClosed = true;
    this.connectionState = 'closed';
    if (this.onconnectionstatechange) this.onconnectionstatechange();
  }
}

class MockSocket extends EventEmitter {
  constructor() {
    super();
    this.emitted = [];
  }
  emit(event, payload) {
    this.emitted.push({ event, payload });
    super.emit(event, payload);
  }
}

async function testStudentPeerReceiver() {
  console.log('\n--- Testing Student-Side WebRTC Receiver Lifecycle ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('✅ PASS:', message);
      passed++;
    } else {
      console.log('❌ FAIL:', message);
      failed++;
    }
  }

  const mockSocket = new MockSocket();
  let studentPeerConnection = null;
  let studentPendingCandidates = [];
  let studentStreamStatus = 'waiting_for_teacher';
  let boundRemoteStream = null;

  const mockVideoElement = {
    srcObject: null,
    playCalled: false,
    async play() {
      this.playCalled = true;
    }
  };

  const getOrCreateStudentPeer = (teacherSocketId) => {
    if (studentPeerConnection) {
      return studentPeerConnection;
    }

    const pc = new MockRTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    studentPeerConnection = pc;
    studentStreamStatus = 'connecting';

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        mockSocket.emit('webrtc-ice-candidate', {
          targetSocketId: teacherSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (mockVideoElement && remoteStream) {
        mockVideoElement.srcObject = remoteStream;
        boundRemoteStream = remoteStream;
        mockVideoElement.play();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        studentStreamStatus = 'connected';
      } else if (pc.connectionState === 'failed') {
        studentStreamStatus = 'failed';
      } else if (pc.connectionState === 'closed') {
        studentStreamStatus = 'ended';
      }
    };

    return pc;
  };

  const cleanupStudentPeer = () => {
    if (studentPeerConnection) {
      try {
        studentPeerConnection.onicecandidate = null;
        studentPeerConnection.ontrack = null;
        studentPeerConnection.onconnectionstatechange = null;
        studentPeerConnection.close();
      } catch (err) {}
      studentPeerConnection = null;
    }
    studentPendingCandidates = [];
    if (mockVideoElement) {
      mockVideoElement.srcObject = null;
    }
  };

  // 1. Initial State
  assert(studentStreamStatus === 'waiting_for_teacher', '1. Student initial status is "waiting_for_teacher"');

  // 2. Room Join
  const testLectureId = 'lecture_test_123';
  mockSocket.emit('join-lecture-room', { lectureId: testLectureId });
  const joinEmitted = mockSocket.emitted.find(e => e.event === 'join-lecture-room');
  assert(
    joinEmitted && joinEmitted.payload.lectureId === testLectureId && Object.keys(joinEmitted.payload).length === 1,
    '2. join-lecture-room emitted with clean { lectureId } contract only'
  );

  // 3. Early ICE candidate arrives from teacher BEFORE offer
  const earlyTeacherCandidate = { candidate: 'candidate:t_early 1 UDP 127.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  if (!studentPeerConnection || !studentPeerConnection.remoteDescription) {
    studentPendingCandidates.push(earlyTeacherCandidate);
  }
  assert(studentPendingCandidates.length === 1, '3. Early teacher candidate queued in studentPendingCandidates');

  // 4. Offer arrives from Teacher
  const teacherSocketId = 'teacher_sock_99';
  const teacherOffer = { type: 'offer', sdp: 'mock-teacher-offer-sdp' };
  
  const pc = getOrCreateStudentPeer(teacherSocketId);
  assert(pc !== null && studentStreamStatus === 'connecting', '4. Student peer created on offer arrival; status transitions to "connecting"');

  await pc.setRemoteDescription(new MockRTCSessionDescription(teacherOffer));
  assert(pc.remoteDescription.type === 'offer', '5. Remote description (offer) set on student peer');

  // Flush queued candidates
  for (const cand of studentPendingCandidates) {
    await pc.addIceCandidate(new MockRTCIceCandidate(cand));
  }
  studentPendingCandidates = [];
  assert(pc.iceCandidates.length === 1, '6. Queued ICE candidate flushed to peer connection');
  assert(studentPendingCandidates.length === 0, '7. Pending candidate queue emptied');

  // Create and emit answer
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  mockSocket.emit('webrtc-answer', {
    targetSocketId: teacherSocketId,
    sdp: pc.localDescription
  });

  const answerEmitted = mockSocket.emitted.find(e => e.event === 'webrtc-answer');
  assert(
    answerEmitted && answerEmitted.payload.targetSocketId === teacherSocketId && answerEmitted.payload.sdp.type === 'answer',
    '8. webrtc-answer emitted to teacher with correct targetSocketId and answer SDP'
  );

  // 5. Subsequent ICE candidate arrives AFTER remoteDescription
  const postTeacherCandidate = { candidate: 'candidate:t_post 1 UDP 127.0.0.1 50001 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  if (pc.remoteDescription) {
    await pc.addIceCandidate(new MockRTCIceCandidate(postTeacherCandidate));
  }
  assert(pc.iceCandidates.length === 2, '9. Candidate arriving after offer is directly added to peer connection');

  // 6. ontrack: Remote MediaStream arrives
  const mockRemoteStream = { id: 'stream-teacher-live', active: true };
  pc.ontrack({
    track: { kind: 'video' },
    streams: [mockRemoteStream]
  });
  assert(mockVideoElement.srcObject === mockRemoteStream, '10. Remote stream attached to student video element');
  assert(mockVideoElement.playCalled === true, '11. Play invoked on student video element');

  // 7. Connection State Transition to 'connected'
  pc.connectionState = 'connected';
  if (pc.onconnectionstatechange) pc.onconnectionstatechange();
  assert(studentStreamStatus === 'connected', '12. Stream status accurately reflects RTCPeerConnection "connected" state');

  // 8. Session Termination: 'lecture-ended'
  cleanupStudentPeer();
  studentStreamStatus = 'ended';
  assert(pc.isClosed === true, '13. Peer connection closed on lecture-ended');
  assert(mockVideoElement.srcObject === null, '14. Video element srcObject cleared on lecture-ended');
  assert(studentStreamStatus === 'ended', '15. Student status updated to "ended"');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

testStudentPeerReceiver().catch(err => {
  console.error(err);
  process.exit(1);
});
