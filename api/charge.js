const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método no permitido"
    });
  }

  try {
    const {
      paymentMethodId,
      amount,
      email,
      shipping
    } = req.body;

    if (!paymentMethodId || !amount) {
      return res.status(400).json({
        success: false,
        error: "Faltan datos del pago"
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100),
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: true,
      receipt_email: email || undefined,
      shipping: shipping
        ? {
            name: `${shipping.firstName} ${shipping.lastName}`,
            address: {
              line1: shipping.address,
              city: shipping.city,
              state: shipping.state,
              postal_code: shipping.zip,
              country: "US"
            }
          }
        : undefined
    });

    return res.status(200).json({
      success: true,
      paymentId: paymentIntent.id,
      status: paymentIntent.status
    });

  } catch (error) {
    console.error("Stripe error:", error.message);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
};
