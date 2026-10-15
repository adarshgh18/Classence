const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Lecture = require('../../models/Lecture');

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

    console.log('--- Setting up Test Users and Classrooms ---');
    const uTeacher = `teacher_att_${Date.now()}@test.com`;
    const uStudent1 = `student1_att_${Date.now()}@test.com`;
    const uStudent2 = `student2_att_${Date.now()}@test.com`;

    await fetchData('POST', '/auth/register', { name: 'Prof Alice', email: uTeacher, password: 'Password@123' });
    const userTeacher = await User.findOne({ email: uTeacher }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uTeacher, otp: userTeacher.otp.code });
    const lTeacher = await fetchData('POST', '/auth/login', { email: uTeacher, password: 'Password@123' });
    const tTeacher = lTeacher.data.token;

    await fetchData('POST', '/auth/register', { name: 'Bob Student', email: uStudent1, password: 'Password@123' });
    const userStudent1 = await User.findOne({ email: uStudent1 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uStudent1, otp: userStudent1.otp.code });
    const lStudent1 = await fetchData('POST', '/auth/login', { email: uStudent1, password: 'Password@123' });
    const tStudent1 = lStudent1.data.token;

    await fetchData('POST', '/auth/register', { name: 'Charlie Student', email: uStudent2, password: 'Password@123' });
    const userStudent2 = await User.findOne({ email: uStudent2 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uStudent2, otp: userStudent2.otp.code });
    const lStudent2 = await fetchData('POST', '/auth/login', { email: uStudent2, password: 'Password@123' });
    const tStudent2 = lStudent2.data.token;

    // 1. Create Empty Classroom (for zero completed lectures test)
    const emptyClassRes = await fetchData('POST', '/classroom/create', { name: 'Empty Class', subject: 'Empty', privacy: 'public' }, tTeacher);
    const emptyClassCode = emptyClassRes.data.classroom.code;
    const emptyClassObj = await Classroom.findOne({ code: emptyClassCode });

    // 2. Create Active Classroom with 2 enrolled students
    const activeClassRes = await fetchData('POST', '/classroom/create', { name: 'CS101', subject: 'Computer Science', privacy: 'public' }, tTeacher);
    const activeClassCode = activeClassRes.data.classroom.code;
    const activeClassObj = await Classroom.findOne({ code: activeClassCode });

    // Enroll students
    await fetchData('POST', '/classroom/join', { code: activeClassCode }, tStudent1);
    await fetchData('POST', '/classroom/join', { code: activeClassCode }, tStudent2);

    // Refresh classroom object with enrolled students
    const classroomWithStudents = await Classroom.findOne({ code: activeClassCode });
    assert.strictEqual(classroomWithStudents.students.length, 2, 'Should have 2 enrolled students');

    // Create 10 completed lectures with varying attendance
    // Chronological order: L01 -> L10
    // Attendance matrix:
    // L01: S1 Present, S2 Present -> present=2, absent=0
    // L02: S1 Present, S2 Absent  -> present=1, absent=1
    // L03: S1 Absent,  S2 Present -> present=1, absent=1 (S1 streak resets here)
    // L04: S1 Present, S2 Present -> present=2, absent=0 (S1 streak starts: 1)
    // L05: S1 Present, S2 Present -> present=2, absent=0 (S1 streak: 2)
    // L06: S1 Present, S2 Absent  -> present=1, absent=1 (S1 streak: 3)
    // L07: S1 Present, S2 Present -> present=2, absent=0 (S1 streak: 4)
    // L08: S1 Present, S2 Present -> present=2, absent=0 (S1 streak: 5)
    // L09: S1 Present, S2 Absent  -> present=1, absent=1 (S1 streak: 6)
    // L10: S1 Present, S2 Present -> present=2, absent=0 (S1 streak: 7, longest: 7)

    const baseTime = Date.now() - 10 * 86400000;
    const completedLecturesList = [];
    const attendancePlan = [
      [true, true],   // L01
      [true, false],  // L02
      [false, true],  // L03
      [true, true],   // L04
      [true, true],   // L05
      [true, false],  // L06
      [true, true],   // L07
      [true, true],   // L08
      [true, false],  // L09
      [true, true],   // L10
    ];

    let expectedTotalPresent = 0;
    let expectedTotalAbsent = 0;

    for (let i = 0; i < 10; i++) {
      const startTime = new Date(baseTime + i * 3600000);
      const [s1Pres, s2Pres] = attendancePlan[i];
      const att = [];
      if (s1Pres) att.push({ student: userStudent1._id, timestamp: startTime });
      if (s2Pres) att.push({ student: userStudent2._id, timestamp: startTime });

      expectedTotalPresent += att.length;
      expectedTotalAbsent += (2 - att.length);

      const lec = await Lecture.create({
        title: `Lecture ${String(i + 1).padStart(2, '0')}`,
        description: `Description ${i + 1}`,
        date: `2026-10-${String(i + 1).padStart(2, '0')}`,
        time: '10:00 AM',
        startTime: startTime,
        classroom: classroomWithStudents._id,
        teacher: userTeacher._id,
        status: 'completed',
        isLive: false,
        attendance: att
      });
      completedLecturesList.push(lec);
    }

    // Now create 3 non-completed lectures in the same classroom:
    // 1. Upcoming lecture
    const upcomingLec = await Lecture.create({
      title: 'Upcoming Lecture Tomorrow',
      description: 'Not started yet',
      date: '2026-10-25',
      time: '11:00 AM',
      startTime: new Date(Date.now() + 86400000),
      classroom: classroomWithStudents._id,
      teacher: userTeacher._id,
      status: 'upcoming',
      isLive: false,
      attendance: []
    });

    // 2. Live lecture (S1 marked, S2 not marked)
    const liveLec = await Lecture.create({
      title: 'Live Lecture Currently On',
      description: 'In progress',
      date: '2026-10-14',
      time: '12:00 PM',
      startTime: new Date(Date.now() - 100000),
      classroom: classroomWithStudents._id,
      teacher: userTeacher._id,
      status: 'live',
      isLive: true,
      attendance: [{ student: userStudent1._id, timestamp: new Date() }]
    });

    // 3. Paused lecture
    const pausedLec = await Lecture.create({
      title: 'Paused Lecture',
      description: 'Temporarily paused',
      date: '2026-10-14',
      time: '01:00 PM',
      startTime: new Date(Date.now() - 50000),
      classroom: classroomWithStudents._id,
      teacher: userTeacher._id,
      status: 'paused',
      isLive: false,
      attendance: [{ student: userStudent1._id, timestamp: new Date() }]
    });

    console.log('\n--- EXECUTING FOCUSED ATTENDANCE TESTS ---');

    let teacherData;
    let student1Data;
    let student2Data;

    // Fetch initial teacher attendance
    const tRes = await fetchData('GET', `/classroom/attendance?classCode=${activeClassCode}`, null, tTeacher);
    assert.strictEqual(tRes.status, 200);
    teacherData = tRes.data;

    // Fetch initial student attendance
    const s1Res = await fetchData('GET', `/classroom/attendance?classCode=${activeClassCode}`, null, tStudent1);
    assert.strictEqual(s1Res.status, 200);
    student1Data = s1Res.data;

    const s2Res = await fetchData('GET', `/classroom/attendance?classCode=${activeClassCode}`, null, tStudent2);
    assert.strictEqual(s2Res.status, 200);
    student2Data = s2Res.data;

    // Test 1: Teacher with completed lectures does NOT receive empty attendance data
    await test('1. Teacher with completed lectures does NOT receive empty attendance data', async () => {
      assert.strictEqual(teacherData.success, true);
      assert.strictEqual(teacherData.isTeacher, true);
      assert(Array.isArray(teacherData.lectureData));
      assert(teacherData.lectureData.length > 0, 'Teacher lectureData should not be empty');
    });

    // Test 2: Teacher lectureData contains completed lectures
    await test('2. Teacher lectureData contains completed lectures', async () => {
      assert.strictEqual(teacherData.lectureData.length, 10);
      assert.strictEqual(teacherData.lectureData[0].title, 'Lecture 01');
      assert.strictEqual(teacherData.lectureData[9].title, 'Lecture 10');
    });

    // Test 3: Teacher lectureData excludes upcoming lectures
    await test('3. Teacher lectureData excludes upcoming lectures', async () => {
      const hasUpcoming = teacherData.lectureData.some(l => l.title === 'Upcoming Lecture Tomorrow');
      assert.strictEqual(hasUpcoming, false, 'Upcoming lecture must not be in finalized teacher lectureData');
    });

    // Test 4: Teacher lectureData excludes live lectures
    await test('4. Teacher lectureData excludes live lectures', async () => {
      const hasLive = teacherData.lectureData.some(l => l.title === 'Live Lecture Currently On');
      assert.strictEqual(hasLive, false, 'Live lecture must not be in finalized teacher lectureData');
    });

    // Test 5: Teacher lectureData excludes paused lectures
    await test('5. Teacher lectureData excludes paused lectures', async () => {
      const hasPaused = teacherData.lectureData.some(l => l.title === 'Paused Lecture');
      assert.strictEqual(hasPaused, false, 'Paused lecture must not be in finalized teacher lectureData');
    });

    // Test 6: Teacher totalPresent is correct
    await test('6. Teacher totalPresent is correct', async () => {
      // Sum of attendees across 10 completed lectures: [2,1,1,2,2,1,2,2,1,2] = 16
      assert.strictEqual(teacherData.totalPresent, expectedTotalPresent);
      assert.strictEqual(teacherData.totalPresent, 16);
    });

    // Test 7: Teacher totalAbsent is correct
    await test('7. Teacher totalAbsent is correct', async () => {
      // Total enrolled = 2. 10 lectures * 2 students = 20 total slots. 16 present => 4 absent.
      assert.strictEqual(teacherData.totalAbsent, expectedTotalAbsent);
      assert.strictEqual(teacherData.totalAbsent, 4);
    });

    // Test 8: Teacher response contains last7Lectures
    await test('8. Teacher response contains last7Lectures', async () => {
      assert(Array.isArray(teacherData.last7Lectures), 'last7Lectures must be an array');
      assert(teacherData.last7Lectures.length > 0);
    });

    // Test 9: last7Lectures contains at most 7 completed lectures
    await test('9. last7Lectures contains at most 7 completed lectures', async () => {
      assert.strictEqual(teacherData.last7Lectures.length, 7);
      // The last 7 are L04 to L10
      assert.strictEqual(teacherData.last7Lectures[0].date, '2026-10-04');
      assert.strictEqual(teacherData.last7Lectures[6].date, '2026-10-10');
      // Each item has date and attendance count
      teacherData.last7Lectures.forEach(item => {
        assert(typeof item.date === 'string');
        assert(typeof item.attendance === 'number');
      });
    });

    // Test 10: Teacher attendee list contains correct present student names
    await test('10. Teacher attendee list contains correct present student names', async () => {
      // L01 had both Bob and Charlie
      const l1 = teacherData.lectureData[0];
      assert.strictEqual(l1.totalPresent, 2);
      assert.strictEqual(l1.presentStudents.length, 2);
      const names = l1.presentStudents.map(s => s.name);
      assert(names.includes('Bob Student'));
      assert(names.includes('Charlie Student'));
    });

    // Test 11: Student completed-present lecture counts as Present
    await test('11. Student completed-present lecture counts as Present', async () => {
      const s1L1 = student1Data.lectureData.find(l => l.title === 'Lecture 01');
      assert.strictEqual(s1L1.attendance, 'Present');
      assert.strictEqual(student1Data.totalPresent, 9); // S1 present in 9 of 10 completed lectures
    });

    // Test 12: Student completed-missed lecture counts as Absent
    await test('12. Student completed-missed lecture counts as Absent', async () => {
      const s1L3 = student1Data.lectureData.find(l => l.title === 'Lecture 03');
      assert.strictEqual(s1L3.attendance, 'Absent');
      assert.strictEqual(student1Data.totalAbsent, 1); // S1 missed only L03
    });

    // Test 13: Upcoming lecture does NOT count as Absent
    await test('13. Upcoming lecture does NOT count as Absent', async () => {
      const hasUpcoming = student1Data.lectureData.some(l => l.title === 'Upcoming Lecture Tomorrow');
      assert.strictEqual(hasUpcoming, false, 'Upcoming lecture must not be in student lectureData');
      assert.strictEqual(student1Data.totalAbsent, 1, 'Upcoming lecture must not increment totalAbsent');
    });

    // Test 14: Live lecture does NOT count as Absent
    await test('14. Live lecture does NOT count as Absent', async () => {
      const hasLive = student2Data.lectureData.some(l => l.title === 'Live Lecture Currently On');
      assert.strictEqual(hasLive, false, 'Live lecture must not be in student lectureData');
      // S2 was absent in L02, L06, L09 (3 absences in completed lectures)
      assert.strictEqual(student2Data.totalAbsent, 3, 'Live lecture must not increment totalAbsent for S2');
    });

    // Test 15: Paused lecture does NOT count as Absent
    await test('15. Paused lecture does NOT count as Absent', async () => {
      const hasPaused = student2Data.lectureData.some(l => l.title === 'Paused Lecture');
      assert.strictEqual(hasPaused, false, 'Paused lecture must not be in student lectureData');
      assert.strictEqual(student2Data.totalAbsent, 3, 'Paused lecture must not increment totalAbsent for S2');
    });

    // Test 16: Upcoming/live/paused lectures do NOT reset current streak
    await test('16. Upcoming/live/paused lectures do NOT reset current streak', async () => {
      // S1 had L04..L10 present consecutively = 7 consecutive present
      // Upcoming/live/paused lectures must not reset this streak!
      assert.strictEqual(student1Data.currentStreak, 7, 'Streak should remain 7 despite future/live/paused lectures');
    });

    // Test 17: Completed absence resets current streak
    await test('17. Completed absence resets current streak', async () => {
      // For S2: L09 was Absent, L10 was Present
      // Current streak should be 1
      assert.strictEqual(student2Data.currentStreak, 1, 'S2 streak was reset by L09 absence and is now 1');
    });

    // Test 18: Longest streak remains correct
    await test('18. Longest streak remains correct', async () => {
      assert.strictEqual(student1Data.longestStreak, 7, 'S1 longest streak should be 7');
      // S2 had L01 (1), L03..L05 (3), L07..L08 (2), L10 (1) -> longest streak is 3
      assert.strictEqual(student2Data.longestStreak, 3, 'S2 longest streak should be 3');
    });

    // Test 19: No duplicate attendance is introduced
    await test('19. No duplicate attendance is introduced', async () => {
      // Mark attendance twice for student 1 on the live lecture
      const m1 = await fetchData('POST', '/lecture/mark', { lectureId: liveLec._id.toString() }, tStudent1);
      assert.strictEqual(m1.status, 200);
      const m2 = await fetchData('POST', '/lecture/mark', { lectureId: liveLec._id.toString() }, tStudent1);
      assert.strictEqual(m2.status, 200);

      const refreshedLec = await Lecture.findById(liveLec._id);
      const student1Marks = refreshedLec.attendance.filter(a => a.student.equals(userStudent1._id));
      assert.strictEqual(student1Marks.length, 1, 'Student should only be recorded once in attendance array');
    });

    // Test 20: Teacher with zero completed lectures receives a valid empty response without frontend-crashing data shapes
    await test('20. Teacher with zero completed lectures receives a valid empty response without frontend-crashing data shapes', async () => {
      const emptyRes = await fetchData('GET', `/classroom/attendance?classCode=${emptyClassCode}`, null, tTeacher);
      assert.strictEqual(emptyRes.status, 200);
      assert.strictEqual(emptyRes.data.success, true);
      assert.strictEqual(emptyRes.data.isTeacher, true);
      assert.strictEqual(emptyRes.data.totalPresent, 0);
      assert.strictEqual(emptyRes.data.totalAbsent, 0);
      assert(Array.isArray(emptyRes.data.last7Lectures));
      assert.strictEqual(emptyRes.data.last7Lectures.length, 0);
      assert(Array.isArray(emptyRes.data.lectureData));
      assert.strictEqual(emptyRes.data.lectureData.length, 0);
    });

    console.log(`\n========================================`);
    console.log(`ATTENDANCE SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================`);

    // Clean up test collections
    await User.deleteMany({ _id: { $in: [userTeacher._id, userStudent1._id, userStudent2._id] } });
    await Classroom.deleteMany({ _id: { $in: [emptyClassObj._id, activeClassObj._id] } });
    await Lecture.deleteMany({ classroom: { $in: [emptyClassObj._id, activeClassObj._id] } });

    await mongoose.disconnect();

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
};

runTests();
