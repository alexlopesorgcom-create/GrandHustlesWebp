module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
  if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(publishableKey)) {
    return res.status(503).json({
      error: "Stripe aún no está configurado para aceptar pagos."
    });
  }

  const configuredShipping = Number(process.env.SHIPPING_RATE_CENTS);
  return res.status(200).json({
    publishableKey,
    shippingRateCents: Number.isInteger(configuredShipping) && configuredShipping > 0
      ? configuredShipping
      : null
  });
};
