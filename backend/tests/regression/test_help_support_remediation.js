const { io: Client } = require('../../../frontend/node_modules/socket.io-client');
const mongoose = require('mongoose');
const assert = require('assert');
const User = require('../../models/User');
const DevChat = require('../../models/DevChat');

const BASE_URL = 'http://localhost:5000/api';
const SOCKET_URL = 'http://localhost:5000';

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
  let passed = 0;
  let failed = 0;

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
    console.log('--- Setting up Test Fixtures for Help & Support Socket Tests ---');

    const email = `support_test_${Date.now()}@test.com`;
    const password = 'Password@123';

    const testUser = await User.create({
      name: 'Help Test User',
      email,
      password,
      isVerified: true
    });

    const loginRes = await fetchData('POST', '/auth/login', { email, password });
    assert.strictEqual(loginRes.status, 200, 'Login should succeed');
    const token = loginRes.data.token;
    assert.ok(token, 'Token must be issued');

    console.log('\n--- 1. Support Chat Socket Event Contract & History Tests ---');

    await test('Existing socket contract: Non-admin joins dev chat and receives chatHistory', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
        client.on('connect', () => {
          client.emit('getDevChats');
        });
        client.on('notAdmin', () => {
          client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
        });
        client.on('chatHistory', (history) => {
          assert(Array.isArray(history), 'History must be an array');
          client.close();
          resolve();
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timeout waiting for chatHistory'));
        }, 3000);
      });
    });

    await test('Existing socket contract: Text message persists in MongoDB DevChat and emits chatUpdate', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
        client.on('connect', () => {
          client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
          client.emit('developerChatMessage', {
            message: 'Need help with course navigation',
            userId: testUser._id.toString()
          });
        });
        client.on('chatUpdate', async (chat) => {
          try {
            if (chat.message === 'Need help with course navigation') {
              const doc = await DevChat.findOne({ user: testUser._id });
              assert(doc, 'DevChat doc must exist');
              assert(doc.messages.some(m => m.message === 'Need help with course navigation'));
              client.close();
              resolve();
            }
          } catch (e) {
            client.close();
            reject(e);
          }
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timeout waiting for chatUpdate'));
        }, 3000);
      });
    });

    console.log('\n--- 2. Attachment Security: Allowlist Tests (JPEG, PNG, WEBP, PDF, TXT) ---');

    const testValidAttachment = (formatName, mimeType, filename, dummyContent) => {
      return async () => {
        await new Promise((resolve, reject) => {
          const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
          client.on('connect', () => {
            client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
            const buffer = Array.from(Buffer.from(dummyContent));
            client.emit('developerChatMessage', {
              message: `Testing valid ${formatName} attachment`,
              userId: testUser._id.toString(),
              file: {
                name: filename,
                type: mimeType,
                size: buffer.length,
                buffer: buffer
              }
            });
          });
          client.on('chatUpdate', async (chat) => {
            try {
              if (chat.message === `Testing valid ${formatName} attachment`) {
                assert.ok(chat.file, 'chat.file must be present in chatUpdate');
                assert.strictEqual(chat.file.name, filename);
                assert.ok(chat.file.url, 'File URL must be generated');
                
                // Verify persistence in MongoDB
                const doc = await DevChat.findOne({ user: testUser._id });
                const savedMsg = doc.messages.find(m => m.message === `Testing valid ${formatName} attachment`);
                assert.ok(savedMsg, 'Message must be in DB');
                assert.ok(savedMsg.file, 'File must be in DB message');
                assert.strictEqual(savedMsg.file.name, filename);
                
                client.close();
                resolve();
              }
            } catch (e) {
              client.close();
              reject(e);
            }
          });
          client.on('error', (err) => {
            client.close();
            reject(new Error(`Unexpected socket error for valid ${formatName}: ${err}`));
          });
          setTimeout(() => {
            client.close();
            reject(new Error(`Timeout waiting for ${formatName} attachment chatUpdate`));
          }, 4000);
        });
      };
    };

    // Minimal valid 1x1 image buffers
    const MINIMAL_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCV/9k=', 'base64');
    const MINIMAL_PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    const MINIMAL_WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

    await test('Attachment: JPEG accepted, persisted, and emitted', 
      testValidAttachment('JPEG', 'image/jpeg', 'sample.jpg', MINIMAL_JPEG));

    await test('Attachment: PNG accepted, persisted, and emitted', 
      testValidAttachment('PNG', 'image/png', 'sample.png', MINIMAL_PNG));

    await test('Attachment: WEBP accepted, persisted, and emitted', 
      testValidAttachment('WEBP', 'image/webp', 'sample.webp', MINIMAL_WEBP));

    await test('Attachment: PDF accepted, persisted, and emitted', 
      testValidAttachment('PDF', 'application/pdf', 'sample.pdf', '%PDF-1.4 test pdf content'));

    await test('Attachment: TXT accepted, persisted, and emitted', 
      testValidAttachment('TXT', 'text/plain', 'notes.txt', 'plain text notes content'));

    console.log('\n--- 3. Attachment Security: Rejection Tests (Unsupported, Oversized, Invalid) ---');

    await test('Attachment: Unsupported executable (application/x-msdownload, .exe) rejected cleanly', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
        client.on('connect', () => {
          client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
          client.emit('developerChatMessage', {
            message: 'Malicious payload test',
            userId: testUser._id.toString(),
            file: {
              name: 'malware.exe',
              type: 'application/x-msdownload',
              size: 100,
              buffer: Array.from(Buffer.from('MZ0000000000'))
            }
          });
        });
        client.on('error', (err) => {
          try {
            assert.ok(err.includes('Unsupported file type'), `Error message should mention unsupported file type. Got: ${err}`);
            client.close();
            resolve();
          } catch (e) {
            client.close();
            reject(e);
          }
        });
        client.on('chatUpdate', (chat) => {
          if (chat.message === 'Malicious payload test') {
            client.close();
            reject(new Error('Executable should NOT have been accepted or emitted'));
          }
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timeout: Server did not reject unsupported executable'));
        }, 3000);
      });
    });

    await test('Attachment: Unsupported archive (application/zip, .zip) rejected cleanly', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
        client.on('connect', () => {
          client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
          client.emit('developerChatMessage', {
            message: 'Archive payload test',
            userId: testUser._id.toString(),
            file: {
              name: 'archive.zip',
              type: 'application/zip',
              size: 100,
              buffer: Array.from(Buffer.from('PK0304'))
            }
          });
        });
        client.on('error', (err) => {
          try {
            assert.ok(err.includes('Unsupported file type'), `Error message should mention unsupported file type. Got: ${err}`);
            client.close();
            resolve();
          } catch (e) {
            client.close();
            reject(e);
          }
        });
        client.on('chatUpdate', (chat) => {
          if (chat.message === 'Archive payload test') {
            client.close();
            reject(new Error('Zip archive should NOT have been accepted or emitted'));
          }
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timeout: Server did not reject unsupported archive'));
        }, 3000);
      });
    });

    await test('Attachment: Oversized file (> 5MB) rejected cleanly with safe error', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
        client.on('connect', () => {
          client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
          // Declare size > 5MB
          client.emit('developerChatMessage', {
            message: 'Oversized file test',
            userId: testUser._id.toString(),
            file: {
              name: 'huge.pdf',
              type: 'application/pdf',
              size: 6 * 1024 * 1024,
              buffer: [1, 2, 3]
            }
          });
        });
        client.on('error', (err) => {
          try {
            assert.ok(err.includes('5MB'), `Error message should mention 5MB. Got: ${err}`);
            client.close();
            resolve();
          } catch (e) {
            client.close();
            reject(e);
          }
        });
        client.on('chatUpdate', (chat) => {
          if (chat.message === 'Oversized file test') {
            client.close();
            reject(new Error('Oversized file should NOT have been accepted'));
          }
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timeout: Server did not reject oversized file'));
        }, 3000);
      });
    });

    await test('Invalid attachment does not crash server/socket and subsequent valid message succeeds', async () => {
      await new Promise((resolve, reject) => {
        const client = Client(SOCKET_URL, { query: { token }, reconnection: false });
        client.on('connect', () => {
          client.emit('joinDeveloperChat', { userId: testUser._id.toString() });
          // First send bad payload
          client.emit('developerChatMessage', {
            message: 'Bad attachment',
            userId: testUser._id.toString(),
            file: {
              name: 'test.sh',
              type: 'application/x-sh',
              buffer: [1, 2, 3]
            }
          });
        });
        let errorReceived = false;
        client.on('error', (err) => {
          errorReceived = true;
          // Send valid message immediately after error to prove socket is healthy and alive
          client.emit('developerChatMessage', {
            message: 'Alive after rejection',
            userId: testUser._id.toString()
          });
        });
        client.on('chatUpdate', (chat) => {
          try {
            if (chat.message === 'Alive after rejection') {
              assert.ok(errorReceived, 'Error should have been received prior to valid message');
              client.close();
              resolve();
            }
          } catch (e) {
            client.close();
            reject(e);
          }
        });
        setTimeout(() => {
          client.close();
          reject(new Error('Timeout verifying socket survival after invalid attachment'));
        }, 4000);
      });
    });

    console.log(`\n========================================`);
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    await DevChat.deleteMany({ user: testUser._id });
    await User.findByIdAndDelete(testUser._id);
    await mongoose.disconnect();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('Test execution fatal error:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
};

runTests();
