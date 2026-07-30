const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Configuración de Stripe usando tu Clave Secreta desde las variables de entorno
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Endpoint para procesar el cobro con Tarjeta
app.post('/api/charge', async (req, res) => {
  const { paymentMethodId, amount, email, shipping } = req.body;

  try {
    // Crear el PaymentIntent con Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convertir a centavos (ej: $84.00 = 8400)
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      receipt_email: email,
      shipping: shipping ? {
        name: `${shipping.firstName} ${shipping.lastName}`,
        address: {
          line1: shipping.address,
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.zip,
          country: 'US'
        }
      } : undefined,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      }
    });

    // Enviar respuesta exitosa al frontend
    res.status(200).json({ success: true, paymentIntent });
  } catch (error) {
    console.error('Error procesando el pago:', error.message);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de GRAND HUSTLES corriendo en el puerto ${PORT}`);
});
