const Stripe = require("stripe");
const { db, admin } = require("./firebaseAdmin");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe webhook environment is not configured");
    return res.status(503).json({ error: "Webhook unavailable" });
  }

  let event;
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    event = Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(
      Buffer.concat(chunks),
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET.trim()
    );
  } catch (error) {
    console.error("Stripe webhook verification failed:", error.message);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  if (!["payment_intent.succeeded", "payment_intent.payment_failed"].includes(event.type)) {
    return res.status(200).json({ received: true });
  }
  const intent = event.data?.object;
  if (!intent || typeof intent !== "object") return res.status(400).json({ error: "Invalid payment event" });
  const orderId = intent.metadata?.orderId;
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(orderId)) {
    console.error("Stripe event missing valid orderId", event.id);
    return res.status(500).json({ error: "Order reconciliation required" });
  }

  const orderRef = db.collection("orders").doc(orderId);
  try {
    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error("Order not found");
      const order = orderSnap.data();
      if (typeof intent.id !== "string" || !intent.id.startsWith("pi_")) throw new Error("Invalid Stripe payment intent");
      if (order.paymentId && order.paymentId !== intent.id) {
        throw new Error("Payment intent does not match order");
      }
      if (!Number.isSafeInteger(intent.amount) || intent.amount <= 0 || Math.round(Number(order.total) * 100) !== intent.amount || intent.currency !== "usd") {
        throw new Error("Payment amount or currency mismatch");
      }
      if (order.stockUpdated === true) {
        if (order.paymentId !== intent.id || order.paymentStatus !== "succeeded") throw new Error("Inconsistent settled order");
        return;
      }
      if (order.paymentStatus === "succeeded" && event.type === "payment_intent.payment_failed") return;
      if (event.type === "payment_intent.succeeded" && intent.status !== "succeeded") throw new Error("Inconsistent successful payment event");

      if (event.type === "payment_intent.payment_failed") {
        tx.update(orderRef, {
          paymentId: intent.id,
          paymentStatus: "failed",
          status: "Payment Failed",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      // Read all products before performing any writes, as Firestore transactions require.
      const items = order.items;
      if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error("Missing or oversized order items");
      const quantities = new Map();
      for (const item of items) {
        if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
          throw new Error("Invalid order item");
        }
        const totalQuantity = (quantities.get(item.id) || 0) + item.quantity;
        if (!Number.isSafeInteger(totalQuantity) || totalQuantity > 100) throw new Error("Order quantity limit exceeded");
        quantities.set(item.id, totalQuantity);
      }
      const productRefs = [...quantities.keys()].sort().map(id => db.collection("products").doc(id));
      const productSnaps = await Promise.all(productRefs.map(ref => tx.get(ref)));
      productSnaps.forEach((snap, i) => {
        if (!snap.exists || !Number.isSafeInteger(snap.data().stock) ||
            snap.data().stock < quantities.get(snap.id)) {
          throw new Error("Insufficient stock for " + snap.id);
        }
      });
      productSnaps.forEach((snap, i) => {
        tx.update(productRefs[i], { stock: snap.data().stock - quantities.get(snap.id) });
      });
      tx.update(orderRef, {
        paymentId: intent.id,
        paymentStatus: "succeeded",
        status: "Paid",
        stockUpdated: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(db.collection("notifications").doc("paid_" + orderId), {
        type: "order_paid",
        orderId,
        paymentId: intent.id,
        total: order.total,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
  } catch (error) {
    console.error("Stripe webhook processing failed:", event.id, error.message);
    // Non-2xx allows Stripe to retry; an operator must resolve persistent stock conflicts.
    return res.status(500).json({ error: "Webhook processing failed" });
  }
  return res.status(200).json({ received: true });
};

// Preserve raw request bytes for Stripe signature verification.
module.exports.config = { api: { bodyParser: false } };
