const crypto = require("crypto");
const Stripe = require("stripe");
const { db, admin } = require("./firebaseAdmin");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Falta STRIPE_SECRET_KEY en las variables de entorno");
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function hasValidCronSecret(req) {
  const expected = process.env.CRON_SECRET || "";
  const authorization = req.headers.authorization || "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expected.length >= 32 &&
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function inventoryUpdate(product, items) {
  if (product.stockBySize && typeof product.stockBySize === "object") {
    const stockBySize = { ...product.stockBySize };
    for (const item of items) {
      const stock = Number(stockBySize[item.size]);
      if (!item.size || !Number.isInteger(stock) ||
          !Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new Error("La orden contiene una variante sin inventario válido.");
      }
      stockBySize[item.size] = stock + item.quantity;
    }
    return {
      stockBySize,
      stock: Object.values(stockBySize).reduce((total, value) =>
        total + (Number(value) || 0), 0)
    };
  }

  if (items.some((item) => item.size)) {
    throw new Error("La orden contiene una talla sin inventario configurado.");
  }
  const stock = Number(product.stock);
  const quantity = items.reduce((total, item) => total + Number(item.quantity), 0);
  if (!Number.isInteger(stock) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("El inventario de la orden no es válido.");
  }
  return { stock: stock + quantity };
}

async function releaseOrder(orderRef, expiresBefore) {
  await db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) return;

    const order = orderSnapshot.data();
    const expiresAt = order.reservationExpiresAt;
    if (order.stockReserved !== true ||
        !expiresAt || expiresAt.toMillis() > expiresBefore.toMillis()) {
      return;
    }

    const itemsByProduct = new Map();
    for (const item of order.items || []) {
      const productItems = itemsByProduct.get(item.id) || [];
      productItems.push({
        size: item.size || null,
        quantity: Number(item.quantity)
      });
      itemsByProduct.set(item.id, productItems);
    }

    const productIds = [...itemsByProduct.keys()];
    const productRefs = productIds.map((id) => db.collection("products").doc(id));
    const productSnapshots = [];
    for (const productRef of productRefs) {
      productSnapshots.push(await transaction.get(productRef));
    }

    productSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        throw new Error(`Producto no encontrado al liberar la orden ${orderRef.id}`);
      }
      transaction.update(productRefs[index], inventoryUpdate(
        snapshot.data(),
        itemsByProduct.get(productIds[index])
      ));
    });

    transaction.update(orderRef, {
      status: "Cancelled",
      paymentStatus: order.paymentId ? "canceled" : "expired",
      stockReserved: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!hasValidCronSecret(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = admin.firestore.Timestamp.now();
  const expiredOrders = await db.collection("orders")
    .where("reservationExpiresAt", "<=", now)
    .limit(100)
    .get();
  let released = 0;
  let skipped = 0;

  for (const orderSnapshot of expiredOrders.docs) {
    const order = orderSnapshot.data();
    if (order.stockReserved !== true) {
      skipped += 1;
      continue;
    }

    try {
      if (order.paymentId) {
        let intent = await stripe.paymentIntents.retrieve(order.paymentId);
        if (intent.status === "succeeded" || intent.status === "processing") {
          skipped += 1;
          continue;
        }
        if (intent.status !== "canceled") {
          intent = await stripe.paymentIntents.cancel(intent.id);
        }
        if (intent.status !== "canceled") {
          skipped += 1;
          continue;
        }
      }

      await releaseOrder(orderSnapshot.ref, now);
      released += 1;
    } catch (error) {
      console.error(`Could not release expired order ${orderSnapshot.id}:`, error.message);
      skipped += 1;
    }
  }

  return res.status(200).json({ checked: expiredOrders.size, released, skipped });
};
