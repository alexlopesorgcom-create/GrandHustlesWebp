const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");

require("dotenv").config();

const app = express();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

app.post("/api/charge", async (req, res) => {
  try {
    const {
      paymentMethodId,
      amount,
      email,
      shipping
    } = req.body;

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

    res.json({
      success: true,
      paymentId: paymentIntent.id,
      status: paymentIntent.status
    });

  } catch (error) {
    console.error(error.message);

    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = app;
