const test = require('node:test');
const assert = require('node:assert/strict');
const { sendWithResend } = require('../api/resendTransport');

test('Resend transport submits server-only credentials and email payload', async () => {
  let called = 0;
  const id = await sendWithResend({
    to: 'customer@example.com', subject: 'Pedido', html: '<p>Gracias</p>'
  }, {
    apiKey: 'test_secret', from: 'orders@example.com', idempotencyKey: 'order_123',
    fetch: async (url, request) => {
      called++;
      assert.equal(url, 'https://api.resend.com/emails');
      assert.equal(request.headers.Authorization, 'Bearer test_secret');
      assert.equal(request.headers['Idempotency-Key'], 'order_123');
      assert.deepEqual(JSON.parse(request.body).to, ['customer@example.com']);
      return { ok: true, json: async () => ({ id: 'email_123' }) };
    }
  });
  assert.equal(id, 'email_123');
  assert.equal(called, 1);
});

test('Resend transport rejects unconfigured and malformed requests', async () => {
  await assert.rejects(() => sendWithResend({ to: 'bad', subject: 'Hi', html: '<p>x</p>' }, {
    apiKey: 'test', from: 'orders@example.com', fetch: async () => { throw Error('must not send'); }
  }));
});
