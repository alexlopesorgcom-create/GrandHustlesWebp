const Stripe = require("stripe");
const { db, admin } = require("./firebaseAdmin");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const MAX_ORDER_ITEMS = 50;
const MAX_ITEM_QUANTITY = 20;
const RESERVATION_MINUTES = 20;

class CheckoutError extends Error {}

function isValidEmail(email) {
  return typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeShipping(shipping) {
  if (!shipping || typeof shipping !== "object") {
    return null;
  }

  const fields = ["firstName", "lastName", "address", "city", "state", "zip"];
  const normalized = {};
  for (const field of fields) {
    const value = shipping[field];
    if (typeof value !== "string" || !value.trim() || value.length > 120) {
      throw new CheckoutError("La dirección de envío está incompleta o no es válida.");
    }
    normalized[field] = value.trim();
  }
  return normalized;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ORDER_ITEMS) {
    throw new CheckoutError("El carrito no es válido.");
  }

  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,150}$/.test(item.id) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      throw new CheckoutError("Un producto del carrito no es válido.");
    }

    const size = typeof item.size === "string" ? item.size.trim() : "";
    if (size.length > 40) {
      throw new CheckoutError("La variante seleccionada no es válida.");
    }

    const key = `${item.id}:${size}`;
    if (seen.has(key)) {
      throw new CheckoutError("El carrito contiene productos duplicados.");
    }
    seen.add(key);
    normalized.push({ id: item.id, quantity: item.quantity, size });
  }
  return normalized;
}

async function releaseReservation(orderRef) {
  await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return;

    const order = orderSnapshot.data();
    if (order.stockReserved !== true || !Array.isArray(order.items)) return;

    const productIds = [...new Set(order.items.map((item) => item.id))];
    const productRefs = productIds.map((id) =>
      db.collection("products").doc(id)
    );
    const productSnapshots = [];
    for (const productRef of productRefs) {
      productSnapshots.push(await transaction.get(productRef));
    }

    productSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        const product = snapshot.data();
        const productItems = order.items.filter((item) => item.id === productIds[index]);
        if (product.stockBySize && typeof product.stockBySize === "object") {
          const stockBySize = { ...product.stockBySize };
          productItems.forEach((item) => {
            const stock = Number(stockBySize[item.size]);
            if (!item.size || !Number.isInteger(stock) ||
                !Number.isInteger(item.quantity) || item.quantity <= 0) {
              throw new Error("No se pudo restaurar el inventario por talla.");
            }
            stockBySize[item.size] = stock + item.quantity;
          });
          transaction.update(productRefs[index], {
            stockBySize,
            stock: Object.values(stockBySize).reduce((total, value) =>
              total + (Number(value) || 0), 0)
          });
        } else {
          const stock = Number(product.stock) || 0;
          const quantity = productItems.reduce((total, item) => total + item.quantity, 0);
          if (!Number.isInteger(stock) || !Number.isInteger(quantity) || quantity <= 0) {
            throw new Error("No se pudo restaurar el inventario del producto.");
          }
          transaction.update(productRefs[index], { stock: stock + quantity });
        }
      }
    });

    transaction.update(orderRef, {
      stockReserved: false,
      status: "Payment Failed",
      paymentStatus: "failed",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

module.exports = async (req, res) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(origin && !allowedOrigins.includes(origin) ? 403 : 204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Método no permitido"
    });
  }

  try {

    const body = req.body || {};
    const { paymentMethodId, email, checkoutId } = body;
    if (typeof checkoutId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId)) {
      return res.status(400).json({ success: false, error: "Identificador de compra no válido." });
    }
    if (typeof paymentMethodId !== "string" || !/^pm_[A-Za-z0-9]+$/.test(paymentMethodId)) {
      return res.status(400).json({ success: false, error: "Método de pago no válido." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: "Correo electrónico no válido." });
    }

    const requestedItems = normalizeItems(body.items);
    const shipping = normalizeShipping(body.shipping);
    if (!shipping) {
      return res.status(400).json({
        success: false,
        error: "Por ahora solo están disponibles las órdenes con dirección de envío."
      });
    }
    const shippingCents = Number(process.env.SHIPPING_RATE_CENTS);
    if (!Number.isInteger(shippingCents) || shippingCents <= 0) {
      return res.status(503).json({
        success: false,
        error: "El envío aún no está configurado. El pago no se procesó."
      });
    }
    const orderRef = db.collection("orders").doc(checkoutId);

    const existingOrder = await orderRef.get();
    if (existingOrder.exists) {
      const order = existingOrder.data();
      if (order.paymentId) {
        const existingIntent = await stripe.paymentIntents.retrieve(order.paymentId);
        return res.status(200).json({
          success: true,
          paymentId: existingIntent.id,
          status: existingIntent.status,
          clientSecret: existingIntent.client_secret
        });
      }
      return res.status(409).json({
        success: false,
        error: "Esta compra ya se está procesando. Actualiza el carrito e inténtalo de nuevo."
      });
    }

    const productIds = [...new Set(requestedItems.map((item) => item.id))];
    const productRefs = productIds.map((id) =>
      db.collection("products").doc(id)
    );
    let canonicalItems = [];
    let subtotalCents = 0;
    let totalCents = 0;
    const reservationExpiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000)
    );

    await db.runTransaction(async (transaction) => {
      canonicalItems = [];
      subtotalCents = 0;
      totalCents = 0;
      const productSnapshots = [];
      for (const productRef of productRefs) {
        productSnapshots.push(await transaction.get(productRef));
      }
      const productsById = new Map(productIds.map((id, index) => [
        id,
        productSnapshots[index].exists ? productSnapshots[index].data() : null
      ]));
      canonicalItems = requestedItems.map((item) => {
        const product = productsById.get(item.id);
        if (!product) {
          throw new CheckoutError("Uno de los productos ya no está disponible.");
        }
        const price = Number(product.price);
        const stock = Number(product.stock) || 0;
        if (product.active === false ||
            !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock)) {
          throw new CheckoutError(`No hay stock suficiente para "${product.name || "un producto"}".`);
        }
        if (Array.isArray(product.sizes)) {
          const variantStock = product.stockBySize && Number(product.stockBySize[item.size]);
          if (!item.size || !product.sizes.includes(item.size) ||
              !Number.isInteger(variantStock) || variantStock < item.quantity) {
            throw new CheckoutError(`La talla seleccionada para "${product.name}" ya no está disponible.`);
          }
        } else if (item.size || stock < item.quantity) {
          throw new CheckoutError(`No hay stock suficiente para "${product.name || "un producto"}".`);
        }

        const unitAmount = Math.round(price * 100);
        subtotalCents += unitAmount * item.quantity;
        return {
          id: item.id,
          name: String(product.name || "Producto").slice(0, 160),
          price: unitAmount / 100,
          quantity: item.quantity,
          size: item.size || null
        };
      });

      totalCents = subtotalCents + shippingCents;
      if (totalCents <= 0 || totalCents > 10000000) {
        throw new CheckoutError("El total de la compra no es válido.");
      }

      productSnapshots.forEach((snapshot, index) => {
        const productId = productIds[index];
        const product = snapshot.data();
        const productItems = requestedItems.filter((item) => item.id === productId);
        if (Array.isArray(product.sizes)) {
          const stockBySize = { ...product.stockBySize };
          productItems.forEach((item) => {
            stockBySize[item.size] -= item.quantity;
          });
          transaction.update(productRefs[index], {
            stockBySize,
            stock: Object.values(stockBySize).reduce((total, value) =>
              total + (Number(value) || 0), 0)
          });
        } else {
          const quantity = productItems.reduce((total, item) => total + item.quantity, 0);
          transaction.update(productRefs[index], {
            stock: Number(product.stock) - quantity
          });
        }
      });
      transaction.create(orderRef, {
        items: canonicalItems,
        subtotal: subtotalCents / 100,
        shippingCost: shippingCents / 100,
        total: totalCents / 100,
        currency: "usd",
        email,
        shipping,
        paymentMethod: "Stripe",
        paymentId: null,
        paymentStatus: "processing",
        status: "Pending Payment",
        stockReserved: true,
        stockUpdated: false,
        reservationExpiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    let paymentIntentCreated = false;
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalCents,
        currency: "usd",
        metadata: {
          email,
          orderId: checkoutId,
          product: "DRPHVN Order"
        },
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never"
        },
        receipt_email: email,
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
        idempotencyKey: `drphvn-${checkoutId}`
      });
      paymentIntentCreated = true;

      await orderRef.update({
        paymentId: paymentIntent.id,
        paymentStatus: paymentIntent.status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (paymentIntent.status === "requires_payment_method" ||
          paymentIntent.status === "canceled") {
        await releaseReservation(orderRef);
      }

      return res.status(200).json({
        success: true,
        paymentId: paymentIntent.id,
        status: paymentIntent.status,
        clientSecret: paymentIntent.client_secret
      });
    } catch (error) {
      if (error.type === "StripeCardError") {
        const failedIntent = error.payment_intent;
        if (failedIntent) {
          await orderRef.update({
            paymentId: failedIntent.id,
            paymentStatus: failedIntent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        if (!failedIntent || failedIntent.status === "requires_payment_method" ||
            failedIntent.status === "canceled") {
          await releaseReservation(orderRef);
        }
      } else if (!paymentIntentCreated) {
        console.error("Payment intent creation did not complete; reservation will expire:", error.message);
      }
      throw error;
    }
  } catch (error) {
    console.error("Checkout failed:", error.message);
    const isStripeCardError = error.type === "StripeCardError";
    const statusCode = error instanceof CheckoutError
      ? 400
      : (isStripeCardError ? 402 : 500);
    return res.status(statusCode).json({
      success: false,
      error: statusCode === 400 || isStripeCardError
        ? error.message
        : "No se pudo procesar el pago. Inténtalo de nuevo más tarde."
    });
  }
};
