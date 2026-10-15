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
    console.log('--- Running Settings Phase 1 Backend Security & Remediation Tests ---');

    const email = `settings_test_${Date.now()}@test.com`;
    const password = 'Password@123';

    // Setup verified user fixture directly in MongoDB
    await User.create({
      name: 'Initial User',
      email,
      password,
      isVerified: true
    });

    // Login to obtain initial JWT token
    const loginRes = await fetchData('POST', '/auth/login', { email, password });
    assert.strictEqual(loginRes.status, 200, 'Login should succeed');
    const token1 = loginRes.data.token;
    assert.ok(token1, 'Token must be issued');

    // Test 1: GET /user/details safely returns name, email, isNotification (no sensitive fields)
    await test('GET /user/details safely returns name, email, and isNotification without sensitive fields', async () => {
      const res = await fetchData('GET', '/user/details', null, token1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.user.name, 'Initial User');
      assert.strictEqual(res.data.user.email, email);
      assert.strictEqual(typeof res.data.user.isNotification, 'boolean');
      assert.strictEqual(res.data.user.isNotification, true);

      // Verify no sensitive fields leaked
      assert.strictEqual(res.data.user.password, undefined);
      assert.strictEqual(res.data.user.tokenVersion, undefined);
      assert.strictEqual(res.data.user.otp, undefined);
      assert.strictEqual(res.data.user.passwordReset, undefined);
      assert.strictEqual(res.data.user.isAdmin, undefined);
    });

    // Test 2: Notification toggle update and persistence
    await test('Toggle notification preference to false and persist', async () => {
      const res = await fetchData('POST', '/user/settings/change-is-notification-enabled', { isNotification: false }, token1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.isNotification, false);

      // Verify via GET /user/details
      const detailsRes = await fetchData('GET', '/user/details', null, token1);
      assert.strictEqual(detailsRes.status, 200);
      assert.strictEqual(detailsRes.data.user.isNotification, false);
    });

    await test('Toggle notification preference back to true and persist', async () => {
      const res = await fetchData('POST', '/user/settings/change-is-notification-enabled', { isNotification: true }, token1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.isNotification, true);

      // Verify via GET /user/details
      const detailsRes = await fetchData('GET', '/user/details', null, token1);
      assert.strictEqual(detailsRes.status, 200);
      assert.strictEqual(detailsRes.data.user.isNotification, true);
    });

    // Test 3: Change name validation
    await test('POST /user/settings/change-name rejects name shorter than 3 characters', async () => {
      const res = await fetchData('POST', '/user/settings/change-name', { name: '  ab ' }, token1);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    await test('POST /user/settings/change-name trims whitespace and updates name', async () => {
      const res = await fetchData('POST', '/user/settings/change-name', { name: '   Updated Name   ' }, token1);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.user.name, 'Updated Name');

      // Verify persistence via GET /user/details
      const detailsRes = await fetchData('GET', '/user/details', null, token1);
      assert.strictEqual(detailsRes.status, 200);
      assert.strictEqual(detailsRes.data.user.name, 'Updated Name');
    });

    // Test 4: Password change security semantics
    await test('POST /user/settings/change-password rejects incorrect old password', async () => {
      const res = await fetchData('POST', '/user/settings/change-password', {
        oldPassword: 'WrongPassword@123',
        newPassword: 'NewPassword@123'
      }, token1);
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    await test('POST /user/settings/change-password rejects identical old and new password', async () => {
      const res = await fetchData('POST', '/user/settings/change-password', {
        oldPassword: password,
        newPassword: password
      }, token1);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    await test('POST /user/settings/change-password rejects weak new password', async () => {
      const res = await fetchData('POST', '/user/settings/change-password', {
        oldPassword: password,
        newPassword: 'weak'
      }, token1);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    let newReturnedToken = null;
    await test('POST /user/settings/change-password increments tokenVersion and returns fresh JWT', async () => {
      const userBefore = await User.findOne({ email }).select('+tokenVersion +password');
      const tvBefore = userBefore.tokenVersion || 0;
      const oldHash = userBefore.password;

      const newPassword = 'NewPassword@456';
      const res = await fetchData('POST', '/user/settings/change-password', {
        oldPassword: password,
        newPassword: newPassword
      }, token1);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.token, 'Must return new JWT');
      newReturnedToken = res.data.token;

      // Verify DB changes
      const userAfter = await User.findOne({ email }).select('+tokenVersion +password');
      assert.strictEqual(userAfter.tokenVersion, tvBefore + 1, 'tokenVersion must be incremented by 1');
      assert.notStrictEqual(userAfter.password, newPassword, 'Password must not be plaintext');
      assert.notStrictEqual(userAfter.password, oldHash, 'Password hash must change');
      const isMatch = await userAfter.comparePassword(newPassword);
      assert.strictEqual(isMatch, true, 'New password must match comparePassword');
    });

    await test('Pre-change JWT token1 is now rejected (401 invalid session)', async () => {
      const res = await fetchData('GET', '/user/details', null, token1);
      assert.strictEqual(res.status, 401, 'Old JWT must be rejected with 401');
      assert.strictEqual(res.data.success, false);
    });

    await test('Returned fresh JWT newReturnedToken is accepted (200 valid session)', async () => {
      const res = await fetchData('GET', '/user/details', null, newReturnedToken);
      assert.strictEqual(res.status, 200, 'Fresh JWT must be accepted with 200');
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.user.name, 'Updated Name');
    });

    // Test 5: Sign out all devices
    await test('POST /user/settings/sign-out-all-devices invalidates existing JWT', async () => {
      const userBefore = await User.findOne({ email }).select('+tokenVersion');
      const tvBefore = userBefore.tokenVersion;

      const res = await fetchData('POST', '/user/settings/sign-out-all-devices', {}, newReturnedToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      const userAfter = await User.findOne({ email }).select('+tokenVersion');
      assert.strictEqual(userAfter.tokenVersion, tvBefore + 1);

      // Verify that newReturnedToken is now also rejected
      const checkRes = await fetchData('GET', '/user/details', null, newReturnedToken);
      assert.strictEqual(checkRes.status, 401, 'JWT must be rejected after sign-out-all-devices');
    });

    console.log(`\n========================================`);
    console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
    process.exit(0);
  } catch (error) {
    console.error('Fatal test error:', error);
    process.exit(1);
  }
};

runTests();
