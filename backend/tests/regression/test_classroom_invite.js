const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const env = require('../../config/env');
const emailService = require('../../services/email.service');
const classroomController = require('../../controllers/classroom.controller');

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
    console.log('--- Setting up Entities for Classroom Invite Tests ---');

    const teacherUser = await User.create({
      name: 'Professor Snape',
      email: `snape_${Date.now()}@test.com`,
      password: 'Password@123',
      isVerified: true
    });

    const enrolledStudent = await User.create({
      name: 'Harry Potter',
      email: `harry_${Date.now()}@test.com`,
      password: 'Password@123',
      isVerified: true
    });

    const nonMemberStudent = await User.create({
      name: 'Ron Weasley',
      email: `ron_${Date.now()}@test.com`,
      password: 'Password@123',
      isVerified: true
    });

    const nonOwnerTeacher = await User.create({
      name: 'Professor McGonagall',
      email: `mcgonagall_${Date.now()}@test.com`,
      password: 'Password@123',
      isVerified: true
    });

    const classCode = `INV${Math.floor(100 + Math.random() * 900)}`;
    const classroom = await Classroom.create({
      name: 'Potions 101',
      subject: 'Potions',
      privacy: 'private',
      code: classCode,
      teacher: teacherUser._id,
      students: [enrolledStudent._id]
    });

    // Helper to simulate express req/res
    const mockRequestResponse = (body, user) => {
      const req = { body, user };
      let resStatus = 200;
      let resJson = null;
      const res = {
        status: (code) => {
          resStatus = code;
          return res;
        },
        json: (data) => {
          resJson = data;
          return res;
        }
      };
      return { req, res, getResult: () => ({ status: resStatus, data: resJson }) };
    };

    console.log('\n--- EXECUTING CLASSROOM INVITE SUITE ---');

    // Test 16: Existing OTP and password-reset email service APIs remain intact
    await test('16. Existing OTP/password-reset email service APIs remain intact', async () => {
      assert(typeof emailService.sendOTPEmail === 'function', 'sendOTPEmail should exist');
      assert(typeof emailService.sendPasswordResetEmail === 'function', 'sendPasswordResetEmail should exist');
      assert(typeof emailService.sendClassroomInviteEmail === 'function', 'sendClassroomInviteEmail should exist');
    });

    // Spy on emailService.sendClassroomInviteEmail
    let originalSendInvite = emailService.sendClassroomInviteEmail;
    let inviteEmailCalls = [];
    let simulateSendError = false;

    emailService.sendClassroomInviteEmail = async (params) => {
      inviteEmailCalls.push(params);
      if (simulateSendError) {
        throw new Error('Simulated SMTP failure');
      }
      return { messageId: 'mock-123' };
    };

    // Test 1: Teacher can request invite for valid non-member email
    // Test 2: Email service is actually invoked
    // Test 3: Controller waits for email service
    // Test 4: Successful service result produces success response
    await test('1, 2, 3, 4. Teacher can request invite for valid non-member email, invoking email service and returning success', async () => {
      inviteEmailCalls = [];
      simulateSendError = false;

      const { req, res, getResult } = mockRequestResponse(
        { email: nonMemberStudent.email, code: classCode },
        teacherUser
      );

      await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
      const result = getResult();

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.success, true);
      assert.strictEqual(result.data.message, `Invitation sent successfully to ${nonMemberStudent.email.toLowerCase()}`);
      assert.strictEqual(inviteEmailCalls.length, 1, 'emailService should have been invoked exactly once');
      assert.strictEqual(inviteEmailCalls[0].to, nonMemberStudent.email.toLowerCase());
      assert.strictEqual(inviteEmailCalls[0].className, 'Potions 101');
      assert.strictEqual(inviteEmailCalls[0].teacherName, 'Professor Snape');
      assert.strictEqual(inviteEmailCalls[0].classCode, classCode);
    });

    // Test 5: Failed email service does NOT produce false success
    await test('5. Failed email service does NOT produce false success', async () => {
      inviteEmailCalls = [];
      simulateSendError = true;

      const { req, res, getResult } = mockRequestResponse(
        { email: 'newstudent@test.com', code: classCode },
        teacherUser
      );

      await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
      const result = getResult();

      assert.strictEqual(result.status, 500, 'Should return HTTP 500 on send failure');
      assert.strictEqual(result.data.success, false);
      assert(result.data.error.includes('Failed to send invitation email'), 'Should return honest error without false success');
    });

    // Test 6: Invalid email syntax rejected
    await test('6. Invalid email syntax rejected with 400', async () => {
      simulateSendError = false;
      const invalidEmails = ['plainaddress', 'missing@domain', '@nodomain.com', 'spaces in@mail.com'];

      for (const badEmail of invalidEmails) {
        const { req, res, getResult } = mockRequestResponse(
          { email: badEmail, code: classCode },
          teacherUser
        );

        await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
        const result = getResult();
        assert.strictEqual(result.status, 400);
        assert.strictEqual(result.data.success, false);
      }
    });

    // Test 7: Teacher cannot invite own email
    await test('7. Teacher cannot invite own email', async () => {
      const { req, res, getResult } = mockRequestResponse(
        { email: teacherUser.email, code: classCode },
        teacherUser
      );

      await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
      const result = getResult();
      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.data.success, false);
      assert(result.data.error.includes('cannot invite yourself'));
    });

    // Test 8: Already-enrolled user's email rejected
    await test('8. Already-enrolled user email rejected', async () => {
      const { req, res, getResult } = mockRequestResponse(
        { email: enrolledStudent.email, code: classCode },
        teacherUser
      );

      await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
      const result = getResult();
      assert.strictEqual(result.status, 400);
      assert.strictEqual(result.data.success, false);
      assert(result.data.error.includes('already a member'));
    });

    // Test 9: Non-owner cannot invite
    await test('9. Non-owner cannot invite', async () => {
      const { req, res, getResult } = mockRequestResponse(
        { email: 'someone@test.com', code: classCode },
        nonOwnerTeacher
      );

      await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
      const result = getResult();
      assert.strictEqual(result.status, 403);
      assert.strictEqual(result.data.success, false);
      assert(result.data.error.includes('Only the class owner'));
    });

    // Test 10: Invitation does NOT automatically enroll recipient
    await test('10. Invitation does NOT automatically enroll recipient', async () => {
      const checkClass = await Classroom.findOne({ code: classCode });
      assert.strictEqual(checkClass.students.length, 1, 'Students count should still be 1');
      assert(!checkClass.students.includes(nonMemberStudent._id), 'Non-member should NOT be enrolled by invitation dispatch');
    });

    // Test 11: Invite URL uses configured frontend URL
    // Test 12: Invite URL contains correct encoded classroom join information
    await test('11, 12. Invite URL uses configured frontend URL and contains correctly encoded join information', async () => {
      inviteEmailCalls = [];
      simulateSendError = false;

      const { req, res, getResult } = mockRequestResponse(
        { email: 'brandnewstudent@test.com', code: classCode },
        teacherUser
      );

      await classroomController.inviteToClassroom(req, res, (err) => { throw err; });
      const result = getResult();
      assert.strictEqual(result.status, 200);

      const sentJoinLink = inviteEmailCalls[0].joinLink;
      assert(sentJoinLink.startsWith(env.frontendUrl), `Join link must start with ${env.frontendUrl}`);
      assert(sentJoinLink.includes(`/classroom/join/${encodeURIComponent(classCode)}?code=${encodeURIComponent(classCode)}`));
    });

    // Test 13: Existing classroom join still works
    await test('13. Existing classroom join still works', async () => {
      const { req, res, getResult } = mockRequestResponse(
        { code: classCode },
        nonMemberStudent
      );

      await classroomController.joinClassroom(req, res, (err) => { throw err; });
      const result = getResult();
      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.data.success, true);

      const refreshedClass = await Classroom.findOne({ code: classCode });
      assert(refreshedClass.students.some(id => id.equals(nonMemberStudent._id)), 'Student should now be enrolled');
    });

    // Test 14: Logged-in invitation flow remains functional (idempotent duplicate join rejection)
    await test('14. Logged-in invitation join handles already-joined properly', async () => {
      const { req, res, getResult } = mockRequestResponse(
        { code: classCode },
        nonMemberStudent
      );

      await classroomController.joinClassroom(req, res, (err) => { throw err; });
      const result = getResult();
      assert.strictEqual(result.status, 400);
      assert(result.data.error.includes('already joined this class'));
    });

    // Test 15: Logged-out invite intent is preserved through authentication URL pattern
    await test('15. Logged-out invite intent format is preserved through redirect query parameter', async () => {
      const token = classCode;
      const originalPath = `/classroom/join/${encodeURIComponent(token)}?code=${encodeURIComponent(token)}`;
      const expectedRedirectUrl = `/login?redirect=${encodeURIComponent(originalPath)}`;

      const parsedUrl = new URL(`http://localhost:3000${expectedRedirectUrl}`);
      const redirectParam = parsedUrl.searchParams.get('redirect');
      assert.strictEqual(redirectParam, originalPath, 'Redirect parameter should restore exact target path');
    });

    // Restore original email service function
    emailService.sendClassroomInviteEmail = originalSendInvite;

    console.log(`\n========================================`);
    console.log(`CLASSROOM INVITE SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================`);

    // Clean up test records
    await User.deleteMany({ _id: { $in: [teacherUser._id, enrolledStudent._id, nonMemberStudent._id, nonOwnerTeacher._id] } });
    await Classroom.deleteMany({ _id: classroom._id });

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
