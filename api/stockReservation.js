"use strict";

// Server-only stock reservation primitive. Do not call from browser code.
// Atomic Firestore transactions ensure that two buyers cannot reserve the last unit.
function validateLines(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new Error("Invalid reservation items");
  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 256 || item.id.includes("/") ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 100 || quantities.has(item.id)) {
      throw new Error("Invalid reservation item");
    }
    quantities.set(item.id, item.quantity);
  }
  return quantities;
}

async function reserveStock(db, orderRef, items, timestamp) {
  const quantities = validateLines(items);
  return db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    if (orderSnap.exists) throw new Error("Reservation already exists");
    const refs = [...quantities.keys()].sort().map(id => db.collection("products").doc(id));
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    for (const snap of snaps) {
      if (!snap.exists) throw new Error("Product unavailable");
      const product = snap.data();
      if (product.active === false || product.published === false ||
          !Number.isSafeInteger(product.stock) || product.stock < quantities.get(snap.id)) {
        throw new Error("Insufficient stock");
      }
    }
    for (let i = 0; i < refs.length; i++) {
      tx.update(refs[i], { stock: snaps[i].data().stock - quantities.get(snaps[i].id) });
    }
    tx.create(orderRef, {
      items,
      reservationStatus: "reserved",
      stockUpdated: false,
      paymentStatus: "pending",
      createdAt: timestamp
    });
  });
}

async function releaseStock(db, orderRef, timestamp, paymentCancellationVerified = false) {
  // Never return reserved inventory while a Stripe payment may still settle.
  if (paymentCancellationVerified !== true) throw new Error("Verified payment cancellation required");
  return db.runTransaction(async tx => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) throw new Error("Reservation not found");
    const order = orderSnap.data();
    if (order.reservationStatus === "released") return false;
    if (order.reservationStatus !== "reserved" || order.paymentStatus === "succeeded" || order.stockUpdated === true) {
      throw new Error("Reservation cannot be released");
    }
    const quantities = validateLines(order.items);
    const refs = [...quantities.keys()].sort().map(id => db.collection("products").doc(id));
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    for (const snap of snaps) {
      if (!snap.exists || !Number.isSafeInteger(snap.data().stock) ||
          !Number.isSafeInteger(snap.data().stock + quantities.get(snap.id))) {
        throw new Error("Cannot restore inventory");
      }
    }
    for (let i = 0; i < refs.length; i++) {
      tx.update(refs[i], { stock: snaps[i].data().stock + quantities.get(snaps[i].id) });
    }
    tx.update(orderRef, { reservationStatus: "released", updatedAt: timestamp });
    return true;
  });
}
module.exports = { validateLines, reserveStock, releaseStock };
