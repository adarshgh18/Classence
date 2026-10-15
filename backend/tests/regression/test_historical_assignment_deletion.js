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

    console.log('\n--- Setup Test Users & Classroom for Historical Assignment Deletion ---');
    const teacherEmail = 'hist_teacher@test.com';
    const student1Email = 'hist_student1@test.com';
    const student2Email = 'hist_student2@test.com';

    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email] } });
    await Classroom.deleteMany({ name: 'Historical Classroom Test' });

    async function createUser(name, email) {
      await req('POST', '/auth/register', { name, email, password: 'Password@123' });
      const u = await User.findOne({ email }).select('+otp.code');
      await req('POST', '/auth/verify', { email, otp: u.otp.code });
      const login = await req('POST', '/auth/login', { email, password: 'Password@123' });
      return { user: u, token: login.data.token };
    }

    const teacher = await createUser('Hist Teacher', teacherEmail);
    const student1 = await createUser('Hist Student 1', student1Email);
    const student2 = await createUser('Hist Student 2', student2Email);

    // 1. Teacher creates classroom
    const createClassRes = await req('POST', '/classroom/create', {
      name: 'Historical Classroom Test',
      subject: 'History of Computing',
      privacy: 'public'
    }, teacher.token);
    const classroom = createClassRes.data.classroom;
    const classCode = classroom.code;

    // Students join
    await req('POST', '/classroom/join', { code: classCode }, student1.token);
    await req('POST', '/classroom/join', { code: classCode }, student2.token);

    // Teacher creates assignment
    const assignDoc = await Assignment.create({
      name: 'Pioneers of Computing Paper',
      description: 'Write a paper on Ada Lovelace.',
      dueDate: '2026-11-01',
      classroom: classroom._id,
      teacher: teacher.user._id,
      media: ['https://example.com/assignment_brief.pdf']
    });

    // 1. Student 1 submits assignment with attachment
    const sub1 = await Submission.create({
      assignment: assignDoc._id,
      student: student1.user._id,
      classroom: classroom._id,
      media: ['https://example.com/student1_paper.pdf'],
      filesMetadata: [{ publicId: 's1_file_123', resourceType: 'raw' }]
    });

    // Student 2 submits assignment with attachment
    const sub2 = await Submission.create({
      assignment: assignDoc._id,
      student: student2.user._id,
      classroom: classroom._id,
      media: ['https://example.com/student2_private_paper.pdf'],
      filesMetadata: [{ publicId: 's2_file_456', resourceType: 'raw' }]
    });

    // 2. Teacher grades submission 1 (e.g. 8/10) and submission 2 (e.g. 10/10)
    await req('POST', '/submission/grade', {
      submissionId: sub1._id.toString(),
      marks: 8
    }, teacher.token);

    await req('POST', '/submission/grade', {
      submissionId: sub2._id.toString(),
      marks: 10
    }, teacher.token);

    // 3. Verify grades exist before deletion
    const sub1Check = await Submission.findById(sub1._id);
    assert(sub1Check.isGraded === true && sub1Check.marks === 8, 'Grade 8 exists for Student 1 before deletion');

    // 4. Teacher deletes classroom
    console.log('\n--- 4. Teacher Deletes Classroom ---');
    const delRes = await req('POST', '/classroom/delete', { code: classCode }, teacher.token);
    assert(delRes.status === 200, 'Teacher successfully deleted classroom');

    // 5 & 6 & 7 & 8. Historical data in database
    const classInDb = await Classroom.findOne({ code: classCode });
    assert(classInDb === null, 'Classroom document was deleted from database');

    const sub1AfterDelete = await Submission.findById(sub1._id);
    assert(sub1AfterDelete !== null, 'Student 1 historical submission document remains');
    assert(sub1AfterDelete.isGraded === true && sub1AfterDelete.marks === 8, 'Historical grade 8/10 remains');
    assert(sub1AfterDelete.media.includes('https://example.com/student1_paper.pdf'), 'Student 1 submission attachment reference is preserved');

    // 9. Student 1 accesses their own historical grade & attachment through GET /user/assignment
    const s1AssignRes = await req('GET', '/user/assignment', null, student1.token);
    assert(s1AssignRes.status === 200, 'Student 1 can fetch global assignments dashboard after class deletion');

    const s1Recent = s1AssignRes.data.user.recentGradesDetails;
    assert(s1Recent.length >= 1, 'Historical Recent Grade appears in recentGradesDetails');

    const s1GradedItem = s1Recent.find(g => g.assignmentId.toString() === assignDoc._id.toString());
    assert(Boolean(s1GradedItem), 'Historical assignment is found in recentGradesDetails');
    assert(s1GradedItem.marks === 8, 'Historical marks are 8/10');
    assert(s1GradedItem.assignment.isHistorical === true, 'Assignment payload is marked isHistorical: true');
    assert(s1GradedItem.assignment.mySubmission !== null, 'mySubmission is provided in historical payload');
    assert(s1GradedItem.assignment.mySubmission.media.includes('https://example.com/student1_paper.pdf'), 'Student 1 historical attachment URL is present in mySubmission.media');

    // 10. Security: Student 1 CANNOT see Student 2 submission or attachment
    assert(!JSON.stringify(s1AssignRes.data).includes('student2_private_paper.pdf'), 'Student 1 cannot see Student 2 private attachment URL');

    // 11. Deleted classroom does not return to joinedClasses
    const s1User = await User.findById(student1.user._id);
    assert(!s1User.joinedClasses.some(id => id.equals(classroom._id)), 'Deleted classroom is NOT in Student 1 joinedClasses');

    // 12. Deleted classroom cannot be rejoined
    const rejoinRes = await req('POST', '/classroom/join', { code: classCode }, student1.token);
    assert(rejoinRes.status === 404, 'Deleted classroom cannot be rejoined (404)');

    // 13. Historical assignment detail does not grant active classroom membership
    const s1DetailsRes = await req('GET', `/classroom/details?code=${classCode}`, null, student1.token);
    assert(s1DetailsRes.status === 404, 'Cannot access details of deleted classroom (404)');

    // Cleanup
    await User.deleteMany({ email: { $in: [teacherEmail, student1Email, student2Email] } });
    await Assignment.findByIdAndDelete(assignDoc._id);
    await Submission.deleteMany({ _id: { $in: [sub1._id, sub2._id] } });

    console.log(`\n========================================`);
    console.log(`HISTORICAL ASSIGNMENT DELETION TESTS: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================`);

    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();
