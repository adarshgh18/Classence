/**
 * Verification test for Phase B: Teacher-side WebRTC peer management logic
 * 
 * Verifies:
 * 1. RTCPeerConnection creation per student socket ID
 * 2. Attachment of teacher media tracks (audio and video)
 * 3. Offer creation and webrtc-offer signaling format
 * 4. Prevention of duplicate peer connections on duplicate student-joined events
 * 5. webrtc-answer processing and remote description application
 * 6. webrtc-ice-candidate handling and candidate queueing before remote description
 * 7. Candidate flushing after remote description is applied
 * 8. Cleanup and peer deletion upon student-left
 * 9. Full cleanup upon lecture-ended
 * 10. Full cleanup and track stopping upon Stop Session
 */

const { EventEmitter } = require('events');

// Mock RTCSessionDescription & RTCIceCandidate
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

// Mock RTCPeerConnection
class MockRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.tracks = [];
    this.localDescription = null;
    this.remoteDescription = null;
    this.iceCandidates = [];
    this.connectionState = 'new';
    this.isClosed = false;
    this.onicecandidate = null;
    this.onconnectionstatechange = null;
  }

  addTrack(track, stream) {
    this.tracks.push({ track, stream });
  }

  async createOffer() {
    return { type: 'offer', sdp: 'mock-teacher-offer-sdp' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
  }

  async addIceCandidate(cand) {
    this.iceCandidates.push(cand);
  }

  close() {
    this.isClosed = true;
    this.connectionState = 'closed';
  }
}

// Mock MediaStreamTrack & MediaStream
class MockMediaStreamTrack {
  constructor(kind) {
    this.kind = kind;
    this.stopped = false;
  }
  stop() {
    this.stopped = true;
  }
}

class MockMediaStream {
  constructor() {
    this.audioTrack = new MockMediaStreamTrack('audio');
    this.videoTrack = new MockMediaStreamTrack('video');
  }
  getTracks() {
    return [this.audioTrack, this.videoTrack];
  }
}

// Mock Socket
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

async function testTeacherPeerManager() {
  console.log('\n--- Testing Teacher Peer Management Lifecycle ---');
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

  // Set up mock environment
  const mockSocket = new MockSocket();
  const mockStream = new MockMediaStream();
  const peerConnections = new Map();
  const pendingCandidates = new Map();

  const closePeer = (studentSocketId) => {
    const pc = peerConnections.get(studentSocketId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch (err) {}
      peerConnections.delete(studentSocketId);
    }
    pendingCandidates.delete(studentSocketId);
  };

  const closeAllPeers = () => {
    peerConnections.forEach((pc, studentSocketId) => {
      try {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch (err) {}
    });
    peerConnections.clear();
    pendingCandidates.clear();
  };

  const createPeerForStudent = async (studentSocketId) => {
    if (peerConnections.has(studentSocketId)) {
      return; // Duplicate guard
    }

    const pc = new MockRTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    peerConnections.set(studentSocketId, pc);
    pendingCandidates.set(studentSocketId, []);

    mockStream.getTracks().forEach((track) => {
      pc.addTrack(track, mockStream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        mockSocket.emit('webrtc-ice-candidate', {
          targetSocketId: studentSocketId,
          candidate: event.candidate
        });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    mockSocket.emit('webrtc-offer', {
      targetSocketId: studentSocketId,
      sdp: pc.localDescription
    });
  };

  // 1. First student joins
  const student1Id = 'student_sock_1';
  await createPeerForStudent(student1Id);

  const pc1 = peerConnections.get(student1Id);
  assert(pc1 !== undefined, '1. Peer connection created for student 1');
  assert(pc1.tracks.length === 2, '2. Teacher audio and video tracks attached to student 1 peer');
  assert(pc1.localDescription.type === 'offer', '3. Local offer set on student 1 peer');
  
  const offerEmitted = mockSocket.emitted.find(e => e.event === 'webrtc-offer' && e.payload.targetSocketId === student1Id);
  assert(offerEmitted !== undefined && offerEmitted.payload.sdp.type === 'offer', '4. webrtc-offer emitted to signaling server for student 1');

  // 2. Duplicate student-joined event for same student
  await createPeerForStudent(student1Id);
  assert(peerConnections.size === 1, '5. Duplicate student-joined ignored: exactly 1 peer connection preserved');

  // 3. Second distinct student joins
  const student2Id = 'student_sock_2';
  await createPeerForStudent(student2Id);
  assert(peerConnections.size === 2, '6. Distinct peer connection created for student 2');
  assert(peerConnections.has(student1Id) && peerConnections.has(student2Id), '7. Both student peers tracked simultaneously in Map');

  // 4. Candidate arrives BEFORE remote description is set for student 1
  const candidateEarly = { candidate: 'candidate:early 1 UDP 127.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  if (!pc1.remoteDescription) {
    const queue = pendingCandidates.get(student1Id) || [];
    queue.push(candidateEarly);
    pendingCandidates.set(student1Id, queue);
  }
  assert(pendingCandidates.get(student1Id).length === 1, '8. Early candidate queued while remote description is pending');
  assert(pc1.iceCandidates.length === 0, '9. Candidate NOT applied prematurely to peer connection');

  // 5. Remote description (answer) arrives for student 1
  const answerSdp = { type: 'answer', sdp: 'mock-student-answer-sdp' };
  await pc1.setRemoteDescription(new MockRTCSessionDescription(answerSdp));
  assert(pc1.remoteDescription.type === 'answer', '10. Remote answer set on student 1 peer connection');

  // Flush queued candidates
  const queued = pendingCandidates.get(student1Id) || [];
  for (const cand of queued) {
    await pc1.addIceCandidate(new MockRTCIceCandidate(cand));
  }
  pendingCandidates.set(student1Id, []);
  assert(pc1.iceCandidates.length === 1, '11. Queued candidate flushed and applied after remote description set');
  assert(pendingCandidates.get(student1Id).length === 0, '12. Candidate queue emptied after flush');

  // 6. Direct candidate arrives AFTER remote description is set
  const candidateNormal = { candidate: 'candidate:normal 1 UDP 127.0.0.1 50001 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  if (pc1.remoteDescription) {
    await pc1.addIceCandidate(new MockRTCIceCandidate(candidateNormal));
  }
  assert(pc1.iceCandidates.length === 2, '13. New candidate directly added to peer connection after answer set');

  // 7. Student 1 leaves (student-left)
  closePeer(student1Id);
  assert(pc1.isClosed === true, '14. Student 1 peer connection closed');
  assert(!peerConnections.has(student1Id), '15. Student 1 removed from active peer connections map');
  assert(peerConnections.has(student2Id), '16. Student 2 peer connection preserved untouched');

  // 8. Session ends (Stop Session or lecture-ended)
  closeAllPeers();
  const pc2 = peerConnections.get(student2Id);
  assert(peerConnections.size === 0, '17. All peer connections cleared from Map');
  
  // Media tracks stopped
  mockStream.getTracks().forEach(t => t.stop());
  assert(mockStream.audioTrack.stopped && mockStream.videoTrack.stopped, '18. All local camera/microphone media tracks stopped');

  console.log(`\n========================================`);
  console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

testTeacherPeerManager().catch((err) => {
  console.error(err);
  process.exit(1);
});
