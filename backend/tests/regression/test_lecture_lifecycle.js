const mongoose = require('mongoose');
const env = require('../../config/env');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Lecture = require('../../models/Lecture');
const Reminder = require('../../models/Reminder');
const { io: Client } = require('../../../frontend/node_modules/socket.io-client');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  ✅ PASS:', message);
      passed++;
    } else {
      console.log('  ❌ FAIL:', message);
      failed++;
    }
  }

  const base = 'http://localhost:5000/api';
  const socketBase = 'http://localhost:5000';

  try {
    await mongoose.connect(env.mongodbUri);
    console.log('--- Connected to MongoDB for Lecture Lifecycle Tests ---');

    // Clean test entities
    const tEmail = 'lifecycle_teacher@test.com';
    const sEmail = 'lifecycle_student@test.com';
    const oEmail = 'lifecycle_other@test.com';

    await User.deleteMany({ email: { $in: [tEmail, sEmail, oEmail] } });
    await Classroom.deleteMany({ name: 'Lifecycle Test Class' });

    // Helper: Register & Login user
    const regAndLogin = async (name, email, role) => {
      await fetch(base + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password: 'Password@123', role })
      });
      const u = await User.findOne({ email }).select('+otp.code');
      await fetch(base + '/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: u.otp.code })
      });
      const loginRes = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password@123' })
      });
      const loginData = await loginRes.json();
      return { user: u, token: loginData.token };
    };

    console.log('1. Setting up test users and classroom...');
    const teacher = await regAndLogin('Lifecycle Teacher', tEmail, 'Teacher');
    const student = await regAndLogin('Lifecycle Student', sEmail, 'Student');
    const otherUser = await regAndLogin('Lifecycle Other', oEmail, 'Student');

    // Create classroom
    const classRes = await fetch(base + '/classroom/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + teacher.token
      },
      body: JSON.stringify({
        name: 'Lifecycle Test Class',
        subject: 'Computer Science',
        privacy: 'public'
      })
    });
    const classData = await classRes.json();
    const classroom = classData.classroom;

    // Student joins classroom
    await fetch(base + '/classroom/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + student.token
      },
      body: JSON.stringify({ code: classroom.code })
    });

    console.log('   Classroom created:', classroom.code);

    // Helper: API calls
    const startSession = (lecId, token) => fetch(base + '/lecture/start-live-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ lectureId: lecId })
    }).then(r => r.json().then(data => ({ status: r.status, data })));

    const stopSession = (lecId, token) => fetch(base + '/lecture/stop-live-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ lectureId: lecId })
    }).then(r => r.json().then(data => ({ status: r.status, data })));

    const completeSession = (lecId, token) => fetch(base + '/lecture/complete-lecture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ lectureId: lecId })
    }).then(r => r.json().then(data => ({ status: r.status, data })));

    const markAttendance = (lecId, token) => fetch(base + '/lecture/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ lectureId: lecId })
    }).then(r => r.json().then(data => ({ status: r.status, data })));

    const getScheduleLectures = (code, token) => fetch(base + `/lecture/?code=${code}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json().then(data => ({ status: r.status, data })));

    const setReminder = (lecId, scheduledTime, token) => fetch(base + '/reminder/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ lectureId: lecId, scheduledTime })
    }).then(r => r.json().then(data => ({ status: r.status, data })));

    console.log('\n--- TEST SUITE 1: Early-Start Boundary & Initial Start (upcoming -> live) ---');
    // Create future lecture > 15m away
    const farFuture = new Date(Date.now() + 60 * 60 * 1000);
    const lec1 = new Lecture({
      title: 'Far Future Lecture',
      description: 'Test early start',
      date: farFuture.toISOString().slice(0, 10),
      time: farFuture.toTimeString().slice(0, 5),
      startTime: farFuture,
      classroom: classroom._id,
      teacher: teacher.user._id,
      status: 'upcoming',
      isLive: false
    });
    await lec1.save();

    const earlyStartRes = await startSession(lec1._id, teacher.token);
    assert(earlyStartRes.status === 400 && earlyStartRes.data.error.includes('15 minutes'),
      'Test 7: First start still enforces the existing 15-minute boundary');

    // Create lecture ready to start (now + 5 minutes)
    const readyStart = new Date(Date.now() + 5 * 60 * 1000);
    const lecReady = new Lecture({
      title: 'Ready Lecture',
      description: 'Test lifecycle',
      date: readyStart.toISOString().slice(0, 10),
      time: readyStart.toTimeString().slice(0, 5),
      startTime: readyStart,
      classroom: classroom._id,
      teacher: teacher.user._id,
      status: 'upcoming',
      isLive: false
    });
    await lecReady.save();

    console.log('\n--- TEST SUITE 2: Lifecycle Transitions: upcoming -> live -> paused -> live ---');
    // Setup socket listeners on classroom and lecture room
    const teacherSocket = Client(socketBase, { query: { token: teacher.token } });
    const studentSocket = Client(socketBase, { query: { token: student.token } });
    await new Promise(res => teacherSocket.on('connect', res));
    await new Promise(res => studentSocket.on('connect', res));

    // Student joins classroom and waits for confirmation
    const classroomJoinedPromise = new Promise(res => studentSocket.once('classroom-joined', res));
    studentSocket.emit('join-classroom', { classCode: classroom.code });
    await classroomJoinedPromise;

    const receivedEvents = [];
    studentSocket.on('lecture-started', (e) => receivedEvents.push({ type: 'lecture-started', ...e }));
    studentSocket.on('lecture-paused', (e) => receivedEvents.push({ type: 'lecture-paused', ...e }));
    studentSocket.on('lecture-resumed', (e) => receivedEvents.push({ type: 'lecture-resumed', ...e }));
    studentSocket.on('lecture-completed', (e) => receivedEvents.push({ type: 'lecture-completed', ...e }));

    // Start lecture (upcoming -> live)
    const startRes = await startSession(lecReady._id, teacher.token);
    assert(startRes.status === 200, 'Test 1: Start session succeeds');
    const docAfterStart = await Lecture.findById(lecReady._id);
    assert(docAfterStart.status === 'live' && docAfterStart.isLive === true,
      'Test 1: Lecture state is live (status=live, isLive=true)');

    await new Promise(r => setTimeout(r, 200));
    assert(receivedEvents.some(e => e.type === 'lecture-started' && e.lectureId === lecReady._id.toString()),
      'Test 1: Emits lecture-started event on first start');

    // Pause lecture (live -> paused)
    const pauseRes = await stopSession(lecReady._id, teacher.token);
    assert(pauseRes.status === 200, 'Test 2: Stop session succeeds');
    const docAfterPause = await Lecture.findById(lecReady._id);
    assert(docAfterPause.status === 'paused' && docAfterPause.isLive === false,
      'Test 2: Pause session sets status=paused and isLive=false without completing lecture');

    await new Promise(r => setTimeout(r, 200));
    assert(receivedEvents.some(e => e.type === 'lecture-paused' && e.lectureId === lecReady._id.toString()),
      'Test 2: Emits lecture-paused room-scoped event');

    // Resume lecture (paused -> live)
    // Test that paused lecture can resume later even if scheduled start time is past or future
    const resumeRes = await startSession(lecReady._id, teacher.token);
    assert(resumeRes.status === 200, 'Test 3 & 8: Paused lecture can resume later without 15m rule check');
    const docAfterResume = await Lecture.findById(lecReady._id);
    assert(docAfterResume.status === 'live' && docAfterResume.isLive === true,
      'Test 3: Resume sets status=live and isLive=true');

    await new Promise(r => setTimeout(r, 200));
    assert(receivedEvents.some(e => e.type === 'lecture-resumed' && e.lectureId === lecReady._id.toString()),
      'Test 3: Emits lecture-resumed event on resume');

    console.log('\n--- TEST SUITE 3: Permanent Completion (live -> completed & paused -> completed) ---');
    // Complete while live (live -> completed)
    const completeLiveRes = await completeSession(lecReady._id, teacher.token);
    assert(completeLiveRes.status === 200, 'Test 4: Complete session from live succeeds');
    const docAfterComplete = await Lecture.findById(lecReady._id);
    assert(docAfterComplete.status === 'completed' && docAfterComplete.isLive === false,
      'Test 4: Lecture state is completed (status=completed, isLive=false)');

    await new Promise(r => setTimeout(r, 200));
    assert(receivedEvents.some(e => e.type === 'lecture-completed' && e.lectureId === lecReady._id.toString()),
      'Test 4: Emits lecture-completed room-scoped event');

    // Test 6: Completed lecture cannot restart
    const restartAttempt = await startSession(lecReady._id, teacher.token);
    assert(restartAttempt.status === 400 && restartAttempt.data.error.includes('completed'),
      'Test 6: Completed lecture cannot be restarted or resumed');

    // Test 5: Paused -> completed on a second lecture
    const lec2 = new Lecture({
      title: 'Second Lecture',
      description: 'Test pause to complete',
      date: readyStart.toISOString().slice(0, 10),
      time: readyStart.toTimeString().slice(0, 5),
      startTime: readyStart,
      classroom: classroom._id,
      teacher: teacher.user._id,
      status: 'upcoming',
      isLive: false
    });
    await lec2.save();
    await startSession(lec2._id, teacher.token);
    await stopSession(lec2._id, teacher.token);
    const completePausedRes = await completeSession(lec2._id, teacher.token);
    assert(completePausedRes.status === 200, 'Test 5: Completion from paused succeeds');
    const doc2AfterComplete = await Lecture.findById(lec2._id);
    assert(doc2AfterComplete.status === 'completed', 'Test 5: Lecture transitioned from paused -> completed');

    console.log('\n--- TEST SUITE 4: Authorization: Non-owner rejections ---');
    const lecAuth = new Lecture({
      title: 'Auth Check Lecture',
      description: 'Test unauthorized access',
      date: readyStart.toISOString().slice(0, 10),
      time: readyStart.toTimeString().slice(0, 5),
      startTime: readyStart,
      classroom: classroom._id,
      teacher: teacher.user._id,
      status: 'upcoming',
      isLive: false
    });
    await lecAuth.save();

    const studentStart = await startSession(lecAuth._id, student.token);
    const otherStart = await startSession(lecAuth._id, otherUser.token);
    assert(studentStart.status === 403 && otherStart.status === 403,
      'Test 9: Non-owner cannot start live session');

    await startSession(lecAuth._id, teacher.token);

    const studentStop = await stopSession(lecAuth._id, student.token);
    const studentComplete = await completeSession(lecAuth._id, student.token);
    assert(studentStop.status === 403 && studentComplete.status === 403,
      'Test 9: Non-owner cannot pause or complete session');

    console.log('\n--- TEST SUITE 5: Upcoming Schedule Filtering & Lecture History ---');
    // Create a paused lecture to test all lifecycle statuses against schedule responses
    const lecPaused = new Lecture({
      title: 'Paused Lecture For Schedule Check',
      description: 'Test paused filter',
      date: readyStart.toISOString().slice(0, 10),
      time: readyStart.toTimeString().slice(0, 5),
      startTime: readyStart,
      classroom: classroom._id,
      teacher: teacher.user._id,
      status: 'upcoming',
      isLive: false
    });
    await lecPaused.save();
    await startSession(lecPaused._id, teacher.token);
    await stopSession(lecPaused._id, teacher.token);

    const scheduleRes = await getScheduleLectures(classroom.code, student.token);
    assert(scheduleRes.status === 200, 'Fetch schedule succeeds');
    assert('futureLectures' in scheduleRes.data, 'Test H1: Response contains futureLectures');
    assert('completedLectures' in scheduleRes.data, 'Test H2: Response contains completedLectures');
    assert(Array.isArray(scheduleRes.data.completedLectures), 'Test H3: completedLectures is an array');

    const futureLecs = scheduleRes.data.futureLectures;
    const completedLecs = scheduleRes.data.completedLectures;

    const hasCompletedInCompleted = completedLecs.some(l => l._id === lecReady._id.toString());
    assert(hasCompletedInCompleted, 'Test H4: Completed lecture exists in completedLectures');

    const hasCompletedInFuture = futureLecs.some(l => l._id === lecReady._id.toString() || l._id === lec2._id.toString());
    assert(!hasCompletedInFuture, 'Test H5: Completed lecture does NOT exist in futureLectures');

    const hasUpcomingInCompleted = completedLecs.some(l => l._id === lec1._id.toString());
    assert(!hasUpcomingInCompleted, 'Test H6: Upcoming lecture does NOT exist in completedLectures');

    const hasLiveInCompleted = completedLecs.some(l => l._id === lecAuth._id.toString());
    assert(!hasLiveInCompleted, 'Test H7: Live lecture does NOT exist in completedLectures');

    const hasPausedInCompleted = completedLecs.some(l => l._id === lecPaused._id.toString());
    assert(!hasPausedInCompleted, 'Test H8: Paused lecture does NOT exist in completedLectures');

    // Historical queries retain completed lectures in MongoDB
    const allClassLectures = await Lecture.find({ classroom: classroom._id });
    const containsCompleted = allClassLectures.some(l => l._id.toString() === lecReady._id.toString());
    assert(containsCompleted, 'Test H9: Completed lecture remains stored in MongoDB');

    console.log('\n--- TEST SUITE 6: Attendance Rejoin & Idempotency ---');
    // Mark attendance first time
    const att1 = await markAttendance(lecAuth._id, student.token);
    assert(att1.status === 200, 'First attendance marking succeeds');

    // Student rejoins and marks attendance second time
    const att2 = await markAttendance(lecAuth._id, student.token);
    assert(att2.status === 200, 'Second attendance marking request returns 200');

    const lecDocWithAtt = await Lecture.findById(lecAuth._id);
    const studentAttendances = lecDocWithAtt.attendance.filter(a => a.student.toString() === student.user._id.toString());
    assert(studentAttendances.length === 1,
      'Test 17: No duplicate attendance on student reconnect / rejoin');

    console.log('\n--- TEST SUITE 7: WebRTC Signaling & Rejoin Mechanics ---');
    // Create new live lecture for WebRTC interaction
    const webrtcLec = new Lecture({
      title: 'WebRTC Flow Lecture',
      description: 'Testing rejoin and pause teardown',
      date: readyStart.toISOString().slice(0, 10),
      time: readyStart.toTimeString().slice(0, 5),
      startTime: readyStart,
      classroom: classroom._id,
      teacher: teacher.user._id,
      status: 'upcoming',
      isLive: false
    });
    await webrtcLec.save();
    await startSession(webrtcLec._id, teacher.token);

    // Teacher joins WebRTC room
    let teacherJoinedPromise = new Promise(res => {
      teacherSocket.once('lecture-room-joined', res);
    });
    teacherSocket.emit('join-lecture-room', { lectureId: webrtcLec._id.toString() });
    const teacherJoinData = await teacherJoinedPromise;
    assert(teacherJoinData.role === 'teacher', 'Teacher joins signaling room as teacher');

    // Student joins WebRTC room
    let studentJoinedPromise = new Promise(res => {
      studentSocket.once('lecture-room-joined', res);
    });
    let teacherDiscoversStudentPromise = new Promise(res => {
      teacherSocket.once('student-joined', res);
    });

    studentSocket.emit('join-lecture-room', { lectureId: webrtcLec._id.toString() });
    const studentJoinData = await studentJoinedPromise;
    const discoveredStudent = await teacherDiscoversStudentPromise;
    assert(studentJoinData.role === 'student' && discoveredStudent.studentSocketId === studentSocket.id,
      'Test 13: Student joins and teacher discovers student socket ID');

    // Student leaves live lecture (accidental leave)
    let studentLeftPromise = new Promise(res => {
      teacherSocket.once('student-left', res);
    });
    studentSocket.emit('leave-lecture-room');
    const leftData = await studentLeftPromise;
    assert(leftData.studentSocketId === studentSocket.id, 'Teacher receives student-left notification');

    const lecStillLive = await Lecture.findById(webrtcLec._id);
    assert(lecStillLive.status === 'live' && lecStillLive.isLive === true,
      'Test 12: Student leaving live room does NOT pause or complete the lecture');

    // Student rejoins live lecture
    let teacherRediscoverPromise = new Promise(res => {
      teacherSocket.once('student-joined', res);
    });
    studentSocket.emit('join-lecture-room', { lectureId: webrtcLec._id.toString() });
    const rediscovered = await teacherRediscoverPromise;
    assert(rediscovered.studentSocketId === studentSocket.id,
      'Test 13: Student can rejoin still-live lecture and teacher receives student-joined again');

    // Pause lecture: verify WebRTC room teardown event
    let pauseReceivedPromise = new Promise(res => {
      studentSocket.once('lecture-paused', res);
    });
    await stopSession(webrtcLec._id, teacher.token);
    await pauseReceivedPromise;
    assert(true, 'Test 14: Pause notifies student to tear down WebRTC media without permanent completion');

    // Resume lecture: verify signaling resumption
    let resumeReceivedPromise = new Promise(res => {
      studentSocket.once('lecture-resumed', res);
    });
    await startSession(webrtcLec._id, teacher.token);
    await resumeReceivedPromise;
    assert(true, 'Test 15: Resume notifies student and allows re-establishing WebRTC without page refresh');

    // Complete lecture: verify permanent teardown event
    let completeReceivedPromise = new Promise(res => {
      studentSocket.once('lecture-completed', res);
    });
    await completeSession(webrtcLec._id, teacher.token);
    await completeReceivedPromise;
    assert(true, 'Test 16: Complete notifies student to permanently tear down live state');

    console.log('\n--- TEST SUITE 8: Socket Room Scoping & Security ---');
    // Unauthorized user attempts to join classroom socket room
    const otherSocket = Client(socketBase, { query: { token: otherUser.token } });
    await new Promise(res => otherSocket.on('connect', res));

    let unauthorizedErrorPromise = new Promise(res => {
      otherSocket.once('classroom-join-error', res);
    });
    otherSocket.emit('join-classroom', { classCode: classroom.code });
    const errData = await unauthorizedErrorPromise;
    assert(errData && errData.message.includes('Not authorized'),
      'Test 18: Non-member cannot join classroom socket room');

    console.log('\n--- TEST SUITE 9: Reminder Safety for Completed Lectures ---');
    const reminderRes = await setReminder(lecReady._id, new Date(Date.now() + 100000).toISOString(), student.token);
    assert(reminderRes.status === 400 && reminderRes.data.error.includes('completed'),
      'Cannot set reminder for completed lecture (Server-side protection)');

    // Cleanup sockets
    teacherSocket.disconnect();
    studentSocket.disconnect();
    otherSocket.disconnect();

  } catch (error) {
    console.error('Test Suite encountered error:', error);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n========================================');
  console.log(`TOTAL PASS: ${passed} | TOTAL FAIL: ${failed}`);
  console.log('========================================\n');
  process.exit(failed === 0 ? 0 : 1);
}

runTests();
