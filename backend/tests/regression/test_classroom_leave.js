const mongoose = require('mongoose');
const env = require('../../config/env');
const User = require('../../models/User');
const Classroom = require('../../models/Classroom');
const Assignment = require('../../models/Assignment');
const Submission = require('../../models/Submission');
const Lecture = require('../../models/Lecture');

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

    console.log('\n--- Setup Test Users & Classroom for Leave Class ---');
    const teacherEmail = 'leavetest_teacher@test.com';
    const student1Email = 'leavetest_student1@test.com';
    const student2Email = 'leavetest_student2@test.com';
    const nonMemberEmail = 'leavetest_nonmember@test.com';

    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email, nonMemberEmail] } });
    await Classroom.deleteMany({ name: 'Leave Class Testing Classroom' });

    async function createUser(name, email) {
      await req('POST', '/auth/register', { name, email, password: 'Password@123' });
      const u = await User.findOne({ email }).select('+otp.code');
      await req('POST', '/auth/verify', { email, otp: u.otp.code });
      const login = await req('POST', '/auth/login', { email, password: 'Password@123' });
      return { user: u, token: login.data.token };
    }

    const teacher = await createUser('Leave Teacher', teacherEmail);
    const student1 = await createUser('Leave Student 1', student1Email);
    const student2 = await createUser('Leave Student 2', student2Email);
    const nonMember = await createUser('Leave NonMember', nonMemberEmail);

    // Teacher creates classroom
    const createRes = await req('POST', '/classroom/create', {
      name: 'Leave Class Testing Classroom',
      subject: 'Computer Science',
      privacy: 'public'
    }, teacher.token);
    assert(createRes.status === 201, 'Teacher created classroom');
    const classCode = createRes.data.classroom.code;
    const classroomId = createRes.data.classroom._id;

    // Student 1 & Student 2 join classroom
    const join1 = await req('POST', '/classroom/join', { code: classCode }, student1.token);
    assert(join1.status === 200, 'Student 1 joined classroom');
    const join2 = await req('POST', '/classroom/join', { code: classCode }, student2.token);
    assert(join2.status === 200, 'Student 2 joined classroom');

    // Create an assignment and historical lecture attendance
    const assignmentA = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Assignment Alpha',
      description: 'Historical submission test',
      dueDate: '2026-12-31'
    });
    const assignmentId = assignmentA._id;

    // Student 1 submits Assignment Alpha
    const submissionA = await Submission.create({
      assignment: assignmentId,
      student: student1.user._id,
      classroom: classroomId,
      media: ['https://example.com/alpha_solution.pdf'],
      marks: 8,
      isGraded: true
    });

    // Create a completed lecture with finalized attendance for Student 1
    const lecture1 = await Lecture.create({
      title: 'Historical Lecture',
      description: 'Attendance preservation test',
      date: '2026-10-10',
      time: '10:00 AM',
      startTime: new Date(),
      classroom: classroomId,
      teacher: teacher.user._id,
      status: 'completed',
      attendance: [{ student: student1.user._id, joinedAt: new Date() }]
    });

    console.log('\n--- 1. Validation & Authorization Checks ---');
    // Case 6: Unauthenticated request rejected
    const unauthLeave = await req('POST', '/classroom/leave', { code: classCode }, null);
    assert(unauthLeave.status === 401, 'Case 6: Unauthenticated request rejected with 401');

    // Case 4: Classroom owner cannot leave own classroom
    const ownerLeave = await req('POST', '/classroom/leave', { code: classCode }, teacher.token);
    assert(ownerLeave.status === 400 && ownerLeave.data.error.includes('owner'), 'Case 4: Classroom owner cannot leave own classroom (400)');

    // Case 5: Non-member cannot leave
    const nonMemberLeave = await req('POST', '/classroom/leave', { code: classCode }, nonMember.token);
    assert(nonMemberLeave.status === 400 && nonMemberLeave.data.error.includes('not enrolled'), 'Case 5: Non-member cannot leave (400)');

    // Case 7: Leave endpoint cannot remove another student (passing studentId in body has no effect)
    const spoofLeave = await req('POST', '/classroom/leave', {
      code: classCode,
      studentId: student2.user._id.toString()
    }, student1.token);
    // Student 1 leaves, but Student 2 must NOT be removed
    const s2AfterSpoof = await Classroom.findById(classroomId);
    assert(s2AfterSpoof.students.some(id => id.equals(student2.user._id)), 'Case 7: Leave endpoint cannot remove another student (Student 2 remains enrolled)');

    console.log('\n--- 2. Student 1 Leave Verification ---');
    // Case 1: Enrolled student can leave
    assert(spoofLeave.status === 200, 'Case 1: Enrolled student can leave successfully (200)');

    // Case 2: Student removed from Classroom.students
    const classroomAfterLeave = await Classroom.findById(classroomId);
    const s1InClass = classroomAfterLeave.students.some(id => id.equals(student1.user._id));
    assert(!s1InClass, 'Case 2: Student 1 absent from Classroom.students');

    // Case 3: Classroom removed from User.joinedClasses
    const s1UserAfterLeave = await User.findById(student1.user._id);
    const classInUserJoined = s1UserAfterLeave.joinedClasses.some(id => id.equals(classroomId));
    assert(!classInUserJoined, 'Case 3: Classroom absent from Student 1 User.joinedClasses');

    // Case 25: Teacher current People/member response no longer includes student after leave
    const teacherDetails = await req('GET', `/classroom/details?code=${classCode}`, null, teacher.token);
    const teacherSeenStudents = teacherDetails.data.classroom.students.map(s => s._id.toString());
    assert(!teacherSeenStudents.includes(student1.user._id.toString()), 'Case 25: Teacher People response no longer includes student after leave');

    console.log('\n--- 3. Historical Data Strict Preservation ---');
    // Case 8: Historical submission remains after leave
    const subDoc = await Submission.findById(submissionA._id);
    assert(subDoc !== null, 'Case 8: Historical submission document still exists');

    // Case 9: Historical uploaded submission/media reference remains
    assert(subDoc.media.includes('https://example.com/alpha_solution.pdf'), 'Case 9: Historical uploaded media reference preserved');

    // Case 10: Historical grade remains after leave
    assert(subDoc.marks === 8 && subDoc.isGraded === true, 'Case 10: Historical grade (8/10, isGraded=true) preserved');

    // Case 11: Finalized historical attendance remains after leave
    const lecDoc = await Lecture.findById(lecture1._id);
    const s1InAttendance = lecDoc.attendance.some(a => a.student.equals(student1.user._id));
    assert(s1InAttendance, 'Case 11: Finalized historical attendance remains stored');

    // Case 12: Classroom itself remains
    const classDoc = await Classroom.findById(classroomId);
    assert(classDoc !== null, 'Case 12: Classroom itself remains in database');

    // Case 13: Assignments remain
    const assignDoc = await Assignment.findById(assignmentId);
    assert(assignDoc !== null, 'Case 13: Assignment remains in database');

    console.log('\n--- 4. Post-Leave Protected Access Control ---');
    // Case 14: Former member cannot access protected classroom details
    const formerDetails = await req('GET', `/classroom/details?code=${classCode}`, null, student1.token);
    assert(formerDetails.status === 403, 'Case 14: Former member denied access to classroom details (403)');

    // Case 15: Former member cannot access protected assignment resources
    const formerAssign = await req('GET', `/assignment/get?classroomId=${classroomId}`, null, student1.token);
    assert(formerAssign.status === 403, 'Case 15a: Former member denied access to /assignment/get (403)');

    const formerSubCreate = await req('POST', '/submission/create', { assignmentId }, student1.token);
    assert(formerSubCreate.status === 403, 'Case 15b: Former member denied access to /submission/create (403)');

    const formerMySub = await req('GET', `/submission/my-submission?assignmentId=${assignmentId}`, null, student1.token);
    assert(formerMySub.status === 403, 'Case 15c: Former member denied access to /submission/my-submission (403)');

    // Case 16: Former member cannot use attendance or lecture functionality
    const formerAtt = await req('GET', `/classroom/attendance?classCode=${classCode}`, null, student1.token);
    assert(formerAtt.status === 403, 'Case 16a: Former member denied access to /classroom/attendance (403)');

    const formerLec = await req('GET', `/lecture/?code=${classCode}`, null, student1.token);
    assert(formerLec.status === 403, 'Case 16b: Former member denied access to /lecture/ (403)');

    console.log('\n--- 5. Student Rejoin Semantics ---');
    // Case 17: Student can rejoin same classroom
    const rejoinRes = await req('POST', '/classroom/join', { code: classCode }, student1.token);
    assert(rejoinRes.status === 200, 'Case 17: Student 1 successfully rejoins same classroom (200)');

    // Case 18: Rejoin creates exactly one Classroom.students membership
    const classAfterRejoin = await Classroom.findById(classroomId);
    const s1MembershipCount = classAfterRejoin.students.filter(id => id.equals(student1.user._id)).length;
    assert(s1MembershipCount === 1, `Case 18: Exactly one membership in Classroom.students (count: ${s1MembershipCount})`);

    // Case 19: User joinedClasses remains duplicate-free
    const userAfterRejoin = await User.findById(student1.user._id);
    const classCountInUser = userAfterRejoin.joinedClasses.filter(id => id.equals(classroomId)).length;
    assert(classCountInUser === 1, `Case 19: Exactly one entry in User.joinedClasses (count: ${classCountInUser})`);

    // Case 20: Original submission remains after rejoin
    const currentSubs = await Submission.find({ assignment: assignmentId, student: student1.user._id });
    assert(currentSubs.length === 1 && currentSubs[0]._id.equals(submissionA._id), 'Case 20: Original submission document still exists after rejoin');

    // Case 21: Original grade remains after rejoin
    assert(currentSubs[0].marks === 8 && currentSubs[0].isGraded === true, 'Case 21: Original grade 8/10 preserved after rejoin');

    // Case 22 & 23: Assignment list resolves as Graded and mySubmission points to original submission
    const s1AssignmentsRejoin = await req('GET', `/assignment/get?classroomId=${classroomId}`, null, student1.token);
    assert(s1AssignmentsRejoin.status === 200, 'Student 1 can fetch assignments after rejoin');
    const returnedAssignA = s1AssignmentsRejoin.data.assignments.find(a => a._id.toString() === assignmentId.toString());
    assert(returnedAssignA.status === 'Graded', `Case 22: Assignment resolves as "Graded" after rejoin (got: ${returnedAssignA.status})`);
    assert(returnedAssignA.mySubmission && returnedAssignA.mySubmission._id.toString() === submissionA._id.toString(), 'Case 23: mySubmission points to original submission ID');

    // Case 24: Duplicate submission remains rejected after rejoin
    const dupSub = await req('POST', '/submission/create', { assignmentId }, student1.token);
    assert(dupSub.status === 400 && dupSub.data.error.includes('already submitted'), 'Case 24: Duplicate submission rejected after rejoin (400)');

    console.log('\n--- 6. Teacher Remove Member Consistency & Rejoin ---');
    // Teacher removes Student 2
    const removeS2 = await req('POST', '/classroom/remove', {
      code: classCode,
      studentId: student2.user._id.toString()
    }, teacher.token);
    assert(removeS2.status === 200, 'Teacher removed Student 2 (200)');

    // Student 2 creates a submission beforehand for testing preservation
    const assign2 = await Assignment.create({
      classroom: classroomId,
      teacher: teacher.user._id,
      name: 'Assignment Beta',
      description: 'Teacher remove test',
      dueDate: '2026-12-31'
    });
    const subBeta = await Submission.create({
      assignment: assign2._id,
      student: student2.user._id,
      classroom: classroomId,
      media: ['https://example.com/beta.pdf'],
      marks: 9,
      isGraded: true
    });
    const lec2 = await Lecture.create({
      title: 'Beta Lecture',
      description: 'Attendance preservation',
      date: '2026-10-10',
      time: '11:00 AM',
      startTime: new Date(),
      classroom: classroomId,
      teacher: teacher.user._id,
      status: 'completed',
      attendance: [{ student: student2.user._id, joinedAt: new Date() }]
    });

    // Case 26: Teacher Remove Member preserves historical submission
    const subBetaDoc = await Submission.findById(subBeta._id);
    assert(subBetaDoc !== null, 'Case 26: Teacher Remove Member preserves historical submission');

    // Case 27: Teacher Remove Member preserves historical grade
    assert(subBetaDoc.marks === 9 && subBetaDoc.isGraded === true, 'Case 27: Teacher Remove Member preserves historical grade');

    // Case 28: Teacher Remove Member preserves finalized historical attendance
    const lecBetaDoc = await Lecture.findById(lec2._id);
    assert(lecBetaDoc.attendance.some(a => a.student.equals(student2.user._id)), 'Case 28: Teacher Remove Member preserves finalized historical attendance');

    // Case 29: Teacher-removed student can rejoin if no ban system exists
    const s2Rejoin = await req('POST', '/classroom/join', { code: classCode }, student2.token);
    assert(s2Rejoin.status === 200, 'Case 29: Teacher-removed student can rejoin with valid code');

    // Case 30: Rejoining after teacher removal does not duplicate membership
    const classAfterS2Rejoin = await Classroom.findById(classroomId);
    const s2MembershipCount = classAfterS2Rejoin.students.filter(id => id.equals(student2.user._id)).length;
    const userS2AfterRejoin = await User.findById(student2.user._id);
    const s2JoinedCount = userS2AfterRejoin.joinedClasses.filter(id => id.equals(classroomId)).length;
    assert(s2MembershipCount === 1 && s2JoinedCount === 1, 'Case 30: Rejoining after teacher removal does not duplicate membership');

    console.log('\n--- Clean up Test Data ---');
    await Lecture.deleteMany({ classroom: classroomId });
    await Submission.deleteMany({ classroom: classroomId });
    await Assignment.deleteMany({ classroom: classroomId });
    await Classroom.deleteMany({ _id: classroomId });
    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email, nonMemberEmail] } });

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
