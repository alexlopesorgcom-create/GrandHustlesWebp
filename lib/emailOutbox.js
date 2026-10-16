'use strict';
const { randomUUID } = require('node:crypto');
const { orderPaidEmail, newSaleEmail } = require('../api/notificationTemplates');
const { sendWithResend } = require('../api/resendTransport');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOW_MS = 23 * 60 * 60 * 1000; // Margin before Resend's 24-hour expiry.
const LEASE_MS = 60 * 1000;

function configuration(env) {
  if (env.EMAIL_OUTBOX_ENABLED !== 'true') return null;
  if (!['test', 'live'].includes(env.EMAIL_MODE)) throw Error('EMAIL_MODE required');
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') throw Error('Preview worker disabled');
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !EMAIL.test(env.OWNER_EMAIL || '')) throw Error('Email configuration incomplete');
  if (env.EMAIL_MODE === 'test' && !EMAIL.test(env.EMAIL_TEST_RECIPIENT || '')) throw Error('Test recipient required');
  if (env.EMAIL_MODE === 'live' && /@resend\.dev\b/i.test(env.RESEND_FROM_EMAIL)) throw Error('Verified sending domain required');
  return { mode: env.EMAIL_MODE, from: env.RESEND_FROM_EMAIL, owner: env.OWNER_EMAIL,
    testRecipient: env.EMAIL_TEST_RECIPIENT, replyTo: env.EMAIL_REPLY_TO || env.OWNER_EMAIL };
}

function paidOrder(order, intent, orderId, mode) {
  const cents = Math.round(order.total * 100);
  return order.paymentStatus === 'succeeded' && order.stockUpdated === true &&
    typeof order.paymentId === 'string' && intent.id === order.paymentId &&
    intent.status === 'succeeded' && intent.metadata?.orderId === orderId &&
    typeof order.total === 'number' && Number.isSafeInteger(cents) && cents > 0 &&
    intent.amount === cents && intent.amount_received >= cents && intent.currency === 'usd' &&
    intent.livemode === (mode === 'live');
}

async function processJob({ db, stripe, ref, config, env, send, now }) {
  const token = randomUUID();
  const time = now();
  const claim = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const job = snap.data();
    if (!['pending', 'retry', 'processing'].includes(job.state) ||
        (job.leaseUntil || 0) > time || (job.nextAttemptAt || 0) > time) return null;
    if (job.firstAttemptAt != null && time - job.firstAttemptAt >= WINDOW_MS) {
      tx.update(ref, { nextAttemptAt: null, leaseUntil: 0, state: 'review', reason: 'idempotency_window_expired' });
      return null;
    }
    if (typeof job.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(job.orderId) ||
        !['customer_order_paid', 'owner_new_sale'].includes(job.kind) ||
        ref.id !== (job.kind === 'customer_order_paid' ? 'customer_paid_' : 'owner_paid_') + job.orderId) {
      tx.update(ref, { nextAttemptAt: null, leaseUntil: 0, state: 'review', reason: 'invalid_job' });
      return null;
    }
    const orderSnap = await tx.get(db.collection('orders').doc(job.orderId));
    if (!orderSnap.exists) { tx.update(ref, { nextAttemptAt: null, leaseUntil: 0, state: 'review', reason: 'missing_order' }); return null; }
    const order = orderSnap.data();
    if (order.paymentStatus !== 'succeeded' || order.stockUpdated !== true || !order.paymentId) {
      tx.update(ref, { nextAttemptAt: null, leaseUntil: 0, state: 'review', reason: 'unsettled_order' }); return null;
    }
    const attempts = (job.attempts || 0) + 1;
    if (attempts > 10) { tx.update(ref, { nextAttemptAt: null, leaseUntil: 0, state: 'review', reason: 'attempt_limit' }); return null; }
    tx.update(ref, { state: 'processing', token, leaseUntil: time + LEASE_MS, attempts });
    return { job, order, attempts };
  });
  if (!claim) return 'skipped';
  const finish = fields => db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.data()?.token === token) tx.update(ref, { nextAttemptAt: null, ...fields, leaseUntil: 0 });
  });
  try {
    const { job, order } = claim;
    const intent = await stripe.paymentIntents.retrieve(order.paymentId);
    if (!paidOrder(order, intent, job.orderId, config.mode)) {
      await finish({ state: 'review', reason: 'payment_verification_failed' }); return 'review';
    }
    const data = { id: job.orderId, totalCents: Math.round(order.total * 100), customerEmail: order.email };
    const to = job.kind === 'customer_order_paid' ? order.email : config.owner;
    if (!EMAIL.test(to || '') || (job.kind === 'customer_order_paid' && job.recipient !== order.email)) {
      await finish({ state: 'review', reason: 'invalid_recipient' }); return 'review';
    }
    let payload = job.payload;
    if (!payload) {
      const template = job.kind === 'customer_order_paid' ? orderPaidEmail(data) : newSaleEmail(data);
      payload = { ...template, to: config.mode === 'test' ? config.testRecipient : to,
        from: config.from, replyTo: config.replyTo, mode: config.mode };
      if (config.mode === 'test') payload.subject = '[PRUEBA — SIN COBRO REAL] ' + payload.subject;
    }
    // Preserve the exact body across retries, even if configuration/templates change.
    if (payload.mode !== config.mode || (config.mode === 'test' && payload.to !== config.testRecipient)) {
      await finish({ state: 'review', reason: 'configuration_changed' }); return 'review';
    }
    const ready = await db.runTransaction(async tx => {
      const snap = await tx.get(ref); const latest = snap.data();
      if (latest?.token !== token || latest.leaseUntil <= now()) return false;
      if (latest.firstAttemptAt != null && now() - latest.firstAttemptAt >= WINDOW_MS) return false;
      tx.update(ref, { payload, firstAttemptAt: latest.firstAttemptAt ?? now(), leaseUntil: now() + LEASE_MS });
      return true;
    });
    if (!ready) return 'skipped';
    const providerId = await send(payload, { apiKey: env.RESEND_API_KEY, from: payload.from,
      replyTo: payload.replyTo, idempotencyKey: 'drphvn_' + ref.id });
    await finish({ state: 'sent', providerId, sentAt: now(), reason: null });
    return 'sent'; // Accepted by provider; inbox delivery is not proven.
  } catch (error) {
    const permanent = error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);
    await finish({ state: permanent ? 'review' : 'retry', reason: permanent ? 'provider_rejected' : 'transient_failure',
      nextAttemptAt: now() + Math.min(3600000, 30000 * 2 ** claim.attempts) });
    return permanent ? 'review' : 'retry';
  }
}

async function processOutbox({ db, stripe, env = process.env, send = sendWithResend, now = Date.now }) {
  const config = configuration(env);
  if (!config) return { disabled: true };
  // Single-field queries need no compound index. Due-time filtering prevents starvation.
  const queries = [
    db.collection('emailOutbox').where('state', '==', 'pending').limit(5),
    db.collection('emailOutbox').where('nextAttemptAt', '>', 0).where('nextAttemptAt', '<=', now()).orderBy('nextAttemptAt').limit(10),
    db.collection('emailOutbox').where('leaseUntil', '>', 0).orderBy('leaseUntil').limit(10)
  ];
  const docs = new Map();
  for (const q of queries) for (const doc of (await q.get()).docs) docs.set(doc.id, doc);
  const counts = { sent: 0, retry: 0, review: 0, skipped: 0 };
  const started = Date.now();
  for (const doc of docs.values()) {
    if (Date.now() - started > 20000) break;
    counts[await processJob({ db, stripe, ref: doc.ref, config, env, send, now })]++;
  }
  return counts;
}
module.exports = { configuration, paidOrder, processJob, processOutbox, WINDOW_MS };
