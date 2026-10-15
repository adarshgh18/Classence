const mongoose = require('mongoose');
const assert = require('assert');
const { io: Client } = require('../../../frontend/node_modules/socket.io-client');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Assignment = require('../../models/Assignment');
const Submission = require('../../models/Submission');
const Announcement = require('../../models/Announcement');
const Lecture = require('../../models/Lecture');
const Notification = require('../../models/Notification');
const notificationService = require('../../services/notification.service');

const BASE_URL = 'http://127.0.0.1:5000/api';
const SOCKET_URL = 'http://127.0.0.1:5000';

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

const runAllTests = async () => {
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
    console.log('--- Connected to MongoDB. Running Phase 2 Notification Tests ---');

    const timestamp = Date.now();
    const teacherEmail = `notif_teacher_${timestamp}@test.com`;
    const student1Email = `notif_student1_${timestamp}@test.com`;
    const student2Email = `notif_student2_${timestamp}@test.com`;
    const outsiderEmail = `notif_outsider_${timestamp}@test.com`;
    const password = 'Password@123';

    // Helper to register, verify, and log in a user
    const createAndLoginUser = async (name, email) => {
      await fetchData('POST', '/auth/register', { name, email, password });
      const user = await User.findOne({ email }).select('+otp.code');
      await fetchData('POST', '/auth/verify', { email, otp: user.otp.code });
      const loginRes = await fetchData('POST', '/auth/login', { email, password });
      return {
        id: user._id.toString(),
        token: loginRes.data.token,
        email
      };
    };

    const teacher = await createAndLoginUser('Teacher Notif', teacherEmail);
    const student1 = await createAndLoginUser('Student 1 Notif', student1Email);
    const student2 = await createAndLoginUser('Student 2 Notif', student2Email);
    const outsider = await createAndLoginUser('Outsider Notif', outsiderEmail);

    // Create a classroom
    const createClassRes = await fetchData(
      'POST',
      '/classroom/create',
      { name: 'Notification Test Class', subject: 'Notifications', privacy: 'public' },
      teacher.token
    );
    assert.strictEqual(createClassRes.status, 201, 'Classroom creation should succeed');
    const classCode = createClassRes.data.classroom.code;

    // Enroll student1 and student2
    const joinRes1 = await fetchData('POST', '/classroom/join', { code: classCode }, student1.token);
    assert.strictEqual(joinRes1.status, 200, 'Student 1 should join');
    const joinRes2 = await fetchData('POST', '/classroom/join', { code: classCode }, student2.token);
    assert.strictEqual(joinRes2.status, 200, 'Student 2 should join');

    // -------------------------------------------------------------------------
    // API TESTS (1 - 8)
    // -------------------------------------------------------------------------

    // 1. Unauthenticated GET is rejected (401)
    await test('1. unauthenticated GET is rejected with 401', async () => {
      const res = await fetchData('GET', '/notification');
      assert.strictEqual(res.status, 401, 'Expected 401 Unauthorized');
    });

    // 2. User sees only own notifications
    await test('2. user sees only own notifications', async () => {
      // Direct insertion fixture for student1 and student2
      await Notification.create({
        recipient: student1.id,
        type: 'ASSIGNMENT_CREATED',
        title: 'Only for Student 1',
        message: 'Student 1 secret message'
      });
      await Notification.create({
        recipient: student2.id,
        type: 'ASSIGNMENT_CREATED',
        title: 'Only for Student 2',
        message: 'Student 2 secret message'
      });

      const res1 = await fetchData('GET', '/notification', null, student1.token);
      assert.strictEqual(res1.status, 200);
      assert.ok(res1.data.notifications.some(n => n.title === 'Only for Student 1'));
      assert.ok(!res1.data.notifications.some(n => n.title === 'Only for Student 2'));
    });

    // 3. Newest-first ordering
    await test('3. newest-first ordering', async () => {
      const older = new Date(Date.now() - 60000);
      const newer = new Date();
      await Notification.create({
        recipient: student1.id,
        type: 'ANNOUNCEMENT_CREATED',
        title: 'Older Notification',
        message: 'Old',
        createdAt: older
      });
      await Notification.create({
        recipient: student1.id,
        type: 'ANNOUNCEMENT_CREATED',
        title: 'Newer Notification',
        message: 'New',
        createdAt: newer
      });

      const res = await fetchData('GET', '/notification', null, student1.token);
      const idxNew = res.data.notifications.findIndex(n => n.title === 'Newer Notification');
      const idxOld = res.data.notifications.findIndex(n => n.title === 'Older Notification');
      assert.ok(idxNew < idxOld, 'Newer notification must appear before older notification');
    });

    // 4. Unread count correct
    await test('4. unread count correct', async () => {
      // Clear student1 notifications
      await Notification.deleteMany({ recipient: student1.id });
      await Notification.create([
        { recipient: student1.id, type: 'ASSIGNMENT_CREATED', title: 'N1', message: 'M1', isRead: false },
        { recipient: student1.id, type: 'ASSIGNMENT_CREATED', title: 'N2', message: 'M2', isRead: false },
        { recipient: student1.id, type: 'ASSIGNMENT_CREATED', title: 'N3', message: 'M3', isRead: true }
      ]);

      const res = await fetchData('GET', '/notification', null, student1.token);
      assert.strictEqual(res.data.unreadCount, 2, 'Unread count should be exactly 2');
    });

    // 5. Latest-result bound works (30 items limit)
    await test('5. latest-result bound works (<= 30)', async () => {
      await Notification.deleteMany({ recipient: outsider.id });
      const docs = [];
      for (let i = 0; i < 35; i++) {
        docs.push({
          recipient: outsider.id,
          type: 'ANNOUNCEMENT_CREATED',
          title: `Bulk Notice ${i}`,
          message: `Notice body ${i}`,
          createdAt: new Date(Date.now() + i * 1000)
        });
      }
      await Notification.insertMany(docs);

      const res = await fetchData('GET', '/notification', null, outsider.token);
      assert.strictEqual(res.data.notifications.length, 30, 'Must return at most 30 notifications');
    });

    // 6. User can mark own notification read
    let student1NotifId;
    await test('6. user can mark own notification read', async () => {
      const notif = await Notification.create({
        recipient: student1.id,
        type: 'ASSIGNMENT_CREATED',
        title: 'Mark Read Test',
        message: 'Please read me',
        isRead: false
      });
      student1NotifId = notif._id.toString();

      const patchRes = await fetchData('PATCH', `/notification/${student1NotifId}/read`, {}, student1.token);
      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(patchRes.data.notification.isRead, true);

      const verifyDoc = await Notification.findById(student1NotifId);
      assert.strictEqual(verifyDoc.isRead, true);
    });

    // 7. User cannot mark another user's notification read
    await test('7. user cannot mark another user\'s notification read', async () => {
      // student2 tries to mark student1's notification
      const patchRes = await fetchData('PATCH', `/notification/${student1NotifId}/read`, {}, student2.token);
      assert.strictEqual(patchRes.status, 403, 'Should be forbidden 403');
    });

    // 8. Mark-all affects only current user
    await test('8. mark-all affects only current user', async () => {
      await Notification.deleteMany({ recipient: student1.id });
      await Notification.deleteMany({ recipient: student2.id });

      await Notification.create([
        { recipient: student1.id, type: 'ASSIGNMENT_CREATED', title: 'S1-1', message: 'M', isRead: false },
        { recipient: student1.id, type: 'ASSIGNMENT_CREATED', title: 'S1-2', message: 'M', isRead: false },
        { recipient: student2.id, type: 'ASSIGNMENT_CREATED', title: 'S2-1', message: 'M', isRead: false }
      ]);

      const markRes = await fetchData('PATCH', '/notification/read-all', {}, student1.token);
      assert.strictEqual(markRes.status, 200);

      const s1Unread = await Notification.countDocuments({ recipient: student1.id, isRead: false });
      const s2Unread = await Notification.countDocuments({ recipient: student2.id, isRead: false });
      assert.strictEqual(s1Unread, 0, 'Student 1 unread count must be 0');
      assert.strictEqual(s2Unread, 1, 'Student 2 unread count must remain 1');
    });

    // -------------------------------------------------------------------------
    // PREFERENCE TESTS (9 - 12)
    // -------------------------------------------------------------------------

    // 9. Recipient with isNotification=true receives notification
    await test('9. recipient with isNotification=true receives notification', async () => {
      await User.findByIdAndUpdate(student1.id, { isNotification: true });
      const notif = await notificationService.createNotification({
        recipientId: student1.id,
        type: 'ASSIGNMENT_CREATED',
        title: 'Pref Test True',
        message: 'Notifications ON'
      });
      assert.ok(notif, 'Notification should be created');
      const inDb = await Notification.findById(notif._id);
      assert.ok(inDb, 'Notification must be in DB');
    });

    // 10. Recipient with isNotification=false receives none
    await test('10. recipient with isNotification=false receives none', async () => {
      await User.findByIdAndUpdate(student2.id, { isNotification: false });
      const notif = await notificationService.createNotification({
        recipientId: student2.id,
        type: 'ASSIGNMENT_CREATED',
        title: 'Pref Test False',
        message: 'Notifications OFF'
      });
      assert.strictEqual(notif, null, 'Notification creation must be suppressed');
      const inDb = await Notification.findOne({ recipient: student2.id, title: 'Pref Test False' });
      assert.strictEqual(inDb, null, 'No notification should exist in DB');
    });

    // 11. Disabling preference does not delete old notifications
    await test('11. disabling preference does not delete old notifications', async () => {
      // Ensure student1 has existing notifications
      const existing = await Notification.find({ recipient: student1.id });
      assert.ok(existing.length > 0, 'Student 1 should have pre-existing notifications');
      const prevCount = existing.length;

      // Disable notifications for student1 via official settings endpoint
      const offRes = await fetchData('POST', '/user/settings/change-is-notification-enabled', { isNotification: false }, student1.token);
      assert.strictEqual(offRes.status, 200);

      // Verify notifications still exist and are readable
      const getRes = await fetchData('GET', '/notification', null, student1.token);
      assert.strictEqual(getRes.data.notifications.length, prevCount);
    });

    // 12. Re-enabling does not backfill muted events
    await test('12. re-enabling does not backfill muted events', async () => {
      // student1 has isNotification: false currently
      // Attempt an announcement creation while student 1 is muted
      const mutedAnnouncementRes = await fetchData(
        'POST',
        '/announcement/create',
        { code: classCode, title: 'Muted Notice', description: 'Should not notify student 1' },
        teacher.token
      );
      assert.strictEqual(mutedAnnouncementRes.status, 201);
      await new Promise(r => setTimeout(r, 200));

      // Verify student 1 did NOT receive it
      const foundNotice = await Notification.findOne({
        recipient: student1.id,
        announcementId: mutedAnnouncementRes.data.announcement._id
      });
      assert.strictEqual(foundNotice, null, 'Muted event must not be created');

      // Re-enable notifications via official settings endpoint
      const onRes = await fetchData('POST', '/user/settings/change-is-notification-enabled', { isNotification: true }, student1.token);
      assert.strictEqual(onRes.status, 200);

      // Verify muted event is NOT retroactively created / backfilled
      const foundAfter = await Notification.findOne({
        recipient: student1.id,
        announcementId: mutedAnnouncementRes.data.announcement._id
      });
      assert.strictEqual(foundAfter, null, 'Muted event must not exist in history after re-enabling');
    });

    // -------------------------------------------------------------------------
    // EVENT TRIGGERS (13 - 21)
    // -------------------------------------------------------------------------

    // Reset student preferences to true for event testing
    await User.findByIdAndUpdate(student1.id, { isNotification: true });
    await User.findByIdAndUpdate(student2.id, { isNotification: true });
    await User.findByIdAndUpdate(teacher.id, { isNotification: true });

    let createdAssignmentId = null;

    // 13. Assignment creation notifies enrolled students
    await test('13. assignment creation notifies enrolled students', async () => {
      await Notification.deleteMany({ recipient: student1.id });
      await Notification.deleteMany({ recipient: student2.id });

      const res = await fetchData(
        'POST',
        '/assignment/create',
        { code: classCode, name: 'Physics Homework 1', dueDate: '2026-12-31', description: 'Solve problems' },
        teacher.token
      );
      assert.strictEqual(res.status, 201);
      createdAssignmentId = res.data.assignment._id;

      // Allow async notification creation
      await new Promise(r => setTimeout(r, 200));

      const s1Notifs = await Notification.find({ recipient: student1.id, type: 'ASSIGNMENT_CREATED' });
      const s2Notifs = await Notification.find({ recipient: student2.id, type: 'ASSIGNMENT_CREATED' });

      assert.strictEqual(s1Notifs.length, 1, 'Student 1 must receive 1 ASSIGNMENT_CREATED notification');
      assert.strictEqual(s2Notifs.length, 1, 'Student 2 must receive 1 ASSIGNMENT_CREATED notification');
      assert.ok(s1Notifs[0].message.includes('Physics Homework 1'));
    });

    // 14. Assignment creator/teacher is not notified
    await test('14. assignment creator/teacher is not notified', async () => {
      const teacherNotifs = await Notification.find({ recipient: teacher.id, type: 'ASSIGNMENT_CREATED' });
      assert.strictEqual(teacherNotifs.length, 0, 'Teacher must not receive ASSIGNMENT_CREATED notification');
    });

    // 20. Submission creation notifies classroom owner
    let student1SubmissionId = null;
    await test('20. submission creation notifies classroom owner', async () => {
      await Notification.deleteMany({ recipient: teacher.id });

      const res = await fetchData(
        'POST',
        '/submission/create',
        { assignmentId: createdAssignmentId },
        student1.token
      );
      assert.strictEqual(res.status, 201);
      student1SubmissionId = res.data.submission._id;

      await new Promise(r => setTimeout(r, 200));

      const teacherNotifs = await Notification.find({ recipient: teacher.id, type: 'SUBMISSION_RECEIVED' });
      assert.strictEqual(teacherNotifs.length, 1, 'Teacher must receive SUBMISSION_RECEIVED notification');
      assert.ok(teacherNotifs[0].message.includes('submitted'));
    });

    // 21. Submitting student does not receive submission notification
    await test('21. submitting student does not receive submission notification', async () => {
      const s1Notifs = await Notification.find({ recipient: student1.id, type: 'SUBMISSION_RECEIVED' });
      assert.strictEqual(s1Notifs.length, 0, 'Submitting student must not receive SUBMISSION_RECEIVED');
    });

    // 15. Grading notifies only submission owner/student
    await test('15. grading notifies only submission owner/student', async () => {
      await Notification.deleteMany({ recipient: student1.id });
      await Notification.deleteMany({ recipient: student2.id });

      const res = await fetchData(
        'POST',
        '/submission/grade',
        { submissionId: student1SubmissionId, marks: 9 },
        teacher.token
      );
      assert.strictEqual(res.status, 200);

      await new Promise(r => setTimeout(r, 200));

      const s1Notifs = await Notification.find({ recipient: student1.id, type: 'ASSIGNMENT_GRADED' });
      const s2Notifs = await Notification.find({ recipient: student2.id, type: 'ASSIGNMENT_GRADED' });

      assert.strictEqual(s1Notifs.length, 1, 'Student 1 must receive ASSIGNMENT_GRADED notification');
      assert.strictEqual(s2Notifs.length, 0, 'Student 2 must not receive ASSIGNMENT_GRADED notification');
      assert.ok(s1Notifs[0].message.includes('has been graded'));
    });

    // 16. Marks=0 grading still qualifies
    await test('16. marks=0 grading still qualifies', async () => {
      await Notification.deleteMany({ recipient: student1.id });

      const res = await fetchData(
        'POST',
        '/submission/grade',
        { submissionId: student1SubmissionId, marks: 0 },
        teacher.token
      );
      assert.strictEqual(res.status, 200);

      await new Promise(r => setTimeout(r, 200));

      const s1Notifs = await Notification.find({ recipient: student1.id, type: 'ASSIGNMENT_GRADED' });
      assert.strictEqual(s1Notifs.length, 1, 'Marks=0 must still generate ASSIGNMENT_GRADED notification');
    });

    // 17. Announcement creation notifies enrolled students
    await test('17. announcement creation notifies enrolled students', async () => {
      await Notification.deleteMany({ recipient: student1.id });
      await Notification.deleteMany({ recipient: student2.id });

      const res = await fetchData(
        'POST',
        '/announcement/create',
        { code: classCode, title: 'Exam Guidelines', description: 'Please bring pens' },
        teacher.token
      );
      assert.strictEqual(res.status, 201);

      await new Promise(r => setTimeout(r, 200));

      const s1Notifs = await Notification.find({ recipient: student1.id, type: 'ANNOUNCEMENT_CREATED' });
      const s2Notifs = await Notification.find({ recipient: student2.id, type: 'ANNOUNCEMENT_CREATED' });
      assert.strictEqual(s1Notifs.length, 1, 'Student 1 must receive ANNOUNCEMENT_CREATED');
      assert.strictEqual(s2Notifs.length, 1, 'Student 2 must receive ANNOUNCEMENT_CREATED');
    });

    // 18. Lecture creation notifies enrolled students
    let lectureId = null;
    await test('18. lecture creation notifies enrolled students', async () => {
      await Notification.deleteMany({ recipient: student1.id });
      await Notification.deleteMany({ recipient: student2.id });

      const res = await fetchData(
        'POST',
        '/lecture/create',
        {
          code: classCode,
          title: 'Quantum Mechanics 101',
          description: 'Introduction to wave functions',
          date: '2026-11-01',
          time: '10:00'
        },
        teacher.token
      );
      assert.strictEqual(res.status, 201);
      lectureId = res.data.lecture._id;

      await new Promise(r => setTimeout(r, 200));

      const s1Notifs = await Notification.find({ recipient: student1.id, type: 'LECTURE_SCHEDULED' });
      const s2Notifs = await Notification.find({ recipient: student2.id, type: 'LECTURE_SCHEDULED' });
      assert.strictEqual(s1Notifs.length, 1, 'Student 1 must receive LECTURE_SCHEDULED');
      assert.strictEqual(s2Notifs.length, 1, 'Student 2 must receive LECTURE_SCHEDULED');
      assert.ok(s1Notifs[0].message.includes('Quantum Mechanics 101'));
    });

    // 19. Lecture lifecycle changes do NOT create scheduled notifications
    await test('19. lecture lifecycle changes do NOT create scheduled notifications', async () => {
      const s1CountBefore = await Notification.countDocuments({
        recipient: student1.id,
        type: 'LECTURE_SCHEDULED'
      });

      // Update lecture
      await fetchData(
        'PUT',
        `/lecture/update?lectureId=${lectureId}`,
        {
          code: classCode,
          title: 'Quantum Mechanics Updated',
          description: 'Updated description',
          date: '2026-11-02',
          time: '11:00'
        },
        teacher.token
      );

      // Start lecture
      await fetchData('POST', '/lecture/start', { lectureId }, teacher.token);

      // Pause lecture
      await fetchData('POST', '/lecture/pause', { lectureId }, teacher.token);

      // Resume lecture
      await fetchData('POST', '/lecture/resume', { lectureId }, teacher.token);

      // End lecture
      await fetchData('POST', '/lecture/end', { lectureId }, teacher.token);

      await new Promise(r => setTimeout(r, 300));

      const s1CountAfter = await Notification.countDocuments({
        recipient: student1.id,
        type: 'LECTURE_SCHEDULED'
      });

      assert.strictEqual(
        s1CountAfter,
        s1CountBefore,
        'No additional LECTURE_SCHEDULED notifications should be created during lifecycle operations'
      );
    });

    // -------------------------------------------------------------------------
    // SOCKET / AUTH TESTS (22 - 24)
    // -------------------------------------------------------------------------

    let socketStudent1 = null;
    let socketStudent2 = null;

    await test('22. authenticated socket joins only its own user room', async () => {
      socketStudent1 = Client(SOCKET_URL, {
        auth: { token: student1.token },
        query: { token: student1.token },
        transports: ['websocket']
      });

      await new Promise((resolve, reject) => {
        socketStudent1.on('connect', resolve);
        socketStudent1.on('connect_error', reject);
      });

      assert.ok(socketStudent1.connected, 'Socket student 1 should be connected');
    });

    await test('23 & 24. notification real-time event targets correct user, unrelated users do not receive it', async () => {
      socketStudent2 = Client(SOCKET_URL, {
        auth: { token: student2.token },
        query: { token: student2.token },
        transports: ['websocket']
      });

      await new Promise((resolve, reject) => {
        socketStudent2.on('connect', resolve);
        socketStudent2.on('connect_error', reject);
      });

      let s1Received = null;
      let s2Received = null;

      socketStudent1.on('notification:new', (data) => {
        s1Received = data;
      });

      socketStudent2.on('notification:new', (data) => {
        s2Received = data;
      });

      // Trigger live server grading action targeted strictly to student 1
      const gradeRes = await fetchData(
        'POST',
        '/submission/grade',
        { submissionId: student1SubmissionId, marks: 10 },
        teacher.token
      );
      assert.strictEqual(gradeRes.status, 200);

      // Wait 1000ms for real-time socket delivery
      await new Promise(r => setTimeout(r, 1000));

      assert.ok(s1Received, 'Student 1 must receive real-time notification:new event');
      assert.strictEqual(s1Received.type, 'ASSIGNMENT_GRADED');
      assert.strictEqual(s2Received, null, 'Student 2 must NOT receive notification intended for Student 1');
    });

    if (socketStudent1) socketStudent1.disconnect();
    if (socketStudent2) socketStudent2.disconnect();

  } catch (err) {
    console.error('Test suite error:', err);
    failed++;
  } finally {
    console.log(`\n========================================`);
    console.log(`Total tests: ${passed + failed}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`========================================\n`);
    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
};

runAllTests();
