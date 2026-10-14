# DRPHVN implementation audit — 2026-10-14

## Scope and safeguards
Development branch: `feature/drphvn-redesign`. Do not merge into `main` or deploy production before validation. Preserve existing Firestore data, payment credentials and order records.

## Confirmed baseline
- Single-file HTML/CSS/JS storefront in `index.html`, with Firebase compat SDK and Stripe.js.
- Node serverless functions: `api/charge.js`, `api/webhook.js`, `api/firebaseAdmin.js`.
- Vercel rewrite configuration in `vercel.json`.
- `package.json` previously omitted the `firebase-admin` dependency used by server functions; now declared on this branch.

## Critical issues identified
1. `api/charge.js` accepts a client-supplied `amount` and records client-supplied `items`; product prices and quantities must be validated and calculated server-side.
2. CORS currently reflects any Origin and sets Allow-Credentials. Replace with explicit allowed origins.
3. The webhook reads `stockUpdated` before the transaction. Move the idempotency check inside the transaction; read all relevant product snapshots before any writes; aggregate duplicate product lines.
4. Inventory is deducted after payment, with no stock reservation. Simultaneous checkout can charge customers for inventory no longer available. Design a reservation/expiry or compensation workflow before enabling real payments.
5. `checkoutId` is caller-controlled and the order document is merged; protect against order collision, overwrites and replay.
6. Admin controls appear in the public HTML; verify authenticated server-enforced Firestore rules before relying on them.
7. Need integration tests for payment failure, duplicate webhook, concurrency, fulfillment and refunds.

## Implementation phases
- [x] Confirm target repository and create isolated branch.
- [x] Audit primary backend files and declare missing Firebase Admin dependency.
- [ ] Inspect full storefront and Firebase rules; inventory product schemas and existing admin auth.
- [ ] Harden server-side price calculations, CORS, order identity and input validation.
- [ ] Design transactional stock reservations and idempotent webhook fulfillment.
- [ ] DRPHVN visual rebrand across responsive storefront using supplied official logo/reference.
- [ ] Product detail, category filtering, cart variant/quantity controls.
- [ ] Authenticated admin inventory and orders.
- [ ] Transactional emails, shipping/pickup, tracking and label provider integration.
- [ ] Test Stripe in test mode, verify Firebase rules, run build and browser checks.
- [ ] Review staging deployment and approve production release.

## Deployment prerequisites
Provide real logo/image assets, Firebase security rules, Stripe test credentials and webhook configuration, email and shipping provider configuration as needed. Never commit secrets. Do not invent store policy, shipping rates, or products.

## Verification status
Source inspection completed for selected files only. No end-to-end tests, production deployment, live Stripe payments or Firebase migrations performed.
