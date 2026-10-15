const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Assignment = require('../../models/Assignment');
const Lecture = require('../../models/Lecture');
const Reminder = require('../../models/Reminder');

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
    console.log('=== Running Calendar Remediation Test Suite ===');

    const suffix = Date.now();
    const teacherEmail = `t_cal_${suffix}@test.com`;
    const studentEmail = `s_cal_${suffix}@test.com`;
    const otherEmail = `other_cal_${suffix}@test.com`;

    // 1. Register & Verify Teacher
    await fetchData('POST', '/auth/register', { name: 'Teacher Cal', email: teacherEmail, password: 'Password@123' });
    const teacherUser = await User.findOne({ email: teacherEmail }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: teacherEmail, otp: teacherUser.otp.code });
    const tToken = (await fetchData('POST', '/auth/login', { email: teacherEmail, password: 'Password@123' })).data.token;

    // 2. Register & Verify Student
    await fetchData('POST', '/auth/register', { name: 'Student Cal', email: studentEmail, password: 'Password@123' });
    const studentUser = await User.findOne({ email: studentEmail }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: studentEmail, otp: studentUser.otp.code });
    const sToken = (await fetchData('POST', '/auth/login', { email: studentEmail, password: 'Password@123' })).data.token;

    // 3. Register & Verify Other User
    await fetchData('POST', '/auth/register', { name: 'Other User', email: otherEmail, password: 'Password@123' });
    const otherUser = await User.findOne({ email: otherEmail }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: otherEmail, otp: otherUser.otp.code });
    const oToken = (await fetchData('POST', '/auth/login', { email: otherEmail, password: 'Password@123' })).data.token;

    // Create Classroom
    const createRes = await fetchData('POST', '/classroom/create', { name: 'Cal Physics', subject: 'Physics', privacy: 'public' }, tToken);
    const classCode = createRes.data.classroom.code;
    const classroomId = createRes.data.classroom._id;

    // Student joins classroom
    await fetchData('POST', '/classroom/join', { code: classCode }, sToken);

    // Create assignments:
    const a1 = new Assignment({
      name: 'Thermodynamics Homework',
      description: 'Solve problems 1-10',
      dueDate: '2026-10-20',
      classroom: classroomId,
      teacher: teacherUser._id
    });
    await a1.save();

    // Create lectures: 1 upcoming, 1 completed, 1 live
    const lUpcoming = new Lecture({
      title: 'Optics Lecture',
      description: 'Lenses and mirrors',
      date: '2026-10-22',
      time: '14:00',
      startTime: new Date('2026-10-22T08:30:00.000Z'),
      classroom: classroomId,
      teacher: teacherUser._id,
      status: 'upcoming'
    });
    await lUpcoming.save();

    const lCompleted = new Lecture({
      title: 'Classical Mechanics',
      description: 'Newtonian physics',
      date: '2026-10-10',
      time: '11:00',
      startTime: new Date('2026-10-10T05:30:00.000Z'),
      classroom: classroomId,
      teacher: teacherUser._id,
      status: 'completed'
    });
    await lCompleted.save();

    const lLive = new Lecture({
      title: 'Electromagnetism Live',
      description: 'Maxwell equations',
      date: '2026-10-14',
      time: '16:00',
      startTime: new Date('2026-10-14T10:30:00.000Z'),
      classroom: classroomId,
      teacher: teacherUser._id,
      status: 'live',
      isLive: true
    });
    await lLive.save();

    // TEST 1: Calendar skips stale/null classroom references instead of crashing
    await test('1. GET /user/calendar skips stale/null classroom references safely', async () => {
      // Intentionally insert a non-existent ObjectId into user's joinedClasses and createdClasses
      const fakeId = new mongoose.Types.ObjectId();
      await User.findByIdAndUpdate(teacherUser._id, { $push: { createdClasses: fakeId } });
      await User.findByIdAndUpdate(studentUser._id, { $push: { joinedClasses: fakeId } });

      const resTeacher = await fetchData('GET', '/user/calendar', null, tToken);
      assert.strictEqual(resTeacher.status, 200);
      assert.strictEqual(resTeacher.data.success, true);
      assert(Array.isArray(resTeacher.data.details.created));

      const resStudent = await fetchData('GET', '/user/calendar', null, sToken);
      assert.strictEqual(resStudent.status, 200);
      assert.strictEqual(resStudent.data.success, true);
      assert(Array.isArray(resStudent.data.details.joined));

      // Clean up fakeIds
      await User.findByIdAndUpdate(teacherUser._id, { $pull: { createdClasses: fakeId } });
      await User.findByIdAndUpdate(studentUser._id, { $pull: { joinedClasses: fakeId } });
    });

    // TEST 2: Calendar returns created classroom assignments for teacher
    await test('2. GET /user/calendar returns created classroom assignments for teacher', async () => {
      const res = await fetchData('GET', '/user/calendar', null, tToken);
      assert.strictEqual(res.status, 200);
      const created = res.data.details.created;
      const targetClass = created.find(c => c._id.toString() === classroomId.toString());
      assert(targetClass, 'Created classroom must be in details.created');
      assert(Array.isArray(targetClass.assignments), 'Created classroom must have assignments array');
      const foundA = targetClass.assignments.find(a => a._id.toString() === a1._id.toString());
      assert(foundA, 'Assignment must be returned under teacher created class');
      assert.strictEqual(foundA.title, 'Thermodynamics Homework');
      assert.strictEqual(foundA.dueDate, '2026-10-20');
    });

    // TEST 3: Calendar preserves lecture status (upcoming, completed, live)
    await test('3. GET /user/calendar preserves lecture lifecycle status', async () => {
      const res = await fetchData('GET', '/user/calendar', null, tToken);
      assert.strictEqual(res.status, 200);
      const targetClass = res.data.details.created.find(c => c._id.toString() === classroomId.toString());
      assert(targetClass && targetClass.lectures.length >= 3);

      const up = targetClass.lectures.find(l => l._id.toString() === lUpcoming._id.toString());
      const comp = targetClass.lectures.find(l => l._id.toString() === lCompleted._id.toString());
      const live = targetClass.lectures.find(l => l._id.toString() === lLive._id.toString());

      assert(up, 'Upcoming lecture must be present');
      assert.strictEqual(up.status, 'upcoming');

      assert(comp, 'Completed lecture must be present in historical calendar');
      assert.strictEqual(comp.status, 'completed');

      assert(live, 'Live lecture must be present');
      assert.strictEqual(live.status, 'live');
    });

    // TEST 4 & 6: Reminder creation, GET excludes expired reminders, sorts chronologically
    let reminder1Id, reminder2Id;
    await test('4 & 6. Reminder GET excludes expired reminders and sorts upcoming chronologically', async () => {
      const futureTime1 = new Date(Date.now() + 86400000 * 2).toISOString(); // 2 days later
      const futureTime2 = new Date(Date.now() + 86400000 * 1).toISOString(); // 1 day later

      // Student creates 2 reminders (create in reverse order to test sorting)
      const r1 = await fetchData('POST', '/reminder', { lectureId: lUpcoming._id, scheduledTime: futureTime1 }, sToken);
      assert.strictEqual(r1.status, 201);
      reminder1Id = r1.data.reminder._id;

      const r2 = await fetchData('POST', '/reminder', { lectureId: lUpcoming._id, scheduledTime: futureTime2 }, sToken);
      assert.strictEqual(r2.status, 201);
      reminder2Id = r2.data.reminder._id;

      // Manually insert an expired reminder in the past directly in DB
      const pastReminder = new Reminder({
        user: studentUser._id,
        lecture: lUpcoming._id,
        scheduledTime: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      });
      await pastReminder.save();

      const getRes = await fetchData('GET', '/reminder', null, sToken);
      assert.strictEqual(getRes.status, 200);
      const reminders = getRes.data.reminders;

      // Ensure past reminder is NOT present
      const hasPast = reminders.some(r => r._id.toString() === pastReminder._id.toString());
      assert.strictEqual(hasPast, false, 'Expired reminder must not be returned');

      // Ensure upcoming reminders are sorted chronologically: futureTime2 (1 day) < futureTime1 (2 days)
      assert(reminders.length >= 2, 'Should have at least 2 upcoming reminders');
      const idx1 = reminders.findIndex(r => r._id.toString() === reminder1Id.toString());
      const idx2 = reminders.findIndex(r => r._id.toString() === reminder2Id.toString());
      assert(idx2 < idx1, 'Reminders must be sorted in ascending chronological order');
    });

    // TEST 5: Reminder GET excludes orphaned lecture/classroom reminders
    await test('5. Reminder GET excludes orphaned reminders from deleted lecture or classroom', async () => {
      // Create a temporary deleted lecture and reminder
      const tempLecture = new Lecture({
        title: 'Ghost Class',
        description: 'To be deleted',
        date: '2026-11-01',
        time: '12:00',
        startTime: new Date('2026-11-01T06:30:00.000Z'),
        classroom: classroomId,
        teacher: teacherUser._id,
        status: 'upcoming'
      });
      await tempLecture.save();

      const rGhost = await fetchData('POST', '/reminder', {
        lectureId: tempLecture._id,
        scheduledTime: new Date(Date.now() + 86400000 * 5).toISOString()
      }, sToken);
      assert.strictEqual(rGhost.status, 201);

      // Now delete the lecture from DB
      await Lecture.findByIdAndDelete(tempLecture._id);

      // Fetch reminders: ghost reminder should be filtered out safely
      const getRes = await fetchData('GET', '/reminder', null, sToken);
      assert.strictEqual(getRes.status, 200);
      const hasGhost = getRes.data.reminders.some(r => r._id.toString() === rGhost.data.reminder._id.toString());
      assert.strictEqual(hasGhost, false, 'Orphaned reminder with null lecture must be filtered out');
    });

    // TEST 7: Reminder create rejects deleted/null classroom safely
    await test('7. Reminder create rejects deleted/null classroom safely without crash', async () => {
      // Create lecture referencing non-existent classroom
      const orphanedLecture = new Lecture({
        title: 'Orphaned Lecture',
        description: 'Orphaned class description',
        date: '2026-11-05',
        time: '10:00',
        startTime: new Date('2026-11-05T04:30:00.000Z'),
        classroom: new mongoose.Types.ObjectId(), // Non-existent
        teacher: teacherUser._id,
        status: 'upcoming'
      });
      await orphanedLecture.save();

      const res = await fetchData('POST', '/reminder', {
        lectureId: orphanedLecture._id,
        scheduledTime: new Date(Date.now() + 86400000 * 3).toISOString()
      }, sToken);

      // Must return 404 cleanly, not 500
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.success, false);
      assert(res.data.error.includes('Classroom'));
    });

    // TEST 8: Reminder update remains owner-only
    await test('8. Reminder update remains owner-only', async () => {
      // Other user tries to update student's reminder
      const updateRes = await fetchData('PUT', `/reminder/${reminder1Id}`, {
        scheduledTime: new Date(Date.now() + 86400000 * 4).toISOString()
      }, oToken);
      assert.strictEqual(updateRes.status, 404); // Not found or unauthorized

      // Student updates their own reminder
      const validUpdate = await fetchData('PUT', `/reminder/${reminder1Id}`, {
        scheduledTime: new Date(Date.now() + 86400000 * 4).toISOString()
      }, sToken);
      assert.strictEqual(validUpdate.status, 200);
      assert.strictEqual(validUpdate.data.success, true);
    });

    // TEST 9: Reminder delete remains owner-only
    await test('9. Reminder delete remains owner-only', async () => {
      // Other user tries to delete student's reminder
      const delRes = await fetchData('DELETE', `/reminder/${reminder2Id}`, null, oToken);
      assert.strictEqual(delRes.status, 404);

      // Student deletes their own reminder
      const validDel = await fetchData('DELETE', `/reminder/${reminder2Id}`, null, sToken);
      assert.strictEqual(validDel.status, 200);
      assert.strictEqual(validDel.data.success, true);
    });

    // Clean up created records
    await Classroom.findByIdAndDelete(classroomId);
    await Assignment.deleteMany({ classroom: classroomId });
    await Lecture.deleteMany({ classroom: classroomId });
    await Reminder.deleteMany({ user: { $in: [teacherUser._id, studentUser._id, otherUser._id] } });
    await User.deleteMany({ _id: { $in: [teacherUser._id, studentUser._id, otherUser._id] } });

    console.log(`\n=== Calendar Remediation Backend Suite Finished: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  }
};

runTests();
