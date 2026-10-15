# Firebase configuration for DRPHVN

The existing browser storefront references Firebase project `mi-tienda-drop`. Confirm the server service account belongs to the same Firebase project before any staging deployment.

## Vercel server environment variables
- `FIREBASE_SERVICE_ACCOUNT`: complete service-account JSON, stored only as a server-side secret.
- `FIREBASE_PROJECT_ID`: `mi-tienda-drop` (project identity guard).
- `STRIPE_SECRET_KEY`: Stripe test key for staging.
- `STRIPE_WEBHOOK_SECRET`: Stripe test webhook signing secret.

Never paste secrets into GitHub, public chat, or frontend JavaScript. Use the Vercel environment-variable settings for the correct preview environment.

## Required next steps before using Firestore for real payments
1. Verify the Firebase service account is configured for the correct Vercel project/environment.
2. Review existing Firestore security rules in Firebase Console. The repository does not contain a rules file. Do not deploy guessed rules that could block customers or expose writes.
3. Replace browser-side product/order writes with authenticated backend endpoints. Current storefront has direct client writes and admin controls.
4. Replace client-provided payment amounts with trusted server-calculated totals.
5. Implement inventory reservation and transactional, idempotent webhook fulfillment.
6. Test with Firebase emulator or isolated staging project and Stripe test mode before deployment.

**Status:** Firebase Admin initialization validation updated on the development branch. Connection to the live Firebase project has NOT been tested or established by this change.
