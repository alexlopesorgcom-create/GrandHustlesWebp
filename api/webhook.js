const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const { db, admin } = require("./firebaseAdmin");

module.exports.config = {
  api: {
    bodyParser: false
  }
};

module.exports = async (req, res) => {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const sig = req.headers["stripe-signature"];

  let event;

  try {

    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const rawBody = Buffer.concat(chunks);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET.trim()
    );

  } catch (err) {

    console.error(
      "Webhook signature error:",
      err.message
    );

    return res.status(400).json({
      error: `Webhook Error: ${err.message}`
    });

  }


  console.log(
    "Stripe event:",
    event.type
  );


  switch (event.type) {

    case "payment_intent.succeeded":

      const paymentIntent = event.data.object;


      console.log(
        "Payment confirmed:",
        paymentIntent.id
      );


      await db.collection("orders").doc(paymentIntent.id).set({

        paymentId: paymentIntent.id,

        amount: paymentIntent.amount / 100,

        currency: paymentIntent.currency,

        email: paymentIntent.receipt_email || null,

        status: "Paid",

        createdAt: admin.firestore.FieldValue.serverTimestamp()

      });


      console.log(
        "Order saved:",
        paymentIntent.id
      );


      break;


    case "payment_intent.payment_failed":

      console.log(
        "Payment failed:",
        event.data.object.id
      );

      break;


    default:

      console.log(
        "Unhandled event:",
        event.type
      );

  }


  return res.status(200).json({
    received: true
  });

};
