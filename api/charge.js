import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, paymentMethodId, email, shipping } = req.body;

    // Crear el cobro en Stripe pasando email y dirección de envío
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convertir a centavos
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      receipt_email: email, // Para que Stripe le mande recibo al cliente
      description: 'Compra en GRAND HUSTLES',
      shipping: {
        name: shipping ? shipping.name : 'Cliente GRAND HUSTLES',
        address: {
          line1: shipping ? shipping.address : '',
          city: shipping ? shipping.city : '',
          state: shipping ? shipping.state : '',
          postal_code: shipping ? shipping.zip : '',
          country: 'US',
        },
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    });

    return res.status(200).json({ success: true, paymentIntent });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
}
