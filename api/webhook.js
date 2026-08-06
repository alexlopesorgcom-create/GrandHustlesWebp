const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const { db, admin } = require("./firebaseAdmin");

module.exports = async (req, res) => {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }
  
  const sig = req.headers["stripe-signature"];

  let event;

  try {

    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

  } catch (err) {

    console.error("Webhook signature error:", err.message);

    return res.status(400).json({
      error: `Webhook Error: ${err.message}`
    });

  }


  console.log("Stripe event:", event.type);


  switch (event.type) {

    case "payment_intent.succeeded":

      const paymentIntent = event.data.object;

      console.log(
        "Pago confirmado:",
        paymentIntent.id
      );

      // Aquí después agregaremos:
      // - bajar inventario
      // - crear orden
      // - mandar notificaciones

      break;


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
    status: "Paid",
    email: paymentIntent.receipt_email || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(
    "Order saved to Firestore:",
    paymentIntent.id
  );

  break;


    default:

      console.log(
        "Evento no manejado:",
        event.type
      );

  }


  return res.status(200).json({
    received: true
  });

};
