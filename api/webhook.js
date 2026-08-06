const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

module.exports = async (req, res) => {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido"
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


    case "payment_intent.succeeded": {

      const paymentIntent = event.data.object;

      console.log(
        "Pago confirmado:",
        paymentIntent.id
      );


      const orderData = {

        paymentId: paymentIntent.id,

        paymentStatus: paymentIntent.status,

        amount: paymentIntent.amount / 100,

        currency: paymentIntent.currency,

        email: paymentIntent.receipt_email || null,

        status: "Paid",

        createdAt: new Date()

      };


      console.log(
        "Orden creada:",
        orderData
      );


      break;

    }


    case "payment_intent.payment_failed": {

      const failedPayment = event.data.object;

      console.log(
        "Pago fallido:",
        failedPayment.id
      );


      break;

    }


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
