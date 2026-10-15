const Stripe = require("stripe");
const { db, admin } = require("./firebaseAdmin");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {

  // Checkout is same-origin. Do not reflect arbitrary Origin headers.
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método no permitido"
    });
  }

  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, error: "Datos de pago invalidos" });
    }

    const {
      paymentMethodId,
      amount,
      email,
      checkoutId,
      items,
      shipping
    } = req.body;

    if (typeof checkoutId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(checkoutId)) {
      return res.status(400).json({
        success: false,
        error: "Falta checkoutId"
      });
    }

    if (typeof paymentMethodId !== "string" || !/^pm_[A-Za-z0-9]+$/.test(paymentMethodId) || typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
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
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        return res.status(400).json({ success: false, error: "Cantidad o producto inválido" });
      }
      if (item.id.length > 256 || item.id.includes("/") || item.id === "." || item.id === "..") return res.status(400).json({ success: false, error: "ID de producto inválido" });
      if (seenProducts.has(item.id)) return res.status(400).json({ success: false, error: "Producto duplicado en carrito" });
      seenProducts.add(item.id);
      const product = await db.collection("products").doc(item.id).get();
      if (!product.exists) return res.status(400).json({ success: false, error: "Producto no encontrado" });
      const data = product.data();
      if (data.active === false || data.published === false) {
        return res.status(400).json({ success: false, error: "Producto no disponible" });
      }
      if (typeof data.price !== "number" || !Number.isFinite(data.price) || !Number.isSafeInteger(Math.round(data.price * 100)) || Math.abs(data.price * 100 - Math.round(data.price * 100)) > 0.000001) {
        return res.status(400).json({ success: false, error: "Precio del producto inválido" });
      }
      const priceCents = Math.round(data.price * 100);
      if (!Number.isSafeInteger(priceCents) || priceCents <= 0 || !Number.isSafeInteger(data.stock) || data.stock < item.quantity) {
        return res.status(400).json({ success: false, error: "Precio o inventario inválido" });
      }
      calculatedCents += priceCents * item.quantity;
      if (!Number.isSafeInteger(calculatedCents) || calculatedCents > 99999999) {
        return res.status(400).json({ success: false, error: "Total fuera del límite permitido" });
      }
      validatedItems.push({ id: item.id, name: String(data.name || ""), price: priceCents / 100, quantity: item.quantity });
    }
    const amountCents = calculatedCents;
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) {
      return res.status(400).json({ success: false, error: "El importe total no cumple el mínimo de pago" });
    }
    if (typeof amount !== "number" || !Number.isFinite(amount) || Math.round(amount * 100) !== amountCents) {
      return res.status(400).json({ success: false, error: "El total del carrito cambió; actualiza tu carrito" });
    }


    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({
        success: false,
        error: "Monto inválido"
      });
    }

    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return res.status(400).json({ success: false, error: "Correo electrónico inválido" });
    }
    if (!shipping || typeof shipping !== "object" || Array.isArray(shipping) || !["firstName","lastName","address","city","state","zip"].every(k => typeof shipping[k] === "string" && shipping[k].trim().length > 0 && shipping[k].length <= 200)) {
      return res.status(400).json({ success: false, error: "Dirección de entrega incompleta" });
    }

    // The server owns order creation; a reused checkout ID cannot overwrite a prior order.
    const orderRef = db.collection("orders").doc(checkoutId);

    try {
      await orderRef.create({
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
      });
    } catch (error) {
      if (error.code === 6 || error.code === "already-exists") {
        return res.status(409).json({ success: false, error: "Este pedido ya existe. Revisa su estado antes de pagar otra vez." });
      }
      throw error;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      metadata: {
        email: email || "",
        orderId: checkoutId,
        product: "DRPHVN Order"
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

    // A fast Stripe webhook may finish before this request. Never downgrade a paid order.
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(orderRef);
      if (!snapshot.exists) throw new Error("Order disappeared before payment confirmation");
      const order = snapshot.data();
      if (order.paymentId && order.paymentId !== paymentIntent.id) {
        throw new Error("Conflicting payment intent for order");
      }
      const fields = {
        paymentId: paymentIntent.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      if (order.stockUpdated !== true && order.paymentStatus !== "succeeded") {
        fields.paymentStatus = paymentIntent.status;
      }
      tx.update(orderRef, fields);
    });

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

      error: "No se pudo completar el pago. Verifica el estado del pedido antes de intentar de nuevo."

    });
  }
};
