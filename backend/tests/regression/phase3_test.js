const mongoose = require('mongoose');
const User = require('../../models/User');

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
    await User.deleteMany({ email: { $in: ['usera@test.com', 'userb@test.com'] } });

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

    console.log('--- Setting up Users ---');
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

    console.log('\n--- 3, 4. User A creates classroom ---');
    let res = await req('POST', '/classroom/create', { name: 'Math 101', subject: 'Math', privacy: 'public' }, tokenA);
    assert(res.status === 201 && res.data.success && res.data.classroom.code, 'Classroom created and code returned');
    const classCode = res.data.classroom.code;

    console.log('\n--- 5. User A retrieves details ---');
    res = await req('GET', `/classroom/details?code=${classCode}`, null, tokenA);
    assert(res.status === 200 && res.data.classroom.teacher.email === 'usera@test.com', 'Owner can retrieve classroom details');

    console.log('\n--- 6. User B cannot access before joining ---');
    res = await req('GET', `/classroom/details?code=${classCode}`, null, tokenB);
    assert(res.status === 403, 'User B rejected from accessing class details before joining');

    console.log('\n--- 7, 8. User B joins class ---');
    res = await req('POST', '/classroom/join', { code: classCode }, tokenB);
    assert(res.status === 200, 'User B successfully joined class');
    res = await req('GET', `/classroom/details?code=${classCode}`, null, tokenB);
    assert(res.status === 200, 'User B can now access class details');

    console.log('\n--- 9. Duplicate join safely rejected ---');
    res = await req('POST', '/classroom/join', { code: classCode }, tokenB);
    assert(res.status === 400 && res.data.error.includes('already joined'), 'Duplicate join is rejected');

    console.log('\n--- 10. Invalid code rejected ---');
    res = await req('POST', '/classroom/join', { code: 'INVALID' }, tokenB);
    assert(res.status === 404, 'Invalid classroom code is rejected');

    console.log('\n--- 11. User A invites User B (Email log test) ---');
    res = await req('POST', '/classroom/invite', { email: 'userb@test.com', code: classCode }, tokenA);
    assert(res.status === 200, 'User A can send invite');

    console.log('\n--- 13. Unauthorized user cannot remove members ---');
    res = await req('POST', '/classroom/remove', { code: classCode, studentId: userB._id.toString() }, tokenB);
    assert(res.status === 403, 'User B cannot remove themselves or others');

    console.log('\n--- 14. Owner removes User B ---');
    res = await req('POST', '/classroom/remove', { code: classCode, studentId: userB._id.toString() }, tokenA);
    assert(res.status === 200, 'Owner successfully removed User B');

    console.log('\n--- 15. Removed member loses access ---');
    res = await req('GET', `/classroom/details?code=${classCode}`, null, tokenB);
    assert(res.status === 403, 'Removed member cannot access classroom details anymore');

    console.log('\n--- 16. Non-owner cannot delete ---');
    // User B joins again for this test
    await req('POST', '/classroom/join', { code: classCode }, tokenB);
    res = await req('POST', '/classroom/delete', { code: classCode }, tokenB);
    assert(res.status === 403, 'Non-owner cannot delete classroom');

    console.log('\n--- 17, 18. Owner can delete ---');
    res = await req('POST', '/classroom/delete', { code: classCode }, tokenA);
    assert(res.status === 200, 'Owner successfully deleted classroom');
    res = await req('GET', `/classroom/details?code=${classCode}`, null, tokenA);
    assert(res.status === 404, 'Deleted classroom cannot be accessed');

    console.log('\n--- 19. Invalid/Malformed ID safety ---');
    res = await req('POST', '/classroom/remove', { code: '1234', studentId: '1234' }, tokenA);
    assert(res.status === 404 || res.status === 400, 'Invalid IDs handle safely');

    console.log('\n--- 20. Attendance endpoint ---');
    // recreate class
    res = await req('POST', '/classroom/create', { name: 'Att Class', subject: 'Math', privacy: 'public' }, tokenA);
    const code2 = res.data.classroom.code;
    
    // unauthenticated request
    res = await req('GET', `/classroom/attendance?classCode=${code2}`);
    assert(res.status === 401, 'Unauthenticated attendance request is rejected');
    
    // valid request
    res = await req('GET', `/classroom/attendance?classCode=${code2}`, null, tokenA);
    assert(res.status === 200 && res.data.isTeacher === true && Array.isArray(res.data.lectureData), 'Valid attendance request returns correct safe stub structure');

    // cleanup
    await req('POST', '/classroom/delete', { code: code2 }, tokenA);

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
  } catch (err) {
    console.error('SCRIPT ERROR:', err);
  } finally {
    await mongoose.connection.close();
  }
}

runTest();
