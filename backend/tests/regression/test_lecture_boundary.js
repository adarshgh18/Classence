const mongoose = require('mongoose');
const env = require('../../config/env');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Lecture = require('../../models/Lecture');

async function run() {
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

  try {
    await mongoose.connect(env.mongodbUri);

    const base = 'http://localhost:5000/api';
    const req = async (path, body, token) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(base + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    console.log('\n--- Setup Timing Boundary Test Entities ---');
    const tEmail = 'timing_teacher@test.com';
    const otherEmail = 'timing_other@test.com';

    await User.deleteMany({ email: { $in: [tEmail, otherEmail] } });
    await Classroom.deleteMany({ name: 'Timing Test Class' });

    // Register & login teacher
    const regReq = async (name, email) => {
      const r = await fetch(base + '/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password: 'Password@123', role: 'Teacher' })
      });
      const u = await User.findOne({ email }).select('+otp.code');
      await fetch(base + '/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: u.otp.code })
      });
      const l = await fetch(base + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'Password@123' })
      });
      const loginData = await l.json();
      return { user: u, token: loginData.token };
    };

    const teacher = await regReq('Timing Teacher', tEmail);
    const other = await regReq('Timing Other', otherEmail);

    // Create classroom
    const classRes = await fetch(base + '/classroom/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + teacher.token
      },
      body: JSON.stringify({ name: 'Timing Test Class', subject: 'Math', privacy: 'public' })
    });
    const classData = await classRes.json();
    const classroom = classData.classroom;

    // Helper to create test lecture directly in DB with exact startTime offset
    const createTestLecture = async (offsetMs) => {
      const targetTime = new Date(Date.now() + offsetMs);
      const lec = new Lecture({
        title: 'Timing Lecture',
        description: 'Test description',
        date: targetTime.toISOString().slice(0, 10),
        time: targetTime.toTimeString().slice(0, 5),
        startTime: targetTime,
        classroom: classroom._id,
        teacher: teacher.user._id
      });
      return await lec.save();
    };

    console.log('\n--- Running Timing Boundary Test Cases ---');

    // Test A: 2 days before (offset: +48h) -> rejected 400
    const lecA = await createTestLecture(48 * 60 * 60 * 1000);
    const resA = await req('/lecture/start-live-session', { lectureId: lecA._id }, teacher.token);
    assert(
      resA.status === 400 && resA.data?.error === 'Lecture can be started only within 15 minutes of its scheduled time.',
      'Test A: 2 days before scheduled start -> rejected 400'
    );

    // Test B: 16 minutes before (offset: +16 min) -> rejected 400
    const lecB = await createTestLecture(16 * 60 * 1000);
    const resB = await req('/lecture/start-live-session', { lectureId: lecB._id }, teacher.token);
    assert(
      resB.status === 400 && resB.data?.error === 'Lecture can be started only within 15 minutes of its scheduled time.',
      'Test B: 16 minutes before scheduled start -> rejected 400'
    );

    // Test C: exactly 15 minutes before (offset: +15 min - 100ms) -> accepted 200
    // Using 14m59s ensures we fall cleanly inside now >= startTime - 15m
    const lecC = await createTestLecture(15 * 60 * 1000 - 100);
    const resC = await req('/lecture/start-live-session', { lectureId: lecC._id }, teacher.token);
    assert(
      resC.status === 200 && resC.data?.lecture?.isLive === true,
      'Test C: exactly 15 minutes before scheduled start -> accepted 200'
    );

    // Test D: 1 minute before (offset: +1 min) -> accepted 200
    const lecD = await createTestLecture(1 * 60 * 1000);
    const resD = await req('/lecture/start-live-session', { lectureId: lecD._id }, teacher.token);
    assert(
      resD.status === 200 && resD.data?.lecture?.isLive === true,
      'Test D: 1 minute before scheduled start -> accepted 200'
    );

    // Test E: exactly scheduled time (offset: 0) -> accepted 200
    const lecE = await createTestLecture(0);
    const resE = await req('/lecture/start-live-session', { lectureId: lecE._id }, teacher.token);
    assert(
      resE.status === 200 && resE.data?.lecture?.isLive === true,
      'Test E: exactly scheduled time -> accepted 200'
    );

    // Test F: 5 minutes after (offset: -5 min) -> accepted 200
    const lecF = await createTestLecture(-5 * 60 * 1000);
    const resF = await req('/lecture/start-live-session', { lectureId: lecF._id }, teacher.token);
    assert(
      resF.status === 200 && resF.data?.lecture?.isLive === true,
      'Test F: 5 minutes after scheduled time -> accepted 200'
    );

    // Test G: significantly after scheduled time (offset: -7 days) -> accepted 200 (no late-start expiry)
    const lecG = await createTestLecture(-7 * 24 * 60 * 60 * 1000);
    const resG = await req('/lecture/start-live-session', { lectureId: lecG._id }, teacher.token);
    assert(
      resG.status === 200 && resG.data?.lecture?.isLive === true,
      'Test G: significantly after scheduled time (7 days past) -> accepted 200'
    );

    // Test H: non-owner -> 403
    const resH = await req('/lecture/start-live-session', { lectureId: lecE._id }, other.token);
    assert(
      resH.status === 403 && resH.data?.error === 'Only teacher can start live session.',
      'Test H: non-owner attempts start -> 403 Forbidden'
    );

    // Test I: missing lectureId -> 400
    const resI = await req('/lecture/start-live-session', {}, teacher.token);
    assert(
      resI.status === 400 && resI.data?.error === 'Lecture ID required.',
      'Test I: missing lectureId -> 400 Bad Request'
    );

    // Test J: lecture not found -> 404
    const fakeId = new mongoose.Types.ObjectId();
    const resJ = await req('/lecture/start-live-session', { lectureId: fakeId }, teacher.token);
    assert(
      resJ.status === 404 && resJ.data?.error === 'Lecture not found.',
      'Test J: nonexistent lecture -> 404 Not Found'
    );

    // Stop session verification
    console.log('\n--- Stop Session Verification ---');
    const stopRes = await req('/lecture/stop-live-session', { lectureId: lecE._id }, teacher.token);
    assert(
      stopRes.status === 200 && stopRes.data?.lecture?.isLive === false,
      'Stop Session: lecture.isLive transitioned from true to false (200)'
    );

    // Cleanup all created test data
    await User.deleteMany({ email: { $in: [tEmail, otherEmail] } });
    await Classroom.deleteMany({ _id: classroom._id });
    await Lecture.deleteMany({ classroom: classroom._id });

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

run();
