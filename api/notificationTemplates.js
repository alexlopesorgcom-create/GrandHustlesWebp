"use strict";

// Pure notification templates. No network calls or secret credentials here.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function orderPaidEmail(order) {
  if (!order || typeof order.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(order.id)) {
    throw new Error("Invalid order ID");
  }
  if (!Number.isSafeInteger(order.totalCents) || order.totalCents < 0) {
    throw new Error("Invalid order total");
  }
  const amount = (order.totalCents / 100).toFixed(2);
  return {
    subject: "DRPHVN | Confirmación de tu pedido " + order.id,
    text: "¡Gracias por comprar en DRPHVN!\nPedido: " + order.id +
      "\nTotal: $" + amount + " USD\nTe avisaremos cuando haya novedades sobre tu envío.",
    html: "<h1>¡Gracias por tu compra!</h1><p>Pedido: <strong>" +
      escapeHtml(order.id) + "</strong></p><p>Total: $" + amount +
      " USD</p><p>Te avisaremos cuando haya novedades sobre tu envío.</p>"
  };
}

function newSaleEmail(order) {
  const customer = order && order.customerEmail;
  if (typeof customer !== "string" || customer.length > 254 || /[\r\n]/.test(customer)) {
    throw new Error("Invalid customer email");
  }
  const base = orderPaidEmail(order);
  return {
    subject: "DRPHVN | Nueva venta " + order.id,
    text: "Nueva venta confirmada.\nPedido: " + order.id +
      "\nCliente: " + customer + "\nTotal: $" + (order.totalCents / 100).toFixed(2) + " USD",
    html: "<h1>Nueva venta confirmada</h1><p>Pedido: " +
      escapeHtml(order.id) + "</p><p>Cliente: " + escapeHtml(customer) +
      "</p><p>Total: $" + (order.totalCents / 100).toFixed(2) + " USD</p>"
  };
}

module.exports = { escapeHtml, orderPaidEmail, newSaleEmail };
