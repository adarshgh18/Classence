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

    console.log('\n--- Setup Test Users & Classroom for Status Semantics ---');
    const teacherEmail = 'statustest_teacher@test.com';
    const student1Email = 'statustest_student1@test.com';
    const student2Email = 'statustest_student2@test.com';

    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email] } });
    await Classroom.deleteMany({ name: 'Status Semantics Classroom' });

    async function createUser(name, email) {
      await req('POST', '/auth/register', { name, email, password: 'Password@123' });
      const u = await User.findOne({ email }).select('+otp.code');
      await req('POST', '/auth/verify', { email, otp: u.otp.code });
      const login = await req('POST', '/auth/login', { email, password: 'Password@123' });
      return { user: u, token: login.data.token };
    }

    const teacher = await createUser('Status Teacher', teacherEmail);
    const student1 = await createUser('Status Student 1', student1Email);
    const student2 = await createUser('Status Student 2', student2Email);

    // Create Classroom
    const classRes = await req('POST', '/classroom/create', {
      name: 'Status Semantics Classroom',
      subject: 'Computer Science',
      privacy: 'public'
    }, teacher.token);
    assert(classRes.status === 201, 'Teacher created classroom');
    const classCode = classRes.data.classroom.code;
    const classroomId = classRes.data.classroom._id;

    // Join both students
    const join1 = await req('POST', '/classroom/join', { code: classCode }, student1.token);
    assert(join1.status === 200, 'Student 1 joined classroom');
    const join2 = await req('POST', '/classroom/join', { code: classCode }, student2.token);
    assert(join2.status === 200, 'Student 2 joined classroom');

    // Create assignments directly using Assignment model
    const assignFuture1 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Future Unsubmitted',
      description: 'Future unsubmitted test',
      dueDate: '2099-12-31'
    });
    const futureId1 = assignFuture1._id;

    const assignFuture2 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Future Submitted Ungraded',
      description: 'Future submitted ungraded test',
      dueDate: '2099-12-31'
    });
    const futureId2 = assignFuture2._id;

    const assignFuture3 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Future Submitted Graded 0',
      description: 'Future submitted graded 0 test',
      dueDate: '2099-12-31'
    });
    const futureId3 = assignFuture3._id;

    const assignPast1 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Past Unsubmitted',
      description: 'Past unsubmitted test',
      dueDate: '2020-01-01'
    });
    const pastId1 = assignPast1._id;

    const assignPast2 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Past Submitted Ungraded',
      description: 'Past submitted ungraded test',
      dueDate: '2020-01-01'
    });
    const pastId2 = assignPast2._id;

    const assignPast3 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Past Submitted Graded 10',
      description: 'Past submitted graded 10 test',
      dueDate: '2020-01-01'
    });
    const pastId3 = assignPast3._id;

    // Today's assignment
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const assignToday = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Today Due Assignment',
      description: 'Today due boundary test',
      dueDate: todayStr
    });
    const todayId = assignToday._id;

    console.log('\n--- Create Submissions for Student 1 & 2 ---');
    // Student 1 submits to futureId2, futureId3, pastId2, pastId3
    await Submission.create({
      assignment: futureId2,
      student: student1.user._id,
      classroom: classroomId,
      media: ['https://example.com/future2.pdf'],
      isGraded: false,
      marks: null
    });

    await Submission.create({
      assignment: futureId3,
      student: student1.user._id,
      classroom: classroomId,
      media: ['https://example.com/future3.pdf'],
      isGraded: true,
      marks: 0 // Explicit grade of 0
    });

    await Submission.create({
      assignment: pastId2,
      student: student1.user._id,
      classroom: classroomId,
      media: ['https://example.com/past2.pdf'],
      isGraded: false,
      marks: null
    });

    await Submission.create({
      assignment: pastId3,
      student: student1.user._id,
      classroom: classroomId,
      media: ['https://example.com/past3.pdf'],
      isGraded: true,
      marks: 10
    });

    // Student 2 submits to futureId1 (Student 1 did NOT submit to futureId1)
    await Submission.create({
      assignment: futureId1,
      student: student2.user._id,
      classroom: classroomId,
      media: ['https://example.com/student2_private.pdf'],
      isGraded: true,
      marks: 9
    });

    console.log('\n--- Verify STUDENT 1 Status Semantics ---');
    const s1ListRes = await req('GET', `/assignment/get?classroomId=${classroomId}`, null, student1.token);
    assert(s1ListRes.status === 200, 'Student 1 fetched assignments');
    const s1Assignments = s1ListRes.data.assignments;

    const s1Future1 = s1Assignments.find(a => a._id.toString() === futureId1.toString());
    const s1Future2 = s1Assignments.find(a => a._id.toString() === futureId2.toString());
    const s1Future3 = s1Assignments.find(a => a._id.toString() === futureId3.toString());
    const s1Past1 = s1Assignments.find(a => a._id.toString() === pastId1.toString());
    const s1Past2 = s1Assignments.find(a => a._id.toString() === pastId2.toString());
    const s1Past3 = s1Assignments.find(a => a._id.toString() === pastId3.toString());
    const s1Today = s1Assignments.find(a => a._id.toString() === todayId.toString());

    // 1. Future deadline + no submission -> Due
    assert(s1Future1.status === 'Due', `Future unsubmitted status is "Due" (got: ${s1Future1.status})`);

    // 2. Future deadline + submitted + ungraded -> Submitted
    assert(s1Future2.status === 'Submitted', `Future submitted ungraded status is "Submitted" (got: ${s1Future2.status})`);

    // 3. Future deadline + submitted + grade 0 -> Graded
    assert(s1Future3.status === 'Graded', `Future submitted with grade 0 status is "Graded" (got: ${s1Future3.status})`);
    assert(s1Future3.mySubmission.marks === 0, `Grade 0 correctly preserved in mySubmission (got: ${s1Future3.mySubmission.marks})`);

    // 4. Past deadline + no submission -> Missing
    assert(s1Past1.status === 'Missing', `Past unsubmitted status is "Missing" (got: ${s1Past1.status})`);

    // 5. Past deadline + submitted + ungraded -> Submitted
    assert(s1Past2.status === 'Submitted', `Past submitted ungraded status is "Submitted" (got: ${s1Past2.status})`);

    // 6. Past deadline + submitted + graded -> Graded
    assert(s1Past3.status === 'Graded', `Past submitted graded status is "Graded" (got: ${s1Past3.status})`);

    // 7. Today deadline (date-only boundary) -> Due through end of day
    assert(s1Today.status === 'Due', `Today unsubmitted status is "Due" through end of day (got: ${s1Today.status})`);

    console.log('\n--- Verify STUDENT Privacy & Data Isolation ---');
    // Student 1 must NOT see Student 2's submission for futureId1
    assert(s1Future1.submissions.length === 0, 'Student 1 receives empty submissions array for unsubmitted assignment');
    assert(s1Future1.mySubmission === null, 'Student 1 receives null mySubmission for unsubmitted assignment');
    assert(!JSON.stringify(s1Future1).includes('student2_private.pdf'), 'Student 2 private submission URL not leaked to Student 1');

    console.log('\n--- Verify TEACHER Status Semantics ---');
    const teacherListRes = await req('GET', `/assignment/get?classroomId=${classroomId}`, null, teacher.token);
    assert(teacherListRes.status === 200, 'Teacher fetched assignments');
    const tAssignments = teacherListRes.data.assignments;

    const tFuture1 = tAssignments.find(a => a._id.toString() === futureId1.toString());
    const tPast1 = tAssignments.find(a => a._id.toString() === pastId1.toString());
    const tToday = tAssignments.find(a => a._id.toString() === todayId.toString());

    // Teacher must see Active for future deadline
    assert(tFuture1.status === 'Active', `Teacher sees "Active" for future deadline (got: ${tFuture1.status})`);

    // Teacher must see Past Due for past deadline
    assert(tPast1.status === 'Past Due', `Teacher sees "Past Due" for past deadline (got: ${tPast1.status})`);

    // Teacher must see Active for today's deadline (due through end of day)
    assert(tToday.status === 'Active', `Teacher sees "Active" for today's deadline (got: ${tToday.status})`);

    // Teacher must NOT see student personal states
    const teacherStatuses = tAssignments.map(a => a.status);
    const hasStudentStates = teacherStatuses.some(s => ['Due', 'Submitted', 'Missing', 'Graded'].includes(s));
    assert(!hasStudentStates, `Teacher never receives student personal statuses (statuses: ${teacherStatuses.join(', ')})`);

    // Teacher receives all student submissions for grading
    assert(tFuture1.submissions.length === 1, 'Teacher receives Student 2 submission for futureId1');
    assert(tFuture1.totalSubmissions === 1, `Teacher receives totalSubmissions count (got: ${tFuture1.totalSubmissions})`);

    console.log('\n--- Clean up Test Data ---');
    await Submission.deleteMany({ classroom: classroomId });
    await Assignment.deleteMany({ classroom: classroomId });
    await Classroom.deleteMany({ _id: classroomId });
    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email] } });

    console.log(`\n========================================`);
    console.log(`RESULTS: ${passed} Passed, ${failed} Failed.`);
    console.log(`========================================\n`);

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();
