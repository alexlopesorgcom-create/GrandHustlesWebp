module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido"
    });
  }

  try {
    const event = req.body;

    console.log("Stripe webhook recibido:", event.type);

    return res.status(200).json({
      received: true
    });

  } catch (error) {
    console.error("Webhook error:", error.message);

    return res.status(400).json({
      error: error.message
    });
  }
};
