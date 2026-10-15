// Local test server: use the same validated handlers as Vercel.
// Refuse live keys and non-emulator Firestore to protect the original store.
require('dotenv').config();
if (!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Local server requires Stripe test key and Firestore emulator');
}
const express = require('express');
const app = express();
// Raw bytes must reach Stripe before JSON middleware parses the request.
app.post('/api/webhook', require('./webhook'));
app.use(express.json({ limit: '1mb' }));
app.post('/api/charge', require('./charge'));
app.post('/api/process-email-outbox', require('./process-email-outbox'));
module.exports = app;
if (require.main === module) app.listen(3000, '127.0.0.1');
