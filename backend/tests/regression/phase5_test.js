const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');

const BASE_URL = 'http://localhost:5000/api';

const fetchData = async (method, path, body = null, token = null) => {
  const options = {
    method,
    headers: {}
  };
  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const runTests = async () => {
  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   ${err.message}`);
      failed++;
    }
  };

  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/classence');

    console.log('--- Setting up Users & Classroom ---');
    const uTeacher = `teacher5_${Date.now()}@test.com`;
    const uStudent = `student5_${Date.now()}@test.com`;
    const uOther = `other5_${Date.now()}@test.com`;

    await fetchData('POST', '/auth/register', { name: 'Teacher', email: uTeacher, password: 'Password@123' });
    const userA = await User.findOne({ email: uTeacher }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uTeacher, otp: userA.otp.code });

    await fetchData('POST', '/auth/register', { name: 'Student', email: uStudent, password: 'Password@123' });
    const userB = await User.findOne({ email: uStudent }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uStudent, otp: userB.otp.code });

    await fetchData('POST', '/auth/register', { name: 'Other', email: uOther, password: 'Password@123' });
    const userC = await User.findOne({ email: uOther }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uOther, otp: userC.otp.code });

    let tTeacher = (await fetchData('POST', '/auth/login', { email: uTeacher, password: 'Password@123' })).data.token;
    let tStudent = (await fetchData('POST', '/auth/login', { email: uStudent, password: 'Password@123' })).data.token;
    let tOther = (await fetchData('POST', '/auth/login', { email: uOther, password: 'Password@123' })).data.token;

    let classCode = (await fetchData('POST', '/classroom/create', { name: 'Phase 5 Class', subject: 'P5', privacy: 'public' }, tTeacher)).data.classroom.code;
    await fetchData('POST', '/classroom/join', { code: classCode }, tStudent);

    console.log('\n--- 1. POST /api/lecture/create ---');
    let lectureId = null;
    await test('Non-teacher cannot create lecture', async () => {
      const res = await fetchData('POST', '/lecture/create', { title: 'L1', description: 'Desc', date: '2026-10-10', time: '10:00', code: classCode }, tStudent);
      assert.strictEqual(res.status, 403, 'Should reject non-teacher');
    });

    await test('Teacher can create lecture', async () => {
      const res = await fetchData('POST', '/lecture/create', { title: 'L1', description: 'Desc', date: '2026-10-10', time: '10:00', code: classCode }, tTeacher);
      assert.strictEqual(res.status, 201, 'Should create lecture');
      lectureId = res.data.lecture._id;
    });

    console.log('\n--- 2. GET /api/lecture/ ---');
    await test('Unauthorized user cannot view lectures', async () => {
      const res = await fetchData('GET', `/lecture/?code=${classCode}`, null, tOther);
      assert.strictEqual(res.status, 403, 'Should reject non-member');
    });

    await test('Member can view lectures', async () => {
      const res = await fetchData('GET', `/lecture/?code=${classCode}`, null, tStudent);
      assert.strictEqual(res.status, 200);
      assert(res.data.futureLectures.length === 1);
      assert(res.data.futureLectures[0].title === 'L1');
    });

    console.log('\n--- 3. PATCH /api/lecture/update ---');
    await test('Teacher can update lecture', async () => {
      const res = await fetchData('PATCH', `/lecture/update?lectureId=${lectureId}`, { title: 'Updated L1' }, tTeacher);
      assert.strictEqual(res.status, 200);
      assert(res.data.lecture.title === 'Updated L1');
    });

    console.log('\n--- 4. POST /api/lecture/start-live-session ---');
    await test('Teacher can start live session', async () => {
      const res = await fetchData('POST', '/lecture/start-live-session', { lectureId }, tTeacher);
      assert.strictEqual(res.status, 200);
      assert(res.data.lecture.isLive === true);
    });

    console.log('\n--- 5. POST /api/lecture/mark ---');
    await test('Non-student cannot mark attendance', async () => {
      const res = await fetchData('POST', '/lecture/mark', { lectureId }, tOther);
      assert.strictEqual(res.status, 403);
    });

    await test('Student can mark attendance (returns empty youtube string to avoid crash)', async () => {
      const res = await fetchData('POST', '/lecture/mark', { lectureId }, tStudent);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.lecture.youtubeLiveStreamURL, "");
    });

    await test('Duplicate attendance is prevented gracefully', async () => {
      const res = await fetchData('POST', '/lecture/mark', { lectureId }, tStudent);
      assert.strictEqual(res.status, 200, 'Should not error on duplicate');
    });

    console.log('\n--- 6. POST /api/lecture/stop-live-session ---');
    await test('Teacher can stop live session', async () => {
      const res = await fetchData('POST', '/lecture/stop-live-session', { lectureId }, tTeacher);
      assert.strictEqual(res.status, 200);
      assert(res.data.lecture.isLive === false);
    });

    await test('Teacher completes lecture for finalized attendance', async () => {
      const res = await fetchData('POST', '/lecture/complete-lecture', { lectureId }, tTeacher);
      assert.strictEqual(res.status, 200);
    });

    console.log('\n--- 7. GET /api/classroom/attendance ---');
    await test('Teacher views attendance correctly', async () => {
      const res = await fetchData('GET', `/classroom/attendance?classCode=${classCode}`, null, tTeacher);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.isTeacher, true);
      assert.strictEqual(res.data.lectureData[0].totalPresent, 1);
    });

    await test('Student views attendance streak correctly', async () => {
      const res = await fetchData('GET', `/classroom/attendance?classCode=${classCode}`, null, tStudent);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.isTeacher, false);
      assert.strictEqual(res.data.totalPresent, 1);
      assert.strictEqual(res.data.currentStreak, 1);
      assert.strictEqual(res.data.lectureData[0].attendance, 'Present');
    });

    console.log('\n--- 8. GET /api/user/calendar ---');
    await test('Calendar includes lecture data properly', async () => {
      const res = await fetchData('GET', `/user/calendar`, null, tStudent);
      assert.strictEqual(res.status, 200);
      assert(res.data.details.joined.length > 0);
      const myClass = res.data.details.joined.find(c => c.code === classCode);
      assert(myClass.lectures.length === 1);
      assert(myClass.lectures[0].title === 'Updated L1');
    });

    console.log('\n--- 9. DELETE /api/lecture/delete ---');
    await test('Teacher can delete lecture', async () => {
      const res = await fetchData('DELETE', `/lecture/delete?lectureId=${lectureId}`, null, tTeacher);
      assert.strictEqual(res.status, 200);
    });

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
    await mongoose.disconnect();
    process.exit(failed === 0 ? 0 : 1);
  } catch(e) {
    console.error('Fatal error in tests:', e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

runTests();
