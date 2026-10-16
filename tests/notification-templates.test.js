const test = require('node:test');
const assert = require('node:assert/strict');
const { orderPaidEmail, newSaleEmail } = require('../api/notificationTemplates');

test('customer confirmation contains canonical total', () => {
  const email = orderPaidEmail({ id: 'order_123', totalCents: 4599 });
  assert.match(email.subject, /order_123/);
  assert.match(email.text, /\$45\.99/);
});

test('owner notification escapes customer HTML', () => {
  const email = newSaleEmail({
    id: 'order_123', totalCents: 4599,
    customerEmail: '<img src=x onerror=alert(1)>@example.com'
  });
  assert.doesNotMatch(email.html, /<img/);
  assert.match(email.html, /&lt;img/);
});

test('rejects invalid identifiers and totals', () => {
  assert.throws(() => orderPaidEmail({ id: '../bad', totalCents: 100 }));
  assert.throws(() => orderPaidEmail({ id: 'ok', totalCents: NaN }));
});
