const Stripe = require("stripe");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  const allowedOrigins = [
    process.env.ALLOWED_ORIGIN,
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    return res.status(403).json({
      success: false,
      error: "Origen no permitido"
    });
  }
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

    if (!paymentMethodId || !amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: "Faltan datos del pago o el monto no es válido"
      });
    }

    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({
        success: false,
        error: "Monto inválido"
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
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
      status: paymentIntent.status,
      clientSecret: paymentIntent.client_secret
    });

  } catch (error) {
    console.error("Stripe error:", error.message);

    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
};
