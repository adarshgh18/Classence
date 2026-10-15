const mongoose = require('mongoose');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Assignment = require('../../models/Assignment');
const Submission = require('../../models/Submission');
const fs = require('fs');
const { Blob } = require('buffer');

async function runTest() {
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
    await mongoose.connect('mongodb://127.0.0.1:27017/classence');
    
    // Cleanup old test users
    await User.deleteMany({ email: { $in: ['usera@test.com', 'userb@test.com', 'userc@test.com'] } });
    await Classroom.deleteMany({ name: 'Phase 4 Math' });
    await Assignment.deleteMany({ name: 'Phase 4 Assignment' });

    const base = 'http://localhost:5000/api';
    const req = async (method, path, body, token = null) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(base + path, opts);
      const data = await res.json();
      return { status: res.status, data };
    };

    const reqMultipart = async (method, path, formData, token = null) => {
      const headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const opts = { method, headers, body: formData };
      const res = await fetch(base + path, opts);
      const data = await res.json();
      return { status: res.status, data };
    };

    console.log('--- Setting up Users & Classroom ---');
    await req('POST', '/auth/register', { name: 'User A', email: 'usera@test.com', password: 'Password@123' });
    const userA = await User.findOne({ email: 'usera@test.com' }).select('+otp.code');
    await req('POST', '/auth/verify', { email: 'usera@test.com', otp: userA.otp.code });
    const loginA = await req('POST', '/auth/login', { email: 'usera@test.com', password: 'Password@123' });
    const tokenA = loginA.data.token;

    await req('POST', '/auth/register', { name: 'User B', email: 'userb@test.com', password: 'Password@123' });
    const userB = await User.findOne({ email: 'userb@test.com' }).select('+otp.code');
    await req('POST', '/auth/verify', { email: 'userb@test.com', otp: userB.otp.code });
    const loginB = await req('POST', '/auth/login', { email: 'userb@test.com', password: 'Password@123' });
    const tokenB = loginB.data.token;

    await req('POST', '/auth/register', { name: 'User C', email: 'userc@test.com', password: 'Password@123' });
    const userC = await User.findOne({ email: 'userc@test.com' }).select('+otp.code');
    await req('POST', '/auth/verify', { email: 'userc@test.com', otp: userC.otp.code });
    const loginC = await req('POST', '/auth/login', { email: 'userc@test.com', password: 'Password@123' });
    const tokenC = loginC.data.token;

    // A creates class
    let res = await req('POST', '/classroom/create', { name: 'Phase 4 Math', subject: 'Math', privacy: 'public' }, tokenA);
    const classCode = res.data.classroom.code;
    const classId = res.data.classroom._id;

    // B joins class
    await req('POST', '/classroom/join', { code: classCode }, tokenB);
    
    // Create a dummy file for multipart uploads
    fs.writeFileSync('dummy.txt', 'Hello Phase 4');
    
    console.log('\n--- 1. POST /api/assignment/create ---');
    // Non-owner cannot create
    let formC = new FormData();
    formC.append('code', classCode);
    formC.append('name', 'Phase 4 Assignment');
    formC.append('dueDate', '2030-12-31');
    res = await reqMultipart('POST', '/assignment/create', formC, tokenB);
    assert(res.status === 403, 'Non-teacher cannot create assignment');

    // Owner can create
    let formA = new FormData();
    formA.append('code', classCode);
    formA.append('name', 'Phase 4 Assignment');
    formA.append('dueDate', '2030-12-31');
    formA.append('description', 'Test Description');
    formA.append('media', new File([fs.readFileSync('dummy.txt')], 'dummy.txt', { type: 'text/plain' }));
    res = await reqMultipart('POST', '/assignment/create', formA, tokenA);
    assert(res.status === 201 && res.data.assignment, 'Teacher can create assignment with file');
    const assignmentId = res.data.assignment._id;
    console.log(res.data.assignment.media);
    assert(res.data.assignment.media.length === 1 && res.data.assignment.media[0].endsWith('.txt'), 'Media URL returned correctly');

    console.log('\n--- 2. GET /api/assignment/get ---');
    // Unauthorized user C cannot view
    res = await req('GET', `/assignment/get?classroomId=${classId}`, null, tokenC);
    assert(res.status === 403, 'User not in classroom cannot view assignments');

    // User B can view
    res = await req('GET', `/assignment/get?classroomId=${classId}`, null, tokenB);
    assert(res.status === 200 && res.data.assignments.length === 1, 'Enrolled user can view assignments');
    assert(res.data.assignments[0].name === 'Phase 4 Assignment', 'Assignment formatted correctly with name');

    console.log('\n--- 3. PUT /api/assignment/edit/:id ---');
    // Edit by teacher
    let editForm = new FormData();
    editForm.append('name', 'Phase 4 Assignment Edited');
    editForm.append('code', classCode);
    res = await reqMultipart('PUT', `/assignment/edit/${assignmentId}`, editForm, tokenA);
    assert(res.status === 200 && res.data.assignment.name === 'Phase 4 Assignment Edited', 'Teacher can edit assignment');
    assert(res.data.assignment.media.length === 1, 'Previous media is preserved when no new files are uploaded');

    console.log('\n--- 4. POST /api/submission/create ---');
    // User C (not enrolled) cannot submit
    let subFormC = new FormData();
    subFormC.append('assignmentId', assignmentId);
    res = await reqMultipart('POST', '/submission/create', subFormC, tokenC);
    assert(res.status === 403, 'Non-enrolled user cannot submit');

    // User B submits
    let subFormB = new FormData();
    subFormB.append('assignmentId', assignmentId);
    subFormB.append('media', new File([fs.readFileSync('dummy.txt')], 'dummy.txt', { type: 'text/plain' }));
    res = await reqMultipart('POST', '/submission/create', subFormB, tokenB);
    assert(res.status === 201 && res.data.submission, 'Enrolled user can submit assignment');
    const submissionId = res.data.submission._id;

    // User B duplicate submission
    let subFormB2 = new FormData();
    subFormB2.append('assignmentId', assignmentId);
    res = await reqMultipart('POST', '/submission/create', subFormB2, tokenB);
    assert(res.status === 400, 'Duplicate submissions are rejected');

    console.log('\n--- 5. POST /api/submission/grade ---');
    // User B cannot grade
    res = await req('POST', '/submission/grade', { submissionId, marks: 8 }, tokenB);
    assert(res.status === 403, 'Non-teacher cannot grade submission');

    // Teacher grades > 10 rejected
    res = await req('POST', '/submission/grade', { submissionId, marks: 11 }, tokenA);
    assert(res.status === 400, 'Marks > 10 rejected');

    // Teacher grades correctly
    res = await req('POST', '/submission/grade', { submissionId, marks: 8.5 }, tokenA);
    assert(res.status === 200 && res.data.submission.isGraded, 'Teacher successfully graded submission');

    console.log('\n--- 6. GET /api/user/assignment ---');
    // Check dashboard output for User B
    res = await req('GET', '/user/assignment', null, tokenB);
    assert(res.status === 200, 'Can retrieve user assignments dashboard');
    const bJoined = res.data.user.joinedClassrooms;
    assert(bJoined.allAssignments.length === 1 && bJoined.allAssignments[0].title === 'Phase 4 Assignment Edited', 'Dashboard returns "title" properly');
    assert(bJoined.completedAssignments === 1, 'Completed status calculated correctly based on submission');
    assert(res.data.user.recentGrades.length === 1 && res.data.user.recentGrades[0].includes('8.5'), 'Recent grades formatted correctly');

    console.log('\n--- 7. DELETE /api/assignment/delete ---');
    res = await req('DELETE', `/assignment/delete?id=${assignmentId}&code=${classCode}`, null, tokenB);
    assert(res.status === 403, 'Non-teacher cannot delete assignment');
    
    res = await req('DELETE', `/assignment/delete?id=${assignmentId}&code=${classCode}`, null, tokenA);
    assert(res.status === 200, 'Teacher can delete assignment');
    
    res = await req('GET', `/assignment/get?classroomId=${classId}`, null, tokenA);
    assert(res.data.assignments.length === 0, 'Assignment deleted');

    // Cleanup
    fs.unlinkSync('dummy.txt');

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal Error:', error);
    process.exit(1);
  }
}

runTest();
