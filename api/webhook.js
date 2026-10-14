const Stripe = require("stripe");
const { db, admin } = require("./firebaseAdmin");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw new Error("Falta STRIPE_WEBHOOK_SECRET en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function inventoryUpdate(product, items, direction) {
  const variantInventory = product.stockBySize &&
    typeof product.stockBySize === "object";
  if (variantInventory) {
    const stockBySize = { ...product.stockBySize };
    for (const item of items) {
      const current = Number(stockBySize[item.size]);
      if (!item.size || !Number.isInteger(current) ||
          !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error("La orden contiene una variante sin inventario configurado.");
      }
      const next = current + direction * item.quantity;
      if (next < 0) {
        throw new Error("El inventario ya no alcanza para completar la orden.");
      }
      stockBySize[item.size] = next;
    }
    return {
      stockBySize,
      stock: Object.values(stockBySize).reduce((total, value) =>
        total + (Number(value) || 0), 0)
    };
  }

  if (items.some((item) => item.size)) {
    throw new Error("La orden incluye tallas, pero el producto no administra inventario por talla.");
  }
  const current = Number(product.stock);
  const quantity = items.reduce((total, item) => total + item.quantity, 0);
  const next = current + direction * quantity;
  if (!Number.isInteger(current) || next < 0) {
    throw new Error("El inventario ya no alcanza para completar la orden.");
  }
  return { stock: next };
}

async function findOrder(paymentIntent) {
  const orderId = paymentIntent.metadata && paymentIntent.metadata.orderId;
  if (orderId) {
    const order = await db.collection("orders").doc(orderId).get();
    if (order.exists) return order;
  }

  const orders = await db.collection("orders")
    .where("paymentId", "==", paymentIntent.id)
    .limit(1)
    .get();
  return orders.empty ? null : orders.docs[0];
}

async function processSucceededPayment(event, paymentIntent, orderSnapshot) {
  if (!orderSnapshot) {
    throw new Error(`No se encontró la orden del pago ${paymentIntent.id}`);
  }

  const orderRef = orderSnapshot.ref;
  const eventRef = db.collection("stripeEvents").doc(event.id);

  await db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (eventSnapshot.exists) return;

    const currentOrderSnapshot = await transaction.get(orderRef);
    if (!currentOrderSnapshot.exists) {
      throw new Error(`La orden ${orderRef.id} ya no existe`);
    }

    const order = currentOrderSnapshot.data();
    const expectedAmount = Math.round(Number(order.total) * 100);
    if (!Number.isSafeInteger(expectedAmount) ||
        expectedAmount !== paymentIntent.amount ||
        paymentIntent.currency !== (order.currency || "usd")) {
      throw new Error(`El importe o la moneda no coincide con la orden ${orderRef.id}`);
    }

    const shouldDeductStock = order.status !== "Paid" &&
      order.stockReserved !== true &&
      order.stockUpdated !== true;
    const itemsByProduct = new Map();
    for (const item of order.items || []) {
      const items = itemsByProduct.get(item.id) || [];
      items.push({
        size: item.size || null,
        quantity: Number(item.quantity)
      });
      itemsByProduct.set(
        item.id,
        items
      );
    }

    const productRefs = shouldDeductStock
      ? [...itemsByProduct.keys()].map((id) => db.collection("products").doc(id))
      : [];
    const productSnapshots = [];
    for (const productRef of productRefs) {
      productSnapshots.push(await transaction.get(productRef));
    }

    if (shouldDeductStock) {
      const productIds = [...itemsByProduct.keys()];
      productSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) {
          throw new Error(`No hay inventario suficiente para completar la orden ${orderRef.id}`);
        }
        const updates = inventoryUpdate(
          snapshot.data(),
          itemsByProduct.get(productIds[index]),
          -1
        );
        transaction.update(productRefs[index], updates);
      });
    }

    transaction.update(orderRef, {
      status: "Paid",
      paymentStatus: "succeeded",
      stockReserved: false,
      stockUpdated: true,
      paymentId: paymentIntent.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.create(eventRef, {
      type: event.type,
      orderId: orderRef.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

async function processFailedPayment(event, paymentIntent, orderSnapshot) {
  if (!orderSnapshot) {
    console.error("Payment failure has no matching order:", paymentIntent.id);
    return;
  }

  const orderRef = orderSnapshot.ref;
  const eventRef = db.collection("stripeEvents").doc(event.id);

  await db.runTransaction(async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    if (eventSnapshot.exists) return;

    const currentOrderSnapshot = await transaction.get(orderRef);
    if (!currentOrderSnapshot.exists) {
      throw new Error(`La orden ${orderRef.id} ya no existe`);
    }

    const order = currentOrderSnapshot.data();
    const shouldRestoreStock = order.stockReserved === true &&
      order.status !== "Paid";
    const itemsByProduct = new Map();
    if (shouldRestoreStock) {
      for (const item of order.items || []) {
        const items = itemsByProduct.get(item.id) || [];
        items.push({
          size: item.size || null,
          quantity: Number(item.quantity)
        });
        itemsByProduct.set(
          item.id,
          items
        );
      }
    }

    const productIds = [...itemsByProduct.keys()];
    const productRefs = productIds.map((id) => db.collection("products").doc(id));
    const productSnapshots = [];
    for (const productRef of productRefs) {
      productSnapshots.push(await transaction.get(productRef));
    }

    productSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists) {
        transaction.update(productRefs[index], inventoryUpdate(
          snapshot.data(),
          itemsByProduct.get(productIds[index]),
          1
        ));
      }
    });

    transaction.update(orderRef, {
      status: order.status === "Paid" ? "Paid" : "Payment Failed",
      paymentStatus: order.status === "Paid" ? order.paymentStatus : "failed",
      stockReserved: false,
      paymentId: paymentIntent.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.create(eventRef, {
      type: event.type,
      orderId: orderRef.id,
      processedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

async function webhookHandler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signature = req.headers["stripe-signature"];
  let event;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    event = stripe.webhooks.constructEvent(
      Buffer.concat(chunks),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET.trim()
    );
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  try {
    if (event.type === "payment_intent.succeeded" ||
        event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object;
      const orderSnapshot = await findOrder(paymentIntent);
      if (event.type === "payment_intent.succeeded") {
        await processSucceededPayment(event, paymentIntent, orderSnapshot);
      } else {
        await processFailedPayment(event, paymentIntent, orderSnapshot);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

webhookHandler.config = {
  api: {
    bodyParser: false
  }
};

module.exports = webhookHandler;
