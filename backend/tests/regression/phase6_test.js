const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');

const BASE_URL = 'http://localhost:5000/api';

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
    const u1 = `user6_1_${Date.now()}@test.com`;
    const u2 = `user6_2_${Date.now()}@test.com`;
    
    await fetchData('POST', '/auth/register', { name: 'User 1', email: u1, password: 'Password@123' });
    const user1 = await User.findOne({ email: u1 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: u1, otp: user1.otp.code });
    const t1 = (await fetchData('POST', '/auth/login', { email: u1, password: 'Password@123' })).data.token;

    await fetchData('POST', '/auth/register', { name: 'User 2', email: u2, password: 'Password@123' });
    const user2 = await User.findOne({ email: u2 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: u2, otp: user2.otp.code });
    const t2 = (await fetchData('POST', '/auth/login', { email: u2, password: 'Password@123' })).data.token;

    console.log('\n--- Todo Tests ---');
    let todoId = null;
    
    await test('Create Todo (User 1)', async () => {
      const res = await fetchData('POST', '/todo/create', { title: 'Test Todo', description: 'Desc' }, t1);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.todo.title, 'Test Todo');
      todoId = res.data.todo._id;
    });

    await test('Create Todo without title fails', async () => {
      const res = await fetchData('POST', '/todo/create', { description: 'Desc' }, t1);
      assert.strictEqual(res.status, 400);
    });

    await test('List Todos (User 1)', async () => {
      const res = await fetchData('GET', '/todo', null, t1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.todos.length, 1);
    });

    await test('List Todos (User 2 is isolated)', async () => {
      const res = await fetchData('GET', '/todo', null, t2);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.todos.length, 0);
    });

    await test('Update Todo (User 1)', async () => {
      const res = await fetchData('PUT', `/todo/update/${todoId}`, { isCompleted: true }, t1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.todo.isCompleted, true);
    });

    await test('User 2 cannot update User 1 Todo', async () => {
      const res = await fetchData('PUT', `/todo/update/${todoId}`, { title: 'Hacked' }, t2);
      assert.strictEqual(res.status, 404);
    });

    await test('User 2 cannot delete User 1 Todo', async () => {
      const res = await fetchData('POST', `/todo/delete/${todoId}`, null, t2);
      assert.strictEqual(res.status, 404);
    });

    await test('Delete Todo (User 1)', async () => {
      const res = await fetchData('POST', `/todo/delete/${todoId}`, null, t1);
      assert.strictEqual(res.status, 200);
      const list = await fetchData('GET', '/todo', null, t1);
      assert.strictEqual(list.data.todos.length, 0);
    });

    console.log('\n--- Reminder Tests ---');
    // Need a lecture to set a reminder on
    let classCode = (await fetchData('POST', '/classroom/create', { name: 'Reminder Class', subject: 'P6', privacy: 'public' }, t1)).data.classroom.code;
    let lectureId = (await fetchData('POST', '/lecture/create', { title: 'Lecture 1', description: 'Desc', date: '2026-10-10', time: '10:00', code: classCode }, t1)).data.lecture._id;

    let reminderId = null;
    const testTime = new Date().toISOString();

    await test('Create Reminder for valid lecture (User 1)', async () => {
      const res = await fetchData('POST', '/reminder', { lectureId, scheduledTime: testTime }, t1);
      assert.strictEqual(res.status, 201);
      reminderId = res.data.reminder._id;
    });

    await test('User 2 cannot create reminder for inaccessible lecture', async () => {
      const res = await fetchData('POST', '/reminder', { lectureId, scheduledTime: testTime }, t2);
      assert.strictEqual(res.status, 403);
    });

    // Let user 2 join and set reminder
    await fetchData('POST', '/classroom/join', { code: classCode }, t2);
    
    await test('User 2 can create reminder after joining class', async () => {
      const res = await fetchData('POST', '/reminder', { lectureId, scheduledTime: testTime }, t2);
      assert.strictEqual(res.status, 201);
    });

    await test('List Reminders populates lecture (User 1)', async () => {
      const res = await fetchData('GET', '/reminder', null, t1);
      assert.strictEqual(res.status, 200);
      assert(res.data.reminders.length >= 1);
      assert.strictEqual(res.data.reminders[0].lecture.title, 'Lecture 1');
    });

    await test('Update Reminder (User 1)', async () => {
      const newTime = new Date(Date.now() + 86400000).toISOString();
      const res = await fetchData('PUT', `/reminder/${reminderId}`, { scheduledTime: newTime }, t1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.time, newTime);
    });

    await test('User 2 cannot delete User 1 reminder', async () => {
      const res = await fetchData('DELETE', `/reminder/${reminderId}`, null, t2);
      assert.strictEqual(res.status, 404);
    });

    await test('Delete Reminder (User 1)', async () => {
      const res = await fetchData('DELETE', `/reminder/${reminderId}`, null, t1);
      assert.strictEqual(res.status, 200);
    });

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
    process.exit(failed === 0 ? 0 : 1);
  } catch (e) {
    console.error('Fatal Test Error:', e);
    process.exit(1);
  }
};

runTests();
