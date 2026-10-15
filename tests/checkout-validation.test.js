const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const charge = fs.readFileSync(path.join(__dirname, '../api/charge.js'), 'utf8');
const webhook = fs.readFileSync(path.join(__dirname, '../api/webhook.js'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

test('server validates quantities, canonical prices and inventory', () => {
  assert.match(charge, /Number\.isSafeInteger\(item\.quantity\)/);
  assert.match(charge, /db\.collection\("products"\)/);
  assert.match(charge, /data\.price/);
  assert.match(charge, /data\.stock/);
});
test('Stripe payment requests use an idempotency key', () => {
  assert.match(charge, /idempotencyKey:/);
  assert.match(charge, /orderRef\.create\(/);
});
test('webhook validates Stripe signature on raw request body', () => {
  assert.match(webhook, /constructEvent\(/);
  assert.match(webhook, /bodyParser: false/);
  assert.match(webhook, /stripe-signature/);
});
test('webhook uses Firestore transaction and avoids repeat stock decrement', () => {
  assert.match(webhook, /order\.stockUpdated === true/);
  assert.match(webhook, /db\.runTransaction/);
});
test('browser cannot directly write orders or product stock', () => {
  assert.match(rules, /match \/orders\//);
  assert.match(rules, /match \/products\//);
});
