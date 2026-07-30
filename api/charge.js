const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { amount, paymentMethodId } = req.body;

    const payment = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convierte el total a centavos ($84.00 = 8400)
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    });

    return res.status(200).json({ success: true, payment });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};
