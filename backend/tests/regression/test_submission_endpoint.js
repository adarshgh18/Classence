const mongoose = require('mongoose');
const https = require('https');
const env = require('../../config/env');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Assignment = require('../../models/Assignment');
const Submission = require('../../models/Submission');

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
    const req = async (method, path, body = null, token = null) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(base + path, opts);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    const reqMultipart = async (method, path, formData, token = null) => {
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const opts = { method, headers, body: formData };
      const res = await fetch(base + path, opts);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    console.log('\n--- Setup Test Entities ---');
    const tEmail = 'subtest_teacher@test.com';
    const s1Email = 'subtest_s1@test.com';
    const s2Email = 'subtest_s2@test.com';
    const outsiderEmail = 'subtest_outsider@test.com';

    await User.deleteMany({ email: { $in: [tEmail, s1Email, s2Email, outsiderEmail] } });
    await Classroom.deleteMany({ name: 'SubTest Classroom' });

    // Helper to create & verify user
    async function createUser(name, email, role = 'Student') {
      await req('POST', '/auth/register', { name, email, password: 'Password@123', role });
      const u = await User.findOne({ email }).select('+otp.code');
      await req('POST', '/auth/verify', { email, otp: u.otp.code });
      const login = await req('POST', '/auth/login', { email, password: 'Password@123' });
      return { user: u, token: login.data.token };
    }

    const teacher = await createUser('Teacher T', tEmail, 'Teacher');
    const student1 = await createUser('Student 1', s1Email, 'Student');
    const student2 = await createUser('Student 2', s2Email, 'Student');
    const outsider = await createUser('Outsider O', outsiderEmail, 'Student');

    // Teacher creates classroom
    const createClassRes = await req('POST', '/classroom/create', {
      name: 'SubTest Classroom',
      subject: 'Audit Math',
      privacy: 'public'
    }, teacher.token);
    if (!createClassRes.data?.classroom) {
      console.error('createClassRes error:', createClassRes);
      process.exit(1);
    }
    const classroom = createClassRes.data.classroom;
    const classCode = classroom.code;

    // Student 1 and Student 2 join classroom
    await req('POST', '/classroom/join', { code: classCode }, student1.token);
    await req('POST', '/classroom/join', { code: classCode }, student2.token);

    // Teacher creates assignment
    const form = new FormData();
    form.append('name', 'SubTest Assignment');
    form.append('description', 'Test Assignment Description');
    form.append('dueDate', '2026-12-31');
    form.append('code', classCode);

    const createAssignRes = await reqMultipart('POST', '/assignment/create', form, teacher.token);
    const assignmentId = createAssignRes.data.assignment._id;

    console.log('\n--- Running Test Cases ---');

    // Test E: Unauthenticated request is rejected
    const unauthRes = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`);
    assert(unauthRes.status === 401, 'Test E: Unauthenticated request returns 401');

    // Test F: Invalid assignmentId is handled safely
    const invalidIdRes = await req('GET', `/submission/my-submission?assignmentId=notanobjectid`, null, student1.token);
    assert(invalidIdRes.status === 400 && invalidIdRes.data.error === 'Invalid assignmentId', 'Test F: Invalid assignmentId returns 400');

    // Test missing assignmentId
    const missingIdRes = await req('GET', `/submission/my-submission`, null, student1.token);
    assert(missingIdRes.status === 400 && missingIdRes.data.error === 'assignmentId is required', 'Test F2: Missing assignmentId returns 400');

    // Test G: Nonexistent assignment is handled safely
    const fakeId = new mongoose.Types.ObjectId();
    const nonExistentRes = await req('GET', `/submission/my-submission?assignmentId=${fakeId}`, null, student1.token);
    assert(nonExistentRes.status === 404 && nonExistentRes.data.error === 'Assignment not found', 'Test G: Nonexistent assignment returns 404');

    // Test D: Outsider/non-member cannot retrieve classroom submission
    const outsiderRes = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`, null, outsider.token);
    assert(outsiderRes.status === 403 && outsiderRes.data.error === 'You are not enrolled in this classroom', 'Test D: Outsider receives 403 enrolled check');

    // Test B: Enrolled student with no submission receives submission: null
    const noSubRes = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`, null, student1.token);
    assert(noSubRes.status === 200 && noSubRes.data.success === true && noSubRes.data.submission === null, 'Test B: Enrolled student with no submission receives submission: null');

    // Student 1 submits work
    console.log('\n--- Student 1 Submits Work ---');
    const subForm = new FormData();
    subForm.append('assignmentId', assignmentId);
    const dummyBlob = new Blob(['Sample submission content'], { type: 'text/plain' });
    subForm.append('media', dummyBlob, 'mysubmission.txt');

    const submitRes = await reqMultipart('POST', '/submission/create', subForm, student1.token);
    assert(submitRes.status === 201 && submitRes.data.submission, 'Student 1 submits file successfully (201)');

    // Test A: Enrolled student can retrieve their own submission
    const getSubRes = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`, null, student1.token);
    const sub1 = getSubRes.data.submission;
    assert(
      getSubRes.status === 200 &&
      getSubRes.data.success === true &&
      sub1 &&
      sub1.media && sub1.media.length === 1 &&
      sub1.isGraded === false &&
      sub1.marks === null &&
      sub1.createdAt &&
      sub1.filesMetadata === undefined && // Internal field NOT exposed
      sub1.student === undefined,         // Internal field NOT exposed
      'Test A: Enrolled student retrieves own submission with clean projected fields'
    );

    // Test C: Student 2 cannot retrieve Student 1's submission (queries only student 2's own)
    const getSub2Res = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`, null, student2.token);
    assert(
      getSub2Res.status === 200 &&
      getSub2Res.data.success === true &&
      getSub2Res.data.submission === null,
      "Test C: Student 2 receives submission: null, never exposing Student 1's submission"
    );

    // Test H: Existing duplicate-submission protection still works
    const dupForm = new FormData();
    dupForm.append('assignmentId', assignmentId);
    dupForm.append('media', dummyBlob, 'duplicate.txt');
    const dupRes = await reqMultipart('POST', '/submission/create', dupForm, student1.token);
    assert(
      dupRes.status === 400 &&
      dupRes.data.error === 'You have already submitted this assignment',
      'Test H: Duplicate submission is rejected with 400 "You have already submitted this assignment"'
    );

    // End-to-end: Teacher grades Student 1's submission
    console.log('\n--- Teacher Grades Submission ---');
    const gradeRes = await req('POST', '/submission/grade', {
      submissionId: sub1._id,
      marks: 9
    }, teacher.token);
    assert(gradeRes.status === 200 && gradeRes.data.submission.isGraded === true, 'Teacher grades submission with marks: 9 (200)');

    // Student 1 refreshes (GET /my-submission) and sees updated grading result
    console.log('\n--- Student 1 Refresh / GET Check ---');
    const refreshedSubRes = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`, null, student1.token);
    const refreshedSub = refreshedSubRes.data.submission;
    assert(
      refreshedSubRes.status === 200 &&
      refreshedSub.isGraded === true &&
      refreshedSub.marks === 9,
      'Student fresh GET retrieves updated isGraded: true and marks: 9'
    );

    // Cloudinary media availability check
    if (refreshedSub.media && refreshedSub.media[0]) {
      const httpStatus = await new Promise((resolve) => {
        const r = https.request(refreshedSub.media[0], { method: 'HEAD' }, (res) => {
          resolve(res.statusCode);
        });
        r.on('error', (e) => resolve('ERROR'));
        r.end();
      });
      assert(httpStatus === 200, 'Cloudinary attachment URL returns HTTP 200 OK');
    }

    // Cleanup test data
    await User.deleteMany({ email: { $in: [tEmail, s1Email, s2Email, outsiderEmail] } });
    await Classroom.deleteMany({ name: 'SubTest Classroom' });
    await Assignment.deleteMany({ _id: assignmentId });
    await Submission.deleteMany({ assignment: assignmentId });

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
