const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');

const BASE_URL = 'http://localhost:5000/api';

const fetchData = async (method, path, body = null, token = null) => {
  const options = { method, headers: {} };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  
  if (body) {
    if (body instanceof FormData) {
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }
  
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const runTests = async () => {
  let passed = 0, failed = 0;
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
    console.log('--- Setting up Environment for Dashboard ---');
    const u1 = `t_dash_${Date.now()}@test.com`;
    const u2 = `s_dash_${Date.now()}@test.com`;
    
    // Create Users
    await fetchData('POST', '/auth/register', { name: 'Teacher', email: u1, password: 'Password@123' });
    const user1 = await User.findOne({ email: u1 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: u1, otp: user1.otp.code });
    const t1 = (await fetchData('POST', '/auth/login', { email: u1, password: 'Password@123' })).data.token;

    await fetchData('POST', '/auth/register', { name: 'Student', email: u2, password: 'Password@123' });
    const user2 = await User.findOne({ email: u2 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: u2, otp: user2.otp.code });
    const t2 = (await fetchData('POST', '/auth/login', { email: u2, password: 'Password@123' })).data.token;

    await test('Empty Dashboard structure', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, t1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.details.name, 'Teacher');
      
      const { joined, created } = res.data.details;
      assert(Array.isArray(joined.assignments));
      assert(Array.isArray(joined.averageAttendance));
      assert(Array.isArray(joined.dueSoonAssignments));
      
      assert(Array.isArray(created.assignments));
      assert(Array.isArray(created.averageAttendance));
      assert(Array.isArray(created.dueSoonAssignments));
    });

    console.log('\n--- Populating Data ---');
    let classCode = (await fetchData('POST', '/classroom/create', { name: 'Dash Class', subject: 'Math', privacy: 'public' }, t1)).data.classroom.code;
    const classRes = await fetchData('GET', `/classroom/details?code=${classCode}`, null, t1);
    const classId = classRes.data.classroom._id;
    
    await fetchData('POST', '/classroom/join', { code: classCode }, t2);

    const form = new FormData();
    form.append('name', 'HW1');
    form.append('code', classCode);
    form.append('dueDate', new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString());
    form.append('instructions', 'Test instruction');
    form.append('totalMarks', 10);

    const assignRes = await fetchData('POST', '/assignment/create', form, t1);
    assert.strictEqual(assignRes.status, 201);

    await test('Dashboard with data structure (Joined before submission)', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, t2);
      const joined = res.data.details.joined;
      
      assert.strictEqual(joined.averageAttendance.length, 1);
      assert.strictEqual(joined.averageAttendance[0].className, 'Math');
      
      assert.strictEqual(joined.assignments.length, 1);
      assert.strictEqual(joined.assignments[0].assignments[0].title, 'HW1');
      
      // Before submitting, HW1 is due soon for student
      assert.strictEqual(joined.dueSoonAssignments.length, 1);
      assert.strictEqual(joined.dueSoonAssignments[0].title, 'HW1');
    });

    await test('Dashboard with data structure (Created)', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, t1);
      const created = res.data.details.created;
      
      // Average Attendance expects { className, date, attendance }
      assert.strictEqual(created.averageAttendance.length, 1);
      assert.strictEqual(created.averageAttendance[0].className, 'Math');
      assert.strictEqual(created.averageAttendance[0].attendance, 0);

      // Assignments expects { classroomSubject, assignments: [] }
      assert.strictEqual(created.assignments.length, 1);
      assert.strictEqual(created.assignments[0].classroomSubject, 'Math');
      assert.strictEqual(created.assignments[0].assignments[0].title, 'HW1');
      assert.strictEqual(created.assignments[0].assignments[0].isGraded, false);
      
      // Teacher review queue expects 0 when there are no submissions
      assert.strictEqual(created.dueSoonAssignments.length, 0);

      // Now student submits HW1
      await fetchData('POST', '/submission/create', { assignmentId: assignRes.data.assignment._id, text: 'Done' }, t2);

      const resAfterSub = await fetchData('GET', '/user/dashboard', null, t1);
      const createdAfterSub = resAfterSub.data.details.created;
      assert.strictEqual(createdAfterSub.dueSoonAssignments.length, 1);
      assert.strictEqual(createdAfterSub.dueSoonAssignments[0].title, 'HW1');
      assert.strictEqual(createdAfterSub.dueSoonAssignments[0].pendingReviews, 1);

      // And for student, it should no longer be in dueSoonAssignments
      const resJoinedAfter = await fetchData('GET', '/user/dashboard', null, t2);
      assert.strictEqual(resJoinedAfter.data.details.joined.dueSoonAssignments.length, 0);
    });

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error('Fatal Test Error:', e);
    process.exit(1);
  }
};

runTests();
