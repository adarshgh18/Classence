const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { io: Client } = require('../../../frontend/node_modules/socket.io-client');
const env = require('../../config/env');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Lecture = require('../../models/Lecture');

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function runAssert(testName, fn) {
    try {
      await fn();
      console.log('✅ PASS:', testName);
      passed++;
    } catch (err) {
      console.log('❌ FAIL:', testName, '-', err.message);
      failed++;
    }
  }

  function assert(condition, message) {
    if (condition) {
      console.log('✅ PASS:', message);
      passed++;
    } else {
      console.log('❌ FAIL:', message);
      failed++;
    }
  }

  try {
    await mongoose.connect(env.mongodbUri);

    console.log('\n--- Setting up WebRTC Signaling Test Fixtures ---');
    const teacherEmail = 'webrtc_teacher@test.com';
    const student1Email = 'webrtc_student1@test.com';
    const student2Email = 'webrtc_student2@test.com';
    const outsiderEmail = 'webrtc_outsider@test.com';

    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email, outsiderEmail] } });
    await Classroom.deleteMany({ name: 'WebRTC Test Classroom' });

    const createUser = async (name, email, role) => {
      const u = new User({
        name,
        email,
        password: 'Password@123',
        role,
        isVerified: true
      });
      await u.save();
      const token = jwt.sign({ id: u._id, tv: u.tokenVersion || 0 }, env.jwtSecret, { expiresIn: '1d' });
      return { user: u, token };
    };

    const teacher = await createUser('WebRTC Teacher', teacherEmail, 'Teacher');
    const student1 = await createUser('WebRTC Student 1', student1Email, 'Student');
    const student2 = await createUser('WebRTC Student 2', student2Email, 'Student');
    const outsider = await createUser('WebRTC Outsider', outsiderEmail, 'Student');

    // Create Classroom with student1 and student2
    const classroom = new Classroom({
      name: 'WebRTC Test Classroom',
      subject: 'Computer Networks',
      privacy: 'private',
      code: 'RTC999',
      teacher: teacher.user._id,
      students: [student1.user._id, student2.user._id]
    });
    await classroom.save();

    // Create Lecture
    const lecture = new Lecture({
      title: 'WebRTC Lecture',
      description: 'Signaling Test',
      date: '2026-10-12',
      time: '20:00',
      startTime: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago
      classroom: classroom._id,
      teacher: teacher.user._id,
      isLive: false // initially false
    });
    await lecture.save();

    // Second unrelated lecture
    const lectureOther = new Lecture({
      title: 'Other Lecture',
      description: 'Cross lecture test',
      date: '2026-10-12',
      time: '20:00',
      startTime: new Date(Date.now() - 5 * 60 * 1000),
      classroom: classroom._id,
      teacher: teacher.user._id,
      isLive: true
    });
    await lectureOther.save();

    const connectSocket = (token) => {
      return Client('http://localhost:5000', {
        query: { token },
        autoConnect: true,
        transports: ['websocket']
      });
    };

    const waitForEvent = (socket, eventName, timeoutMs = 3000) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(eventName, handler);
          reject(new Error(`Timeout waiting for event: ${eventName}`));
        }, timeoutMs);
        const handler = (data) => {
          clearTimeout(timer);
          socket.off(eventName, handler);
          resolve(data);
        };
        socket.on(eventName, handler);
      });
    };

    console.log('\n--- Test 5: Unauthenticated socket rejected ---');
    await new Promise((resolve) => {
      const badSock = Client('http://localhost:5000', {
        query: { token: 'invalid_token' },
        transports: ['websocket']
      });
      badSock.on('connect_error', (err) => {
        assert(err.message.includes('Authentication failed'), 'Test 5: Unauthenticated socket rejected by auth middleware');
        badSock.close();
        resolve();
      });
      badSock.on('connect', () => {
        assert(false, 'Test 5: Unauthenticated socket connected unexpectedly');
        badSock.close();
        resolve();
      });
    });

    console.log('\n--- Connect Test Sockets ---');
    const teacherSock = connectSocket(teacher.token);
    const s1Sock = connectSocket(student1.token);
    const s2Sock = connectSocket(student2.token);
    const outSock = connectSocket(outsider.token);

    await Promise.all([
      waitForEvent(teacherSock, 'connect'),
      waitForEvent(s1Sock, 'connect'),
      waitForEvent(s2Sock, 'connect'),
      waitForEvent(outSock, 'connect')
    ]);

    console.log('\n--- Test 1: Authenticated teacher joins lecture room ---');
    const teacherJoinPromise = waitForEvent(teacherSock, 'lecture-room-joined');
    teacherSock.emit('join-lecture-room', { lectureId: lecture._id.toString() });
    const teacherJoinData = await teacherJoinPromise;
    assert(
      teacherJoinData.lectureId === lecture._id.toString() && teacherJoinData.role === 'teacher',
      'Test 1: Teacher joined lecture room with role "teacher"'
    );

    console.log('\n--- Test 3: Student rejected when lecture isLive=false ---');
    const s1ErrorPromise = waitForEvent(s1Sock, 'lecture-signal-error');
    s1Sock.emit('join-lecture-room', { lectureId: lecture._id.toString() });
    const s1ErrorData = await s1ErrorPromise;
    assert(
      s1ErrorData.event === 'join-lecture-room' && s1ErrorData.message === 'Lecture is not currently live',
      'Test 3: Student join rejected when lecture.isLive=false'
    );

    console.log('\n--- Test 4: Outsider rejected ---');
    // Turn lecture isLive to true
    lecture.isLive = true;
    await lecture.save();

    const outErrorPromise = waitForEvent(outSock, 'lecture-signal-error');
    outSock.emit('join-lecture-room', { lectureId: lecture._id.toString() });
    const outErrorData = await outErrorPromise;
    assert(
      outErrorData.event === 'join-lecture-room' && outErrorData.message.includes('Unauthorized'),
      'Test 4: Non-enrolled outsider rejected from joining lecture room'
    );

    console.log('\n--- Test 2 & 6: Student joins when isLive=true & notifies teacher ---');
    const s1JoinPromise = waitForEvent(s1Sock, 'lecture-room-joined');
    const teacherNoticePromise = waitForEvent(teacherSock, 'student-joined');
    s1Sock.emit('join-lecture-room', { lectureId: lecture._id.toString() });

    const [s1JoinData, studentNoticeData] = await Promise.all([s1JoinPromise, teacherNoticePromise]);
    assert(
      s1JoinData.lectureId === lecture._id.toString() && s1JoinData.role === 'student',
      'Test 2: Student joined live lecture room with role "student"'
    );
    assert(
      studentNoticeData.studentSocketId === s1Sock.id,
      'Test 6: Teacher received student-joined notification with studentSocketId'
    );

    console.log('\n--- Test 7: Teacher offer forwards only to correct student ---');
    const testSdp = { type: 'offer', sdp: 'v=0\r\no=mock 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
    const s1OfferPromise = waitForEvent(s1Sock, 'webrtc-offer');
    teacherSock.emit('webrtc-offer', {
      targetSocketId: s1Sock.id,
      sdp: testSdp
    });
    const s1ReceivedOffer = await s1OfferPromise;
    assert(
      s1ReceivedOffer.senderSocketId === teacherSock.id && s1ReceivedOffer.sdp.type === 'offer',
      'Test 7: WebRTC offer successfully forwarded from teacher to target student'
    );

    console.log('\n--- Test 8: Student answer forwards only to correct teacher ---');
    const testAnswer = { type: 'answer', sdp: 'v=0\r\no=mock 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
    const teacherAnswerPromise = waitForEvent(teacherSock, 'webrtc-answer');
    s1Sock.emit('webrtc-answer', {
      targetSocketId: teacherSock.id,
      sdp: testAnswer
    });
    const teacherReceivedAnswer = await teacherAnswerPromise;
    assert(
      teacherReceivedAnswer.senderSocketId === s1Sock.id && teacherReceivedAnswer.sdp.type === 'answer',
      'Test 8: WebRTC answer successfully forwarded from student to teacher'
    );

    console.log('\n--- Test 9: ICE Candidate Teacher -> Student ---');
    const testCandidateT2S = { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    const s1CandidatePromise = waitForEvent(s1Sock, 'webrtc-ice-candidate');
    teacherSock.emit('webrtc-ice-candidate', {
      targetSocketId: s1Sock.id,
      candidate: testCandidateT2S
    });
    const s1ReceivedCandidate = await s1CandidatePromise;
    assert(
      s1ReceivedCandidate.senderSocketId === teacherSock.id && s1ReceivedCandidate.candidate.candidate === testCandidateT2S.candidate,
      'Test 9: ICE candidate forwarded Teacher -> Student'
    );

    console.log('\n--- Test 10: ICE Candidate Student -> Teacher ---');
    const testCandidateS2T = { candidate: 'candidate:2 1 UDP 2130706431 127.0.0.1 50001 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    const teacherCandidatePromise = waitForEvent(teacherSock, 'webrtc-ice-candidate');
    s1Sock.emit('webrtc-ice-candidate', {
      targetSocketId: teacherSock.id,
      candidate: testCandidateS2T
    });
    const teacherReceivedCandidate = await teacherCandidatePromise;
    assert(
      teacherReceivedCandidate.senderSocketId === s1Sock.id && teacherReceivedCandidate.candidate.candidate === testCandidateS2T.candidate,
      'Test 10: ICE candidate forwarded Student -> Teacher'
    );

    console.log('\n--- Test 11: Student-to-student signaling rejected ---');
    // Student 2 joins room
    const s2JoinPromise = waitForEvent(s2Sock, 'lecture-room-joined');
    const teacherS2NoticePromise = waitForEvent(teacherSock, 'student-joined');
    s2Sock.emit('join-lecture-room', { lectureId: lecture._id.toString() });
    await Promise.all([s2JoinPromise, teacherS2NoticePromise]);

    const s1RelayErrPromise = waitForEvent(s1Sock, 'lecture-signal-error');
    s1Sock.emit('webrtc-ice-candidate', {
      targetSocketId: s2Sock.id,
      candidate: testCandidateS2T
    });
    const s1RelayErr = await s1RelayErrPromise;
    assert(
      s1RelayErr.event === 'webrtc-ice-candidate' && s1RelayErr.message.includes('Student-to-student'),
      'Test 11: Student -> student signaling rejected by backend'
    );

    console.log('\n--- Test 12: Cross-lecture target rejected ---');
    const crossSock = connectSocket(teacher.token);
    await waitForEvent(crossSock, 'connect');
    await new Promise((res) => {
      crossSock.emit('join-lecture-room', { lectureId: lectureOther._id.toString() });
      crossSock.on('lecture-room-joined', res);
    });

    const crossOfferErrPromise = waitForEvent(crossSock, 'lecture-signal-error');
    crossSock.emit('webrtc-offer', {
      targetSocketId: s1Sock.id, // s1 is in lecture, crossSock is in lectureOther
      sdp: testSdp
    });
    const crossOfferErr = await crossOfferErrPromise;
    assert(
      crossOfferErr.event === 'webrtc-offer' && crossOfferErr.message.includes('Target student not in this lecture room'),
      'Test 12: Cross-lecture signaling attempt rejected'
    );
    crossSock.close();

    console.log('\n--- Test 13: Student disconnect emits student-left to teacher ---');
    await runAssert('Test 13: Student disconnect notifies teacher with student-left', async () => {
      const studentLeftPromise = waitForEvent(teacherSock, 'student-left');
      const disconnectedStudentId = s2Sock.id;
      s2Sock.close();
      const studentLeftData = await studentLeftPromise;
      if (studentLeftData.studentSocketId !== disconnectedStudentId) {
        throw new Error(`Expected studentSocketId ${disconnectedStudentId}, got ${studentLeftData.studentSocketId}`);
      }
    });

    console.log('\n--- Test 14: Teacher disconnect does NOT set isLive=false ---');
    teacherSock.close();
    await new Promise((res) => setTimeout(res, 500)); // give time for disconnect processing
    const refreshedLecture = await Lecture.findById(lecture._id);
    assert(
      refreshedLecture.isLive === true,
      'Test 14: Teacher disconnect did NOT terminate session (isLive remained true)'
    );

    console.log('\n--- Test 15: Teacher reconnect/rejoin discovers already-connected students ---');
    const teacherSock2 = connectSocket(teacher.token);
    await waitForEvent(teacherSock2, 'connect');

    const teacher2DiscoveryPromise = waitForEvent(teacherSock2, 'student-joined');
    teacherSock2.emit('join-lecture-room', { lectureId: lecture._id.toString() });
    const discoveredStudentData = await teacher2DiscoveryPromise;
    assert(
      discoveredStudentData.studentSocketId === s1Sock.id,
      'Test 15: Reconnected teacher immediately discovered existing connected student (s1)'
    );

    console.log('\n--- Test 16: Check MongoDB for persistent artifacts (No SDP/ICE/socket IDs stored) ---');
    const lecDoc = await Lecture.findById(lecture._id).lean();
    assert(
      lecDoc.sdp === undefined && lecDoc.iceCandidates === undefined && lecDoc.socketId === undefined,
      'Test 16: Verified NO SDP, ICE, or socket IDs persisted to MongoDB'
    );

    console.log('\n--- Cleanup test entities ---');
    teacherSock2.close();
    s1Sock.close();
    outSock.close();

    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email, outsiderEmail] } });
    await Classroom.deleteMany({ _id: classroom._id });
    await Lecture.deleteMany({ _id: { $in: [lecture._id, lectureOther._id] } });

    console.log(`\n========================================`);
    console.log(`Results: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
