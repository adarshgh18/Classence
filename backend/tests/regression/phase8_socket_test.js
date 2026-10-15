const { io: Client } = require('../../../frontend/node_modules/socket.io-client');
const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');
const AssignmentChat = require('../../models/AssignmentChat');
const DevChat = require('../../models/DevChat');

const BASE_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

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
    console.log('--- Setting up Users & Environment for Socket Tests ---');

    const uTeacher = `t_sock_${Date.now()}@test.com`;
    const uStudent1 = `s1_sock_${Date.now()}@test.com`;
    const uStudent2 = `s2_sock_${Date.now()}@test.com`;
    const uOutsider = `out_sock_${Date.now()}@test.com`;

    // 1. Create Teacher
    await fetchData('POST', '/auth/register', { name: 'Teacher', email: uTeacher, password: 'Password@123' });
    const userT = await User.findOne({ email: uTeacher }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uTeacher, otp: userT.otp.code });
    const tTeacher = (await fetchData('POST', '/auth/login', { email: uTeacher, password: 'Password@123' })).data.token;

    // 2. Create Student 1
    await fetchData('POST', '/auth/register', { name: 'Student 1', email: uStudent1, password: 'Password@123' });
    const userS1 = await User.findOne({ email: uStudent1 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uStudent1, otp: userS1.otp.code });
    const tStudent1 = (await fetchData('POST', '/auth/login', { email: uStudent1, password: 'Password@123' })).data.token;

    // 3. Create Student 2
    await fetchData('POST', '/auth/register', { name: 'Student 2', email: uStudent2, password: 'Password@123' });
    const userS2 = await User.findOne({ email: uStudent2 }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uStudent2, otp: userS2.otp.code });
    const tStudent2 = (await fetchData('POST', '/auth/login', { email: uStudent2, password: 'Password@123' })).data.token;

    // 4. Create Outsider
    await fetchData('POST', '/auth/register', { name: 'Outsider', email: uOutsider, password: 'Password@123' });
    const userOut = await User.findOne({ email: uOutsider }).select('+otp.code');
    await fetchData('POST', '/auth/verify', { email: uOutsider, otp: userOut.otp.code });
    const tOutsider = (await fetchData('POST', '/auth/login', { email: uOutsider, password: 'Password@123' })).data.token;

    // Classroom & Assignment
    const classCode = (await fetchData('POST', '/classroom/create', { name: 'Socket Math', subject: 'Math', privacy: 'public' }, tTeacher)).data.classroom.code;
    await fetchData('POST', '/classroom/join', { code: classCode }, tStudent1);
    await fetchData('POST', '/classroom/join', { code: classCode }, tStudent2);

    const form = new FormData();
    form.append('name', 'Socket Assignment');
    form.append('code', classCode);
    form.append('dueDate', '2026-11-01');
    form.append('instructions', 'Solve problems');
    form.append('totalMarks', 10);
    const assignRes = await fetchData('POST', '/assignment/create', form, tTeacher);
    const assignmentId = assignRes.data.assignment._id;

    console.log('\n--- 1. Authentication Tests ---');

    await test('Unauthenticated socket rejected', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, {
          reconnection: false,
          timeout: 2000
        });
        client.on('connect_error', (err) => {
          assert(err.message.includes('Authentication required') || err.message.includes('Missing token'));
          client.close();
          resolve();
        });
        client.on('connect', () => {
          client.close();
          reject(new Error('Unauthenticated client connected successfully!'));
        });
      });
    });

    await test('Authenticated socket connection succeeds', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, {
          query: { token: tStudent1 },
          reconnection: false
        });
        client.on('connect', () => {
          client.close();
          resolve();
        });
        client.on('connect_error', (err) => {
          client.close();
          reject(err);
        });
      });
    });

    console.log('\n--- 2. Assignment Chat Authorization Tests ---');

    await test('Outsider denied from joining assignment chat room', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, {
          query: { token: tOutsider },
          reconnection: false
        });
        client.on('connect', () => {
          client.emit('joinAssignmentChat', {
            studentId: userOut._id.toString(),
            assignmentId
          });
        });
        client.on('error', (errMsg) => {
          assert(errMsg.includes('Unauthorized'));
          client.close();
          resolve();
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Did not receive unauthorized error'));
        }, 2000);
      });
    });

    await test('Enrolled student can join assignment chat and receive chatHistory', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, {
          query: { token: tStudent1 },
          reconnection: false
        });
        client.on('connect', () => {
          client.emit('joinAssignmentChat', {
            studentId: userS1._id.toString(),
            assignmentId
          });
        });
        client.on('chatHistory', (history) => {
          assert(Array.isArray(history));
          assert(Array.isArray(history[0].messages));
          client.close();
          resolve();
        });
        client.on('error', (err) => {
          client.close();
          reject(new Error(err));
        });
      });
    });

    console.log('\n--- 3. Message Delivery, Isolation, and File Attachment Tests ---');

    await test('Message delivered to participant in same room, not to other students', async () => {
      // Connect Student 1, Student 2, and Teacher
      const clientS1 = Client(SOCKET_URL, { query: { token: tStudent1 }, reconnection: false });
      const clientS2 = Client(SOCKET_URL, { query: { token: tStudent2 }, reconnection: false });
      const clientT = Client(SOCKET_URL, { query: { token: tTeacher }, reconnection: false });

      await new Promise((resolve) => {
        let connectedCount = 0;
        const check = () => {
          connectedCount++;
          if (connectedCount === 3) resolve();
        };
        clientS1.on('connect', check);
        clientS2.on('connect', check);
        clientT.on('connect', check);
      });

      // Join rooms
      // S1 joins thread for S1
      clientS1.emit('joinAssignmentChat', { studentId: userS1._id.toString(), assignmentId });
      // Teacher joins thread for S1
      clientT.emit('joinAssignmentChat', { studentId: userS1._id.toString(), assignmentId });
      // S2 joins thread for S2
      clientS2.emit('joinAssignmentChat', { studentId: userS2._id.toString(), assignmentId });

      await new Promise((r) => setTimeout(r, 300));

      let s1Received = false;
      let teacherReceived = false;
      let s2Received = false;

      clientS1.on('chatUpdate', (chat) => {
        if (chat.message === 'Hello Teacher!') s1Received = true;
      });

      clientT.on('chatUpdate', (chat) => {
        if (chat.message === 'Hello Teacher!') teacherReceived = true;
      });

      clientS2.on('chatUpdate', (chat) => {
        if (chat.message === 'Hello Teacher!') s2Received = true;
      });

      // Student 1 sends message with a mock buffer attachment
      const dummyBuffer = Array.from(Buffer.from('hello attachment'));
      clientS1.emit('assignmentChatMessage', {
        message: 'Hello Teacher!',
        assignmentId,
        studentId: userS1._id.toString(),
        file: {
          buffer: dummyBuffer,
          name: 'notes.txt',
          type: 'text/plain',
          size: dummyBuffer.length
        }
      });

      // Wait for broadcast (up to 7000ms for Cloudinary upload)
      const startTime = Date.now();
      while ((!s1Received || !teacherReceived) && Date.now() - startTime < 7000) {
        await new Promise((r) => setTimeout(r, 200));
      }

      clientS1.close();
      clientS2.close();
      clientT.close();

      assert(s1Received, 'Sender (S1) should receive broadcast');
      assert(teacherReceived, 'Teacher in room should receive message');
      assert(!s2Received, 'Student 2 in different room should NOT receive S1 message');
    });

    console.log('\n--- 4. Persistence and Validation Tests ---');

    await test('Message and attachment are persisted in MongoDB AssignmentChat', async () => {
      const chatDoc = await AssignmentChat.findOne({
        assignment: assignmentId,
        student: userS1._id
      });
      assert(chatDoc, 'Chat document should exist in MongoDB');
      assert(chatDoc.messages.length >= 1, 'Should have at least 1 message');
      const lastMsg = chatDoc.messages[chatDoc.messages.length - 1];
      assert.strictEqual(lastMsg.message, 'Hello Teacher!');
      assert(lastMsg.file && (lastMsg.file.url.includes('/uploads/chat-') || lastMsg.file.url.includes('cloudinary.com')));
      assert.strictEqual(lastMsg.file.name, 'notes.txt');
    });

    await test('Malformed message payload handled safely without crashing server', async () => {
      await new Promise((resolve) => {
        const client = Client(SOCKET_URL, { query: { token: tStudent1 }, reconnection: false });
        client.on('connect', () => {
          // Emit malformed payload missing assignmentId
          client.emit('assignmentChatMessage', null);
          client.emit('assignmentChatMessage', {});
          client.emit('assignmentChatMessage', { assignmentId: 'invalid-id' });
          setTimeout(() => {
            client.close();
            resolve();
          }, 500);
        });
      });
    });

    console.log('\n--- 5. Developer / Support Chat Tests ---');

    await test('Non-admin receiving notAdmin on getDevChats and joining dev room', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token: tStudent1 }, reconnection: false });
        client.on('connect', () => {
          client.emit('getDevChats');
        });
        client.on('notAdmin', () => {
          client.emit('joinDeveloperChat', { userId: userS1._id.toString() });
        });
        client.on('chatHistory', (history) => {
          assert(Array.isArray(history));
          client.close();
          resolve();
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timed out waiting for notAdmin and chatHistory'));
        }, 2000);
      });
    });

    await test('Developer chat message persisted in MongoDB DevChat', async () => {
      await new Promise((resolve) => {
        const client = Client(SOCKET_URL, { query: { token: tStudent1 }, reconnection: false });
        client.on('connect', () => {
          client.emit('joinDeveloperChat', { userId: userS1._id.toString() });
          client.emit('developerChatMessage', {
            message: 'Need help with login',
            userId: userS1._id.toString()
          });
          client.on('chatUpdate', async (chat) => {
            if (chat.message === 'Need help with login') {
              const doc = await DevChat.findOne({ user: userS1._id });
              assert(doc);
              assert(doc.messages.some(m => m.message === 'Need help with login'));
              client.close();
              resolve();
            }
          });
        });
      });
    });

    await test('Socket disconnect handles cleanly without crashing server', async () => {
      const client = Client(SOCKET_URL, { query: { token: tStudent1 }, reconnection: false });
      await new Promise((resolve) => {
        client.on('connect', () => {
          client.disconnect();
          resolve();
        });
      });
    });

    console.log(`\nRESULTS: ${passed} Passed, ${failed} Failed.`);
    await mongoose.disconnect();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Fatal Test Error:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

runTests();
