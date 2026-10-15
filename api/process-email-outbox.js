'use strict';
const { timingSafeEqual } = require('node:crypto');
const { processOutbox } = require('../lib/emailOutbox');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.EMAIL_WORKER_SECRET;
  const supplied = req.headers.authorization;
  const expected = 'Bearer ' + secret;
  if (!secret || secret.length < 32 || typeof supplied !== 'string' ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(401).json({ error: 'Unauthorized' });
  if (process.env.EMAIL_OUTBOX_ENABLED !== 'true') return res.status(200).json({ disabled: true });
  if (process.env.VERCEL_ENV !== 'production') return res.status(503).json({ error: 'Preview worker disabled' });
  try {
    const { db } = require('./firebaseAdmin');
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 0 });
    return res.status(200).json(await processOutbox({ db, stripe }));
  } catch (_) {
    return res.status(503).json({ error: 'Email worker unavailable' });
  }
};
