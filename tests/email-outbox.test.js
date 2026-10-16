const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('paid Stripe webhook queues deterministic email jobs', () => {
  const webhook = fs.readFileSync(path.join(__dirname, '../api/webhook.js'), 'utf8');
  assert.match(webhook, /customer_paid_/);
  assert.match(webhook, /owner_paid_/);
  assert.match(webhook, /emailOutbox/);
  assert.match(webhook, /payment_intent\.succeeded/);
  assert.match(webhook, /stockUpdated === true/);
});

test('email jobs are not sent from the payment transaction', () => {
  const webhook = fs.readFileSync(path.join(__dirname, '../api/webhook.js'), 'utf8');
  assert.doesNotMatch(webhook, /sendMail\(|sendEmail\(|api\.resend\.com/);
});
