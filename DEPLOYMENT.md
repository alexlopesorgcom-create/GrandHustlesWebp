# DRPHVN deployment and configuration

## Required before accepting payments

Configure these values in the Vercel project. Use Stripe **test-mode** values for
initial verification; do not configure live-mode keys until the owner explicitly
authorizes a live launch.

| Variable | Purpose |
| --- | --- |
| `STRIPE_PUBLISHABLE_KEY` | Stripe.js client key (`pk_test_...` during testing). |
| `STRIPE_SECRET_KEY` | Server-side Stripe API key (`sk_test_...` during testing). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the `/api/webhook` endpoint. |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account JSON for server-side Firestore access. Keep private. |
| `SHIPPING_RATE_CENTS` | Owner-approved fixed US shipping amount in cents. Payments stay disabled until configured. |
| `ALLOWED_ORIGINS` | Comma-separated exact origins allowed to call the charge API. Include scheme, host, and optional port. |
| `CRON_SECRET` | Random secret of at least 32 characters for expired-reservation cleanup. |

The image editor is optional. If enabled, also configure `IMAGE_EDITOR_ACCESS_TOKEN`
(at least 32 random characters) and `REPLICATE_API_TOKEN`.

The browser Firebase configuration in `index.html` identifies the Firebase
project and is public client configuration, not a service-account credential.
Verify that it points to the intended DRPHVN production project before deployment.

## Firebase access control

1. Review `firestore.rules` against the existing collections and deploy it to the
   intended Firebase project with `firebase deploy --only firestore:rules`.
2. Create administrator users in Firebase Authentication. Assign the
   server-side custom claim `{ "admin": true }` only to approved administrator
   UIDs using a trusted Firebase Admin SDK environment. Never set this claim from
   browser code.
3. Confirm the administrator can read and manage products after the rules deploy.
   Public clients can read products but cannot write products, orders, or payment
   event records.

Firebase Admin SDK calls bypass Firestore rules. Protect the service-account JSON
as a server-only Vercel secret.

## Stripe setup

1. Configure Stripe test keys first.
2. Register `https://<deployment-domain>/api/webhook` as a webhook endpoint for
   `payment_intent.succeeded` and `payment_intent.payment_failed`.
3. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.
4. Confirm test orders, webhook retries, inventory reservations, failed payments,
   and reservation expiration before considering live mode.

The charge endpoint calculates the subtotal from Firestore product prices and
reserves inventory transactionally. The browser-supplied amount is not trusted.
The current checkout supports a configured fixed shipping amount; pickup, live
shipping-rate lookup, and tax calculation still need store-specific configuration.

Vercel is configured to run `/api/release-expired-orders` every five minutes.
Confirm that the selected Vercel plan supports the desired cron frequency and
that `CRON_SECRET` is present before enabling real checkout.

## GitHub and Vercel

Import the repository into Vercel with the repository root as the project root
and the framework preset set to **Other**. Configure the environment variables
above, then connect the production branch. A push to that branch triggers a
remote deployment when the GitHub integration is enabled.

Do not choose a final custom domain until the owner confirms it.

## Remaining brand assets and launch details

There is no official DRPHVN logo, favicon, or brand photography in the repository.
The storefront uses the DRPHVN name as text and does not fabricate a replacement
logo. Add the approved logo and licensed campaign/product photography before
launch. Store-specific terms, privacy, shipping, returns, pickup instructions,
tax handling, and the actual shipping charge also require owner review.
