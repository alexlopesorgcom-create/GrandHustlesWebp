const Stripe = require("stripe");
const { db, admin } = require("./firebaseAdmin");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {

  // CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");

  const origin = req.headers.origin;

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
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
      checkoutId,
      items,
      shipping
    } = req.body;

    if (!checkoutId) {
      return res.status(400).json({
        success: false,
        error: "Falta checkoutId"
      });
    }

    if (!paymentMethodId || !amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: "Faltan datos del pago o el monto no es válido"
      });
    }


    // Never trust browser-submitted prices. Read canonical product prices from Firestore.
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ success: false, error: "Carrito inválido" });
    }
    const validatedItems = [];
    const seenProducts = new Set();
    let calculatedCents = 0;
    for (const item of items) {
      if (typeof item.id !== "string" || !item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        return res.status(400).json({ success: false, error: "Cantidad o producto inválido" });
      }
      if (seenProducts.has(item.id)) return res.status(400).json({ success: false, error: "Producto duplicado en carrito" });
      seenProducts.add(item.id);
      const product = await db.collection("products").doc(item.id).get();
      if (!product.exists) return res.status(400).json({ success: false, error: "Producto no encontrado" });
      const data = product.data();
      const priceCents = Math.round(Number(data.price) * 100);
      if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || Number(data.stock) < item.quantity) {
        return res.status(400).json({ success: false, error: "Precio o inventario inválido" });
      }
      calculatedCents += priceCents * item.quantity;
      validatedItems.push({ id: item.id, name: String(data.name || ""), price: priceCents / 100, quantity: item.quantity });
    }
    const amountCents = calculatedCents;
    if (Math.round(Number(amount) * 100) !== amountCents) {
      return res.status(400).json({ success: false, error: "El total del carrito cambió; actualiza tu carrito" });
    }


    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({
        success: false,
        error: "Monto inválido"
      });
    }

    const orderRef = db.collection("orders").doc(checkoutId);

    await orderRef.set({
      items: validatedItems,
      total: amountCents / 100,
      email,
      shipping: shipping || null,
      paymentMethod: "Stripe",
      paymentId: null,
      paymentStatus: null,
      status: "Pending Payment",
      stockUpdated: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      metadata: {
        email: email || "",
        orderId: checkoutId,
        product: "Grand Hustles Order",
        items: JSON.stringify(validatedItems)
      },
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never"
      },
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
    }, {
      idempotencyKey: `grand-hustles-${checkoutId}`
    });

    await orderRef.set({
      paymentId: paymentIntent.id,
      paymentStatus: paymentIntent.status,
      status: paymentIntent.status === "succeeded" ? "Paid" : "Pending Payment",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(
      "PAYMENT STATUS:",
      paymentIntent.status
    );


    return res.status(200).json({

      success: true,

      paymentId: paymentIntent.id,

      status: paymentIntent.status,

      clientSecret: paymentIntent.client_secret

    });


  } catch (error) {

    console.error(
      "Stripe error:",
      error.message
    );


    return res.status(400).json({

      success: false,

      error: error.message

    });
  }
};
