const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Assignment = require('../../models/Assignment');
const Submission = require('../../models/Submission');
const Lecture = require('../../models/Lecture');

const BASE_URL = 'http://localhost:5000/api';

const fetchData = async (method, path, body = null, token = null) => {
  const options = { method, headers: {} };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
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
    console.log('=== Running Dashboard Audit Fixes Test Suite ===');

    const suffix = Date.now();
    const teacherEmail = `t_dashfix_${suffix}@test.com`;
    const studentEmail = `s_dashfix_${suffix}@test.com`;
    const student2Email = `s2_dashfix_${suffix}@test.com`;

    // 1. Register & Verify Teacher
    await fetchData('POST', '/auth/register', { name: 'Teacher Dash', email: teacherEmail, password: 'Password@123' });
    const teacherUser = await User.findOne({ email: teacherEmail }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: teacherEmail, otp: teacherUser.otp.code });
    const tToken = (await fetchData('POST', '/auth/login', { email: teacherEmail, password: 'Password@123' })).data.token;

    // 2. Register & Verify Student 1
    await fetchData('POST', '/auth/register', { name: 'Student Dash', email: studentEmail, password: 'Password@123' });
    const studentUser = await User.findOne({ email: studentEmail }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: studentEmail, otp: studentUser.otp.code });
    const sToken = (await fetchData('POST', '/auth/login', { email: studentEmail, password: 'Password@123' })).data.token;

    // 3. Register & Verify Student 2 (non-member)
    await fetchData('POST', '/auth/register', { name: 'Student Other', email: student2Email, password: 'Password@123' });
    const student2User = await User.findOne({ email: student2Email }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: student2Email, otp: student2User.otp.code });
    const s2Token = (await fetchData('POST', '/auth/login', { email: student2Email, password: 'Password@123' })).data.token;

    // 4. Create Classroom
    const createClassRes = await fetchData('POST', '/classroom/create', {
      name: 'Dashboard Audit Class',
      subject: 'Physics',
      privacy: 'public'
    }, tToken);
    assert.strictEqual(createClassRes.status, 201);
    const classroom = createClassRes.data.classroom;

    // 5. Student joins classroom
    const joinRes = await fetchData('POST', '/classroom/join', { code: classroom.code }, sToken);
    assert.strictEqual(joinRes.status, 200);

    // ==========================================
    // TEST SUITE A: ASSIGNMENT SEMANTICS
    // ==========================================

    // Dates setup
    const now = new Date();
    const formatYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const todayStr = formatYMD(now);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = formatYMD(tomorrow);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = formatYMD(yesterday);
    const fourDaysLater = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
    const fourDaysStr = formatYMD(fourDaysLater);

    // Assignment 1: Due tomorrow, submitted & graded
    const a1 = new Assignment({
      name: 'Assignment 1 Graded',
      description: 'Test A1',
      dueDate: tomorrowStr,
      classroom: classroom._id,
      teacher: teacherUser._id
    });
    await a1.save();

    const sub1 = new Submission({
      assignment: a1._id,
      student: studentUser._id,
      classroom: classroom._id,
      marks: 9,
      isGraded: true
    });
    await sub1.save();

    // Assignment 2: Due today, unsubmitted
    const a2 = new Assignment({
      name: 'Assignment 2 Due Today',
      description: 'Test A2',
      dueDate: todayStr,
      classroom: classroom._id,
      teacher: teacherUser._id
    });
    await a2.save();

    await test('A1: Current state — 1 submitted/graded + 1 unsubmitted due today => Completed=1, DueSoon=1, Overdue=0', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const joined = res.data.details.joined;
      assert.strictEqual(joined.stats.completedTotalAssignments, 1, 'Completed should be 1');
      assert.strictEqual(joined.stats.dueSoonTotalAssignments, 1, 'Due Soon should be 1');
      assert.strictEqual(joined.stats.overdueTotalAssignments, 0, 'Overdue should be 0');
      assert.strictEqual(joined.dueSoonAssignments.length, 1, 'dueSoonAssignments array must have 1 element');
      assert.strictEqual(joined.dueSoonAssignments[0]._id.toString(), a2._id.toString());
      assert.strictEqual(joined.dueSoonAssignments[0].dueDate, todayStr, 'dueDate must be canonical YYYY-MM-DD');
    });

    // Assignment 3: Submitted but UNGRADED
    const a3 = new Assignment({
      name: 'Assignment 3 Submitted Ungraded',
      description: 'Test A3',
      dueDate: fourDaysStr,
      classroom: classroom._id,
      teacher: teacherUser._id
    });
    await a3.save();

    const sub3 = new Submission({
      assignment: a3._id,
      student: studentUser._id,
      classroom: classroom._id,
      isGraded: false,
      marks: null
    });
    await sub3.save();

    await test('A2: Submitted but ungraded assignment counts as Completed, not Due Soon/Overdue', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const stats = res.data.details.joined.stats;
      assert.strictEqual(stats.completedTotalAssignments, 2, 'Completed should now be 2 (A1 graded + A3 submitted)');
      assert.strictEqual(stats.dueSoonTotalAssignments, 1, 'Due Soon remains 1 (A2)');
      assert.strictEqual(stats.overdueTotalAssignments, 0, 'Overdue remains 0');
    });

    // Assignment 4: Past due unsubmitted
    const a4 = new Assignment({
      name: 'Assignment 4 Past Due Unsubmitted',
      description: 'Test A4',
      dueDate: yesterdayStr,
      classroom: classroom._id,
      teacher: teacherUser._id
    });
    await a4.save();

    await test('A3: Past due unsubmitted counts as Overdue', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const stats = res.data.details.joined.stats;
      assert.strictEqual(stats.completedTotalAssignments, 2);
      assert.strictEqual(stats.dueSoonTotalAssignments, 1);
      assert.strictEqual(stats.overdueTotalAssignments, 1, 'Overdue should be 1 for yesterday unsubmitted');
    });

    // ==========================================
    // TEST SUITE B: ATTENDANCE
    // ==========================================

    // Lecture 1: completed, attended by student
    const lec1 = new Lecture({
      title: 'Lec 1 Completed Attended',
      description: 'Lec 1',
      date: yesterdayStr,
      time: '10:00',
      startTime: yesterday,
      classroom: classroom._id,
      teacher: teacherUser._id,
      status: 'completed',
      attendance: [{ student: studentUser._id, timestamp: yesterday }]
    });
    await lec1.save();

    // Lecture 2: upcoming tomorrow, not attended
    const lec2 = new Lecture({
      title: 'Lec 2 Upcoming Tomorrow',
      description: 'Lec 2',
      date: tomorrowStr,
      time: '14:00',
      startTime: tomorrow,
      classroom: classroom._id,
      teacher: teacherUser._id,
      status: 'upcoming',
      attendance: []
    });
    await lec2.save();

    // Lecture 3: live now, not attended
    const lec3 = new Lecture({
      title: 'Lec 3 Live Now',
      description: 'Lec 3',
      date: todayStr,
      time: '11:00',
      startTime: now,
      classroom: classroom._id,
      teacher: teacherUser._id,
      status: 'live',
      attendance: []
    });
    await lec3.save();

    // Lecture 4: paused now, not attended
    const lec4 = new Lecture({
      title: 'Lec 4 Paused Now',
      description: 'Lec 4',
      date: todayStr,
      time: '12:00',
      startTime: now,
      classroom: classroom._id,
      teacher: teacherUser._id,
      status: 'paused',
      attendance: []
    });
    await lec4.save();

    await test('B1: Attendance denominator only counts completed lectures (1 attended / 1 completed = 100%)', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const att = res.data.details.joined.averageAttendance;
      assert.strictEqual(att.length, 1);
      assert.strictEqual(att[0].totalLectures, 1, 'Total finalized lectures should be 1, excluding upcoming/live/paused');
      assert.strictEqual(att[0].attendedLectures, 1, 'Attended finalized lectures should be 1');
      assert.strictEqual(att[0].attendance, 100, 'Attendance should be 100%, not 25% or 50%');
    });

    // Lecture 5: completed, ABSENT for student
    const lec5 = new Lecture({
      title: 'Lec 5 Completed Absent',
      description: 'Lec 5',
      date: yesterdayStr,
      time: '15:00',
      startTime: yesterday,
      classroom: classroom._id,
      teacher: teacherUser._id,
      status: 'completed',
      attendance: []
    });
    await lec5.save();

    await test('B2: Completed lecture where student was absent correctly calculates attendance (1/2 = 50%)', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const att = res.data.details.joined.averageAttendance;
      assert.strictEqual(att[0].totalLectures, 2, 'Total finalized lectures should now be 2');
      assert.strictEqual(att[0].attendedLectures, 1);
      assert.strictEqual(att[0].attendance, 50, 'Attendance should be 50% (1 of 2 completed attended)');
    });

    // ==========================================
    // TEST SUITE C: UPCOMING SCHEDULED LECTURES
    // ==========================================

    await test('C1: Upcoming scheduled lecture appears in upcomingClasses and recentClasses for student', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const upcoming = res.data.details.joined.upcomingClasses;
      assert(Array.isArray(upcoming), 'upcomingClasses must be an array');
      assert.strictEqual(upcoming.length, 1, 'Only upcoming lecture should appear');
      assert.strictEqual(upcoming[0].title, 'Lec 2 Upcoming Tomorrow');
      assert.strictEqual(upcoming[0].status, 'upcoming');
      assert.strictEqual(upcoming[0].subject, 'Physics');
      assert.strictEqual(upcoming[0].classCode, classroom.code);
      assert.strictEqual(upcoming[0].date, tomorrowStr);

      // Check backward-compatible recentClasses field
      const recent = res.data.user.recentClasses;
      assert.strictEqual(recent.length, 1);
      assert.strictEqual(recent[0].title, 'Lec 2 Upcoming Tomorrow');
    });

    await test('C2: Non-member student sees empty upcoming classes', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, s2Token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.details.joined.upcomingClasses.length, 0);
      assert.strictEqual(res.data.user.recentClasses.length, 0);
    });

    // Add another upcoming lecture later in time to verify sorting
    const dayAfterTomorrow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const dayAfterStr = formatYMD(dayAfterTomorrow);
    const lecLater = new Lecture({
      title: 'Lec Later Far Future',
      description: 'Lec Later',
      date: dayAfterStr,
      time: '18:00',
      startTime: dayAfterTomorrow,
      classroom: classroom._id,
      teacher: teacherUser._id,
      status: 'upcoming',
      attendance: []
    });
    await lecLater.save();

    await test('C3: Nearest upcoming lecture is sorted first', async () => {
      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200);
      const upcoming = res.data.details.joined.upcomingClasses;
      assert.strictEqual(upcoming.length, 2);
      assert.strictEqual(upcoming[0].title, 'Lec 2 Upcoming Tomorrow', 'Nearest lecture must come first');
      assert.strictEqual(upcoming[1].title, 'Lec Later Far Future', 'Later lecture must come second');
    });

    // ==========================================
    // TEST SUITE D: NULL CLASSROOM SAFETY
    // ==========================================

    await test('D1: Stale/null classroom reference in joinedClasses does not crash getDashboard', async () => {
      // Intentionally insert a non-existent ObjectId into user's joinedClasses
      const fakeClassId = new mongoose.Types.ObjectId();
      await User.findByIdAndUpdate(studentUser._id, {
        $push: { joinedClasses: fakeClassId }
      });

      const res = await fetchData('GET', '/user/dashboard', null, sToken);
      assert.strictEqual(res.status, 200, 'Must return 200 despite null populated classroom');
      assert.strictEqual(res.data.success, true);
      assert(res.data.details.joined.assignments.length > 0);

      // Clean up fake ID
      await User.findByIdAndUpdate(studentUser._id, {
        $pull: { joinedClasses: fakeClassId }
      });
    });

    // ==========================================
    // TEST SUITE E: CURRENT TEST DATA VERIFICATION
    // ==========================================

    await test('E1: Known test user (Ad Gupta, 6acc9f619f63e088dc26f6d4) verifies expected state', async () => {
      // Find Ad Gupta's token or mock request
      const adUser = await User.findById('6acc9f619f63e088dc26f6d4');
      if (adUser) {
        // Direct controller test
        const userController = require('../../controllers/user.controller');
        let responseJson = null;
        let responseCode = null;
        const mockReq = { user: { _id: adUser._id } };
        const mockRes = {
          status: (code) => {
            responseCode = code;
            return {
              json: (data) => {
                responseJson = data;
                return responseJson;
              }
            };
          },
          json: (data) => {
            responseCode = 200;
            responseJson = data;
            return responseJson;
          }
        };

        await userController.getDashboard(mockReq, mockRes, (err) => { throw err; });
        assert.strictEqual(responseCode, 200);
        assert.strictEqual(responseJson.success, true);
        const joined = responseJson.details.joined;
        
        // Check assignments dynamically depending on whether Isse karo has been submitted
        const isseKaroAssign = await Assignment.findOne({ name: 'Isse karo' });
        const isseSub = isseKaroAssign ? await Submission.findOne({ assignment: isseKaroAssign._id, student: adUser._id }) : null;

        assert.strictEqual(joined.stats.completedTotalAssignments, isseSub ? 2 : 1, 'Ad Gupta completed assignments matches expected count');
        assert.strictEqual(joined.stats.dueSoonTotalAssignments, joined.dueSoonAssignments.length, 'Ad Gupta due soon stats matches dueSoonAssignments length');
        assert.strictEqual(joined.stats.overdueTotalAssignments, 0, 'Ad Gupta overdue assignments must be 0');

        if (joined.dueSoonAssignments.length > 0) {
          const dueSoon = joined.dueSoonAssignments[0];
          assert.ok(dueSoon.title, 'Due soon assignment must have title');
          assert.ok(dueSoon._id, 'Due soon assignment must have _id');
          assert.ok(dueSoon.classCode, 'Due soon assignment classCode must match classroom code');
          assert.ok(dueSoon.className, 'Due soon assignment className must match classroom name');
          assert.ok(dueSoon.classroom, 'Due soon assignment must contain classroom object');
          assert.ok(dueSoon.classroom._id, 'classroom object must have _id');
          assert.ok(dueSoon.classroom.code, 'classroom object code must match');
          assert.ok(dueSoon.classroom.name, 'classroom object name must match');
        }
      }
    });

    // ==============================================================
    // TEACHER DASHBOARD TESTS
    // ==============================================================
    const genCode = () => 'T' + Math.random().toString(36).substring(2, 7).toUpperCase();

    await test('F1: Teacher Review Queue - 2 students, 0 submissions => EXCLUDED (Case A)', async () => {
      // Create a test teacher, class with 2 students, 0 submissions
      const tId = new mongoose.Types.ObjectId();
      const s1Id = new mongoose.Types.ObjectId();
      const s2Id = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Teacher Review Class A',
        code: genCode(),
        subject: 'Math',
        teacher: tId,
        students: [s1Id, s2Id]
      });
      await cls.save();

      const assign = new Assignment({
        _id: aId,
        name: 'Assign No Subs',
        classroom: cId,
        teacher: tId,
        dueDate: '2026-10-14'
      });
      await assign.save();

      const user = new User({
        _id: tId,
        name: 'Teacher A',
        email: `teach_a_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const dueSoon = responseJson.details.created.dueSoonAssignments;
      assert.strictEqual(dueSoon.length, 0, 'Assignment with 0 submissions must NOT appear in teacher review queue');
    });

    await test('F2: Teacher Review Queue - 2 students, 1 ungraded submission => INCLUDED (Case B)', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1Id = new mongoose.Types.ObjectId();
      const s2Id = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Teacher Review Class B',
        code: genCode(),
        subject: 'Math',
        teacher: tId,
        students: [s1Id, s2Id]
      });
      await cls.save();

      const assign = new Assignment({
        _id: aId,
        name: 'Assign 1 Ungraded',
        classroom: cId,
        teacher: tId,
        dueDate: '2026-10-14'
      });
      await assign.save();

      // 1 ungraded submission
      const sub = new Submission({
        assignment: aId,
        student: s1Id,
        classroom: cId,
        isGraded: false
      });
      await sub.save();

      const user = new User({
        _id: tId,
        name: 'Teacher B',
        email: `teach_b_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const dueSoon = responseJson.details.created.dueSoonAssignments;
      assert.strictEqual(dueSoon.length, 1, 'Assignment with 1 ungraded submission MUST appear in review queue');
      assert.strictEqual(dueSoon[0].totalSubmissions, 1, 'totalSubmissions must be actual submissions count (1)');
      assert.strictEqual(dueSoon[0].reviewedSubmissions, 0, 'reviewedSubmissions must be 0');
      assert.strictEqual(dueSoon[0].pendingReviews, 1, 'pendingReviews must be 1');
    });

    await test('F3: Teacher Review Queue - 2 students, 1 graded submission => EXCLUDED (Case C)', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1Id = new mongoose.Types.ObjectId();
      const s2Id = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Teacher Review Class C',
        code: genCode(),
        subject: 'Math',
        teacher: tId,
        students: [s1Id, s2Id]
      });
      await cls.save();

      const assign = new Assignment({
        _id: aId,
        name: 'Assign 1 Graded',
        classroom: cId,
        teacher: tId,
        dueDate: '2026-10-14'
      });
      await assign.save();

      // 1 graded submission
      const sub = new Submission({
        assignment: aId,
        student: s1Id,
        classroom: cId,
        isGraded: true,
        marks: 8
      });
      await sub.save();

      const user = new User({
        _id: tId,
        name: 'Teacher C',
        email: `teach_c_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const dueSoon = responseJson.details.created.dueSoonAssignments;
      assert.strictEqual(dueSoon.length, 0, 'Assignment where all submissions are graded must NOT appear in review queue');
    });

    await test('F4: Teacher Review Queue - 2 students, 2 submissions (1 graded + 1 ungraded) => INCLUDED (Case D)', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1Id = new mongoose.Types.ObjectId();
      const s2Id = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Teacher Review Class D',
        code: genCode(),
        subject: 'Math',
        teacher: tId,
        students: [s1Id, s2Id]
      });
      await cls.save();

      const assign = new Assignment({
        _id: aId,
        name: 'Assign 2 Subs Mixed',
        classroom: cId,
        teacher: tId,
        dueDate: '2026-10-14'
      });
      await assign.save();

      await new Submission({ assignment: aId, student: s1Id, classroom: cId, isGraded: true, marks: 10 }).save();
      await new Submission({ assignment: aId, student: s2Id, classroom: cId, isGraded: false }).save();

      const user = new User({
        _id: tId,
        name: 'Teacher D',
        email: `teach_d_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const dueSoon = responseJson.details.created.dueSoonAssignments;
      assert.strictEqual(dueSoon.length, 1, 'Assignment with 1 pending review must appear in review queue');
      assert.strictEqual(dueSoon[0].totalSubmissions, 2, 'totalSubmissions must be 2');
      assert.strictEqual(dueSoon[0].reviewedSubmissions, 1, 'reviewedSubmissions must be 1');
      assert.strictEqual(dueSoon[0].pendingReviews, 1, 'pendingReviews must be 1');
    });

    await test('F5: Teacher Review Queue - Past-due assignment with ungraded submission => INCLUDED (Case E)', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1Id = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Teacher Review Class E',
        code: genCode(),
        subject: 'Physics',
        teacher: tId,
        students: [s1Id]
      });
      await cls.save();

      const assign = new Assignment({
        _id: aId,
        name: 'Assign Past Due Ungraded',
        classroom: cId,
        teacher: tId,
        dueDate: '2020-01-01' // Past due
      });
      await assign.save();

      await new Submission({ assignment: aId, student: s1Id, classroom: cId, isGraded: false }).save();

      const user = new User({
        _id: tId,
        name: 'Teacher E',
        email: `teach_e_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const dueSoon = responseJson.details.created.dueSoonAssignments;
      assert.strictEqual(dueSoon.length, 1, 'Past-due assignment with ungraded submission MUST remain visible in teacher review queue');
      assert.strictEqual(dueSoon[0].pendingReviews, 1);
    });

    await test('F6: Teacher Review Queue - Due >3 days away + early ungraded submission => INCLUDED (Case F)', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1Id = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Teacher Review Class F',
        code: genCode(),
        subject: 'History',
        teacher: tId,
        students: [s1Id]
      });
      await cls.save();

      const assign = new Assignment({
        _id: aId,
        name: 'Assign Future Due Ungraded',
        classroom: cId,
        teacher: tId,
        dueDate: '2026-12-31' // Far future
      });
      await assign.save();

      await new Submission({ assignment: aId, student: s1Id, classroom: cId, isGraded: false }).save();

      const user = new User({
        _id: tId,
        name: 'Teacher F',
        email: `teach_f_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const dueSoon = responseJson.details.created.dueSoonAssignments;
      assert.strictEqual(dueSoon.length, 1, 'Future assignment with early submission MUST appear in teacher review queue');
      assert.strictEqual(dueSoon[0].pendingReviews, 1);
    });

    await test('G1: Teacher Completion Percentage - 0/2 => 0%, 1/2 => 50%, 2/2 => 100%, 0 students => 0% safe', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1 = new mongoose.Types.ObjectId();
      const s2 = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const a1Id = new mongoose.Types.ObjectId();
      const a2Id = new mongoose.Types.ObjectId();
      const a3Id = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Completion Class',
        code: genCode(),
        subject: 'Science',
        teacher: tId,
        students: [s1, s2]
      });
      await cls.save();

      // a1: 0 submissions => 0%
      await new Assignment({ _id: a1Id, name: 'Task 0 Subs', classroom: cId, teacher: tId, dueDate: '2026-10-15' }).save();

      // a2: 1 submission => 50%
      await new Assignment({ _id: a2Id, name: 'Task 1 Sub', classroom: cId, teacher: tId, dueDate: '2026-10-15' }).save();
      await new Submission({ assignment: a2Id, student: s1, classroom: cId, isGraded: false }).save();

      // a3: 2 submissions => 100%
      await new Assignment({ _id: a3Id, name: 'Task 2 Subs', classroom: cId, teacher: tId, dueDate: '2026-10-15' }).save();
      await new Submission({ assignment: a3Id, student: s1, classroom: cId, isGraded: false }).save();
      await new Submission({ assignment: a3Id, student: s2, classroom: cId, isGraded: false }).save();

      // cZero: 0 enrolled students
      const cZeroId = new mongoose.Types.ObjectId();
      const aZeroId = new mongoose.Types.ObjectId();
      await new Classroom({ _id: cZeroId, name: 'Zero Student Class', code: genCode(), subject: 'Art', teacher: tId, students: [] }).save();
      await new Assignment({ _id: aZeroId, name: 'Zero Student Task', classroom: cZeroId, teacher: tId, dueDate: '2026-10-15' }).save();

      const user = new User({
        _id: tId,
        name: 'Teacher G',
        email: `teach_g_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId, cZeroId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const scienceGroup = responseJson.details.created.assignments.find(g => g.classroomSubject === 'Science');
      const task0 = scienceGroup.assignments.find(a => a._id.toString() === a1Id.toString());
      const task1 = scienceGroup.assignments.find(a => a._id.toString() === a2Id.toString());
      const task2 = scienceGroup.assignments.find(a => a._id.toString() === a3Id.toString());

      assert.strictEqual(task0.completionPercentage, 0, '0/2 submissions must equal 0%');
      assert.strictEqual(task1.completionPercentage, 50, '1/2 submissions must equal 50%');
      assert.strictEqual(task2.completionPercentage, 100, '2/2 submissions must equal 100%');

      const artGroup = responseJson.details.created.assignments.find(g => g.classroomSubject === 'Art');
      const taskZero = artGroup.assignments.find(a => a._id.toString() === aZeroId.toString());
      assert.strictEqual(taskZero.completionPercentage, 0, '0 enrolled students must safely equal 0%, never NaN/Infinity');
    });

    await test('G2: Teacher Completion Percentage - Non-enrolled submitter does not inflate completion %', async () => {
      const tId = new mongoose.Types.ObjectId();
      const sEnrolled = new mongoose.Types.ObjectId();
      const sLeft = new mongoose.Types.ObjectId();
      const cId = new mongoose.Types.ObjectId();
      const aId = new mongoose.Types.ObjectId();

      const cls = new Classroom({
        _id: cId,
        name: 'Drop Student Class',
        code: genCode(),
        subject: 'Economics',
        teacher: tId,
        students: [sEnrolled] // sLeft is no longer enrolled
      });
      await cls.save();

      await new Assignment({ _id: aId, name: 'Task Left Student', classroom: cId, teacher: tId, dueDate: '2026-10-15' }).save();
      // Only the student who left submitted
      await new Submission({ assignment: aId, student: sLeft, classroom: cId, isGraded: false }).save();

      const user = new User({
        _id: tId,
        name: 'Teacher G2',
        email: `teach_g2_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [cId]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const econGroup = responseJson.details.created.assignments.find(g => g.classroomSubject === 'Economics');
      const task = econGroup.assignments[0];
      assert.strictEqual(task.completionPercentage, 0, 'Submissions from non-enrolled students must not inflate current completion %');
    });

    await test('H1: Teacher Attendance - Finalized completed lectures only, 0-lecture classrooms have totalLectures=0', async () => {
      const tId = new mongoose.Types.ObjectId();
      const s1 = new mongoose.Types.ObjectId();
      const c1Id = new mongoose.Types.ObjectId();
      const c2Id = new mongoose.Types.ObjectId();

      const cls1 = new Classroom({
        _id: c1Id,
        name: 'Active Lecture Class',
        code: genCode(),
        subject: 'Civics',
        teacher: tId,
        students: [s1]
      });
      await cls1.save();

      const cls2 = new Classroom({
        _id: c2Id,
        name: 'No Lecture Class',
        code: genCode(),
        subject: 'Music',
        teacher: tId,
        students: [s1]
      });
      await cls2.save();

      // Completed lecture for Civics
      await new Lecture({
        title: 'Civics Lecture 1',
        description: 'Civics class description',
        date: '2026-10-14',
        time: '10:00',
        startTime: new Date('2026-10-14T04:30:00.000Z'),
        classroom: c1Id,
        teacher: tId,
        status: 'completed',
        attendance: [{ student: s1 }]
      }).save();

      // Upcoming lecture for Music (should not count!)
      await new Lecture({
        title: 'Music Upcoming',
        description: 'Music class description',
        date: '2026-10-16',
        time: '12:00',
        startTime: new Date('2026-10-16T06:30:00.000Z'),
        classroom: c2Id,
        teacher: tId,
        status: 'upcoming'
      }).save();

      const user = new User({
        _id: tId,
        name: 'Teacher H',
        email: `teach_h_${Date.now()}@test.com`,
        password: 'Password@123',
        createdClasses: [c1Id, c2Id]
      });
      await user.save();

      const userController = require('../../controllers/user.controller');
      let responseJson = null;
      await userController.getDashboard({ user: { _id: tId } }, {
        status: () => ({ json: (d) => { responseJson = d; } }),
        json: (d) => { responseJson = d; }
      }, (err) => { throw err; });

      const attList = responseJson.details.created.averageAttendance;
      const civics = attList.find(a => a.className === 'Civics');
      const music = attList.find(a => a.className === 'Music');

      assert.strictEqual(civics.totalLectures, 1);
      assert.strictEqual(civics.attendance, 100);

      assert.strictEqual(music.totalLectures, 0, 'Classroom with only upcoming lectures must have totalLectures = 0');
      assert.strictEqual(music.attendance, 0);
    });

    await test('H2: Real Teacher Vick verification - Review queue empty, English attendance 50%, SST & Testing totalLectures=0', async () => {
      const vickUser = await User.findOne({ name: 'Vick' });
      if (vickUser) {
        const userController = require('../../controllers/user.controller');
        let responseJson = null;
        await userController.getDashboard({ user: { _id: vickUser._id } }, {
          status: () => ({ json: (d) => { responseJson = d; } }),
          json: (d) => { responseJson = d; }
        }, (err) => { throw err; });

        const created = responseJson.details.created;
        const isseAssign = await Assignment.findOne({ name: 'Isse karo' });
        const issePending = isseAssign ? await Submission.countDocuments({ assignment: isseAssign._id, isGraded: false }) : 0;
        if (issePending > 0) {
          assert.strictEqual(created.dueSoonAssignments.length, 1, 'Vick review queue must have 1 pending assignment');
          assert.strictEqual(created.dueSoonAssignments[0].title, 'Isse karo');
          assert.strictEqual(created.dueSoonAssignments[0].pendingReviews, issePending);
        } else {
          assert.strictEqual(created.dueSoonAssignments.length, 0, 'Vick review queue must be 0 (no pending ungraded submissions)');
        }

        const englishAtt = created.averageAttendance.find(a => a.className === 'English');
        assert.strictEqual(englishAtt.attendance, 50, 'English attendance must be 50%');
        assert.strictEqual(englishAtt.totalLectures, 1, 'English completed lectures must be 1');

        const sstAtt = created.averageAttendance.find(a => a.className === 'SST');
        const testingAtt = created.averageAttendance.find(a => a.className === 'Testing');
        assert.strictEqual(sstAtt.totalLectures, 0, 'SST must have 0 completed lectures');
        assert.strictEqual(testingAtt.totalLectures, 0, 'Testing must have 0 completed lectures');
      }
    });

    console.log('\n==========================================');
    console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('==========================================\n');

    await mongoose.disconnect();
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  }
};

runTests();
