const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');

const BASE_URL = 'http://localhost:5000/api';

const fetchData = async (method, path, body = null, token = null) => {
  const options = { method, headers: {} };
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  
  if (body) {
    if (body instanceof FormData) {
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
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
    console.log('--- Setting up Users & Environment ---');
    const u1 = `user7_1_${Date.now()}@test.com`;
    const u2 = `user7_2_${Date.now()}@test.com`;
    
    await fetchData('POST', '/auth/register', { name: 'User 1', email: u1, password: 'Password@123' });
    const user1 = await User.findOne({ email: u1 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: u1, otp: user1.otp.code });
    const t1 = (await fetchData('POST', '/auth/login', { email: u1, password: 'Password@123' })).data.token;

    await fetchData('POST', '/auth/register', { name: 'User 2', email: u2, password: 'Password@123' });
    const user2 = await User.findOne({ email: u2 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: u2, otp: user2.otp.code });
    const t2 = (await fetchData('POST', '/auth/login', { email: u2, password: 'Password@123' })).data.token;

    let classCode = (await fetchData('POST', '/classroom/create', { name: 'Announcements Class', subject: 'P7', privacy: 'public' }, t1)).data.classroom.code;
    await fetchData('POST', '/classroom/join', { code: classCode }, t2);

    console.log('\n--- Announcement Tests ---');
    let announcementId = null;
    
    await test('Create Announcement without required fields fails', async () => {
      const form = new FormData();
      form.append('code', classCode);
      const res = await fetchData('POST', '/announcement/create', form, t1);
      assert.strictEqual(res.status, 400);
    });

    await test('Student (User 2) cannot create announcement', async () => {
      const form = new FormData();
      form.append('title', 'Hacked');
      form.append('description', 'Student creating announcement');
      form.append('code', classCode);
      const res = await fetchData('POST', '/announcement/create', form, t2);
      assert.strictEqual(res.status, 403);
    });

    await test('Teacher (User 1) can create announcement', async () => {
      const form = new FormData();
      form.append('title', 'Welcome');
      form.append('description', 'Welcome to the class!');
      form.append('code', classCode);
      const res = await fetchData('POST', '/announcement/create', form, t1);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.announcement.title, 'Welcome');
      announcementId = res.data.announcement._id;
    });

    await test('Classroom details returns announcements sorted by date', async () => {
      const res = await fetchData('GET', `/classroom/details?code=${classCode}`, null, t1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.classroom.announcements.length, 1);
      assert.strictEqual(res.data.classroom.announcements[0].title, 'Welcome');
    });

    await test('Teacher can edit announcement', async () => {
      const form = new FormData();
      form.append('title', 'Welcome (Edited)');
      form.append('description', 'Welcome to the class! Updated.');
      form.append('code', classCode);
      const res = await fetchData('PUT', `/announcement/edit/${announcementId}`, form, t1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.announcement.title, 'Welcome (Edited)');
    });

    await test('Student cannot edit announcement', async () => {
      const form = new FormData();
      form.append('title', 'Hacked');
      form.append('description', 'Updated by student');
      form.append('code', classCode);
      const res = await fetchData('PUT', `/announcement/edit/${announcementId}`, form, t2);
      assert.strictEqual(res.status, 403);
    });

    await test('Student cannot delete announcement', async () => {
      const res = await fetchData('DELETE', `/announcement/delete/${announcementId}`, { code: classCode }, t2);
      assert.strictEqual(res.status, 403);
    });

    await test('Teacher can delete announcement', async () => {
      const res = await fetchData('DELETE', `/announcement/delete/${announcementId}`, { code: classCode }, t1);
      assert.strictEqual(res.status, 200);
      
      const classRes = await fetchData('GET', `/classroom/details?code=${classCode}`, null, t1);
      assert.strictEqual(classRes.data.classroom.announcements.length, 0);
    });

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error('Fatal Test Error:', e);
    process.exit(1);
  }
};

runTests();
