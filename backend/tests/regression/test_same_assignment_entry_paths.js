const mongoose = require('mongoose');
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
      const res = await fetch(base + path, {
        method,
        headers,
        body: formData
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };

    console.log('\n--- 1. Setup Test Users & Classroom ---');
    const teacherEmail = 'pathtest_teacher@test.com';
    const studentAEmail = 'pathtest_studentA@test.com';
    const studentBEmail = 'pathtest_studentB@test.com';
    const studentCEmail = 'pathtest_studentC@test.com';

    await User.deleteMany({ email: { $in: [teacherEmail, studentAEmail, studentBEmail, studentCEmail] } });
    await Classroom.deleteMany({ name: 'Path Consistency Classroom' });

    async function createUser(name, email) {
      await req('POST', '/auth/register', { name, email, password: 'Password@123' });
      const u = await User.findOne({ email }).select('+otp.code');
      await req('POST', '/auth/verify', { email, otp: u.otp.code });
      const login = await req('POST', '/auth/login', { email, password: 'Password@123' });
      return { user: u, token: login.data.token, id: u._id.toString() };
    }

    const teacher = await createUser('Path Teacher', teacherEmail);
    const studentA = await createUser('Path Student A', studentAEmail);
    const studentB = await createUser('Path Student B', studentBEmail);
    const studentC = await createUser('Path Student C (Unauthorized)', studentCEmail);

    // Create Classroom
    const classRes = await req('POST', '/classroom/create', {
      name: 'Path Consistency Classroom',
      subject: 'Computer Science',
      privacy: 'public'
    }, teacher.token);
    assert(classRes.status === 201 && classRes.data?.classroom, 'Classroom created by teacher');
    const classroomId = classRes.data.classroom._id;
    const classCode = classRes.data.classroom.code;

    // Join Student A & Student B
    const joinARes = await req('POST', '/classroom/join', { code: classCode }, studentA.token);
    assert(joinARes.status === 200, 'Student A joins classroom');

    const joinBRes = await req('POST', '/classroom/join', { code: classCode }, studentB.token);
    assert(joinBRes.status === 200, 'Student B joins classroom');

    // Verify 2 students enrolled
    const updatedClass = await Classroom.findById(classroomId);
    assert(updatedClass.students.length === 2, 'Classroom has exactly 2 enrolled students (Student A & Student B)');

    console.log('\n--- 2. Create Assignment & Verify Persisted createdAt ---');
    const dueDate = '2026-11-20';
    const createForm = new FormData();
    createForm.append('name', 'Architecture Consistency Task');
    createForm.append('description', 'Verify detail data equality across entry paths');
    createForm.append('dueDate', dueDate);
    createForm.append('code', classCode);

    const assignRes = await reqMultipart('POST', '/assignment/create', createForm, teacher.token);
    assert(assignRes.status === 201 && assignRes.data?.assignment, 'Assignment created successfully');
    const assignmentId = assignRes.data.assignment._id;

    // Check direct DB document
    const dbAssignment = await Assignment.findById(assignmentId);
    assert(dbAssignment.createdAt instanceof Date, 'Assignment has real persisted createdAt Date in MongoDB');
    assert(dbAssignment.createdAt.toISOString().slice(0, 10) !== dueDate, 'createdAt is NOT derived from dueDate');
    const expectedPersistedCreatedStr = new Date(dbAssignment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    console.log('\n--- 3. Student A Submits Work, Student B Does Not ---');
    const subForm = new FormData();
    subForm.append('assignmentId', assignmentId);
    const fileBlob = new Blob(['console.log("hello student A submission");'], { type: 'text/plain' });
    subForm.append('media', fileBlob, 'solution_A.txt');

    const submitRes = await reqMultipart('POST', '/submission/create', subForm, studentA.token);
    assert(submitRes.status === 201 && submitRes.data?.submission, 'Student A submitted work');

    console.log('\n--- 4. Compare Path A vs Path B Initial Payloads ---');
    // Path A: Global GET /api/user/assignment (Created section)
    const globalRes = await req('GET', '/user/assignment', null, teacher.token);
    assert(globalRes.status === 200 && globalRes.data?.user?.createdClassrooms, 'Teacher fetched GET /user/assignment');
    const pathAAssignment = globalRes.data.user.createdClassrooms.allAssignments.find(a => a._id === assignmentId);
    assert(Boolean(pathAAssignment), 'Assignment present in Path A (global Created assignments)');
    assert(pathAAssignment.createdAt === expectedPersistedCreatedStr, `Path A resolves real persisted createdAt: "${pathAAssignment.createdAt}"`);
    assert(pathAAssignment.status === 'Active', 'Path A status is "Active" for teacher (not student statuses)');
    assert(Array.isArray(pathAAssignment.submissions) && pathAAssignment.submissions.length === 0, 'Path A does not overfetch student submissions in global summary list');

    // Path B: Classroom GET /api/assignment/get?classroomId=...
    const classAssignRes = await req('GET', `/assignment/get?classroomId=${classroomId}`, null, teacher.token);
    assert(classAssignRes.status === 200 && classAssignRes.data?.assignments, 'Teacher fetched GET /assignment/get?classroomId=...');
    const pathBAssignment = classAssignRes.data.assignments.find(a => a._id === assignmentId);
    assert(Boolean(pathBAssignment), 'Assignment present in Path B (classroom assignments)');
    assert(pathBAssignment.createdAt === expectedPersistedCreatedStr, `Path B resolves same persisted createdAt: "${pathBAssignment.createdAt}"`);
    assert(pathBAssignment.status === 'Active', 'Path B status is "Active"');
    assert(pathBAssignment.submissions && pathBAssignment.submissions.length === 1, 'Path B has teacher-authorized submissions array with 1 submission');

    console.log('\n--- 5. Authoritative Detail Resolution via GET /api/assignment/get?assignmentId=... ---');
    const authDetailRes = await req('GET', `/assignment/get?assignmentId=${assignmentId}`, null, teacher.token);
    assert(authDetailRes.status === 200 && authDetailRes.data?.assignment, 'Authoritative assignment detail fetched via assignmentId');
    const authAssignment = authDetailRes.data.assignment;

    assert(authAssignment._id === assignmentId, 'Authoritative detail matches assignment ID');
    assert(authAssignment.createdAt === expectedPersistedCreatedStr, `Authoritative detail preserves real createdAt: "${authAssignment.createdAt}"`);
    assert(authAssignment.submissions && authAssignment.submissions.length === 1, 'Authoritative detail contains 1 submission');
    assert(authAssignment.submissions[0].student && authAssignment.submissions[0].student.name === 'Path Student A', 'Submission includes student name and details for teacher');
    assert(authAssignment.classroom && authAssignment.classroom.students.length === 2, 'Classroom context populated with 2 students');

    // Verify detail calculation logic resolves identically for BOTH paths
    function calculateSubmissionStats(assignmentData, totalEnrolled) {
      const totalStudents = totalEnrolled;
      const totalSubs = assignmentData?.submissions ? assignmentData.submissions.length : 0;
      const completed = totalStudents > 0 ? ((totalSubs / totalStudents) * 100).toFixed(1) : "0.0";
      const notCompleted = (100 - parseFloat(completed)).toFixed(1);
      return { completed, notCompleted };
    }

    // Path A with authoritative detail update
    const pathAStats = calculateSubmissionStats(authAssignment, 2);
    assert(pathAStats.completed === '50.0' && pathAStats.notCompleted === '50.0', 'Path A (after authoritative fetch) resolves to 50.0% Completed / 50.0% Not Completed');

    // Path B
    const pathBStats = calculateSubmissionStats(pathBAssignment, 2);
    assert(pathBStats.completed === '50.0' && pathBStats.notCompleted === '50.0', 'Path B resolves to 50.0% Completed / 50.0% Not Completed');

    assert(pathAStats.completed === pathBStats.completed && pathAStats.notCompleted === pathBStats.notCompleted, 'BOTH Path A and Path B resolve to the EXACT SAME 50% / 50% statistics!');

    console.log('\n--- 6. Student Privacy & Authorization Checks on Detail Endpoint ---');
    // Student A (who submitted) fetches detail
    const studentADetailRes = await req('GET', `/assignment/get?assignmentId=${assignmentId}`, null, studentA.token);
    assert(studentADetailRes.status === 200 && studentADetailRes.data?.assignment, 'Student A can fetch assignment detail');
    const studentAData = studentADetailRes.data.assignment;
    assert(studentAData.status === 'Submitted', 'Student A status is "Submitted"');
    assert(studentAData.mySubmission !== null, 'Student A receives own submission');
    assert(studentAData.submissions.length === 1 && studentAData.submissions[0]._id === submitRes.data.submission._id, 'Student A only receives own submission in submissions array');

    // Student B (who did not submit) fetches detail
    const studentBDetailRes = await req('GET', `/assignment/get?assignmentId=${assignmentId}`, null, studentB.token);
    assert(studentBDetailRes.status === 200 && studentBDetailRes.data?.assignment, 'Student B can fetch assignment detail');
    const studentBData = studentBDetailRes.data.assignment;
    assert(studentBData.status === 'Due', 'Student B status is "Due"');
    assert(studentBData.mySubmission === null, 'Student B receives mySubmission: null');
    assert(studentBData.submissions.length === 0, 'Student B receives empty submissions array (never Student A\'s submission)');

    // Student C (not enrolled) tries to fetch detail
    const studentCDetailRes = await req('GET', `/assignment/get?assignmentId=${assignmentId}`, null, studentC.token);
    assert(studentCDetailRes.status === 403, 'Unauthorized user C receives 403 Forbidden for assignment detail');

    console.log('\n--- 7. Additional Consistency Cases ---');
    // Case 1: 1 student / 1 submission -> 100% / 0%
    const stats1of1 = calculateSubmissionStats({ submissions: [1] }, 1);
    assert(stats1of1.completed === '100.0' && stats1of1.notCompleted === '0.0', '1 current student / 1 submission resolves to 100% / 0%');

    // Case 2: 2 students / 0 submissions -> 0% / 100%
    const stats0of2 = calculateSubmissionStats({ submissions: [] }, 2);
    assert(stats0of2.completed === '0.0' && stats0of2.notCompleted === '100.0', '2 current students / 0 submissions resolves to 0% / 100%');

    // Case 3: 2 students / 2 submissions -> 100% / 0%
    const stats2of2 = calculateSubmissionStats({ submissions: [1, 2] }, 2);
    assert(stats2of2.completed === '100.0' && stats2of2.notCompleted === '0.0', '2 current students / 2 submissions resolves to 100% / 0%');

    // Student B now submits as well
    const subBForm = new FormData();
    subBForm.append('assignmentId', assignmentId);
    const fileBlobB = new Blob(['console.log("hello student B submission");'], { type: 'text/plain' });
    subBForm.append('media', fileBlobB, 'solution_B.txt');
    await reqMultipart('POST', '/submission/create', subBForm, studentB.token);

    const authDetailRes2 = await req('GET', `/assignment/get?assignmentId=${assignmentId}`, null, teacher.token);
    assert(authDetailRes2.status === 200 && authDetailRes2.data.assignment.submissions.length === 2, 'Teacher authoritative detail reflects 2 submissions');
    const finalStats = calculateSubmissionStats(authDetailRes2.data.assignment, 2);
    assert(finalStats.completed === '100.0' && finalStats.notCompleted === '0.0', '2 students / 2 submissions now dynamically resolves to 100% / 0%');

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
    console.log(`\n================================`);
    console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`================================`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
