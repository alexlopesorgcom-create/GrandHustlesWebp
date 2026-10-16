const test = require('node:test');
const assert = require('node:assert/strict');
const { reserveStock, releaseStock, validateLines } = require('../api/stockReservation');

function fakeDb(initialStock) {
  const data = new Map([['products/last', { stock: initialStock, price: 20, published: true }]]);
  let queue = Promise.resolve();
  const ref = path => ({ path, id: path.split('/').pop() });
  const db = {
    collection: name => ({ doc: id => ref(name + '/' + id) }),
    runTransaction(callback) {
      const run = queue.then(async () => {
        const writes = [];
        const tx = {
          async get(r) {
            const value = data.get(r.path);
            return { id: r.id, exists: !!value, data: () => value && { ...value } };
          },
          create(r, value) {
            if (data.has(r.path)) throw new Error('Already exists');
            writes.push(() => data.set(r.path, { ...value }));
          },
          update(r, value) {
            if (!data.has(r.path)) throw new Error('Missing');
            writes.push(() => data.set(r.path, { ...data.get(r.path), ...value }));
          }
        };
        const result = await callback(tx);
        writes.forEach(write => write());
        return result;
      });
      queue = run.catch(() => {});
      return run;
    }
  };
  return { db, data };
}

test('rejects invalid, duplicate and negative quantities', () => {
  assert.throws(() => validateLines([{ id: 'last', quantity: 0 }]));
  assert.throws(() => validateLines([{ id: 'last', quantity: 1 }, { id: 'last', quantity: 1 }]));
  assert.throws(() => validateLines([{ id: '../other', quantity: 1 }]));
});

test('two buyers cannot reserve the final unit', async () => {
  const { db, data } = fakeDb(1);
  const items = [{ id: 'last', quantity: 1 }];
  const results = await Promise.allSettled([
    reserveStock(db, db.collection('orders').doc('buyer1'), items, 'now'),
    reserveStock(db, db.collection('orders').doc('buyer2'), items, 'now')
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(data.get('products/last').stock, 0);
});

test('releasing a reservation restores stock exactly once', async () => {
  const { db, data } = fakeDb(2);
  const orderRef = db.collection('orders').doc('buyer');
  await reserveStock(db, orderRef, [{ id: 'last', quantity: 1 }], 'now');
  assert.equal(data.get('products/last').stock, 1);
  assert.equal(await releaseStock(db, orderRef, 'later', true), true);
  assert.equal(await releaseStock(db, orderRef, 'later', true), false);
  assert.equal(data.get('products/last').stock, 2);
});

test('paid reservations cannot be released', async () => {
  const { db, data } = fakeDb(1);
  const orderRef = db.collection('orders').doc('buyer');
  await reserveStock(db, orderRef, [{ id: 'last', quantity: 1 }], 'now');
  data.set(orderRef.path, { ...data.get(orderRef.path), paymentStatus: 'succeeded' });
  await assert.rejects(() => releaseStock(db, orderRef, 'later', true));
  assert.equal(data.get('products/last').stock, 0);
});
