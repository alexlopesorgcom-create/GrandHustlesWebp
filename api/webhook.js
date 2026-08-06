const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const { db, admin } = require("./firebaseAdmin");

module.exports.config = {
  api: {
    bodyParser: false
  }
};

module.exports = async (req, res) => {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const sig = req.headers["stripe-signature"];

  let event;

  try {

    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const rawBody = Buffer.concat(chunks);

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET.trim()
    );

  } catch (err) {

    console.error(
      "Webhook signature error:",
      err.message
    );

    return res.status(400).json({
      error: `Webhook Error: ${err.message}`
    });

  }


  console.log(
    "Stripe event:",
    event.type
  );


  switch (event.type) {


    case "payment_intent.succeeded":


      const paymentIntent = event.data.object;


      console.log(
        "Payment confirmed:",
        paymentIntent.id
      );


      const ordersSnapshot = await db.collection("orders")
        .where("paymentId", "==", paymentIntent.id)
        .limit(1)
        .get();



      if (!ordersSnapshot.empty) {


        const orderDoc = ordersSnapshot.docs[0];

        const orderData = orderDoc.data();



        if (orderData.stockUpdated !== true) {


          await db.runTransaction(async (transaction) => {


            for (const item of orderData.items) {


              const productRef = db.collection("products")
                .doc(item.id);



              const productSnap = await transaction.get(productRef);



              if (!productSnap.exists) {

                throw new Error(
                  `Product not found: ${item.id}`
                );

              }



              const currentStock = productSnap.data().stock || 0;



              if (currentStock < item.quantity) {

                throw new Error(
                  `Not enough stock for ${item.name}`
                );

              }



              transaction.update(productRef, {

                stock: currentStock - item.quantity

              });


            }



            transaction.update(orderDoc.ref, {

              status: "Paid",

              paymentStatus: "succeeded",

              stockUpdated: true,

              updatedAt: admin.firestore.FieldValue.serverTimestamp()

            });



          });



          console.log(
            "Stock updated for order:",
            orderDoc.id
          );


        } else {


          console.log(
            "Stock already updated:",
            orderDoc.id
          );


        }



      } else {


        console.log(
          "Order not found for payment:",
          paymentIntent.id
        );


      }



      break;



    case "payment_intent.payment_failed":


      console.log(
        "Payment failed:",
        event.data.object.id
      );


      break;



    default:


      console.log(
        "Unhandled event:",
        event.type
      );


  }



  return res.status(200).json({
    received: true
  });


};
