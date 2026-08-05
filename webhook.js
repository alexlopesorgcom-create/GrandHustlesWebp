module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const event = req.body;

  console.log("Stripe webhook recibido:", event.type);

  return res.status(200).json({
    received: true
  });
};
