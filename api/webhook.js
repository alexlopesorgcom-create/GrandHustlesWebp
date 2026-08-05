const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido"
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


    case "payment_intent.payment_failed":

      const failedPayment = event.data.object;

      console.log(
        "Pago fallido:",
        failedPayment.id
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
