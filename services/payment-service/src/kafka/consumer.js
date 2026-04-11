const kafka = require("./client");
const pool = require("../config/db");

const consumer = kafka.consumer({ groupId: "payment-group" });

const startConsumer = async () => {
  const connectWithRetry = async () => {
    const maxRetries = 10;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        console.log(`Kafka connect attempt ${attempt + 1}`);
        await consumer.connect();
        console.log("Kafka connected");
        return;
      } catch (err) {
        console.error("Kafka connection failed, retrying...");
        attempt++;
        await new Promise((res) => setTimeout(res, 3000)); // wait 3 sec
      }
    }

    throw new Error("Kafka connection failed after retries");
  };

  await connectWithRetry();

  await consumer.subscribe({ topic: "order_created", fromBeginning: true });

  console.log("Search Service Kafka Consumer running");

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const data = JSON.parse(message.value.toString());

        console.log("Received event:", data);

        const { orderId, total_amount } = data;

        // 🔥 Auto create payment
        await pool.query(
          `INSERT INTO payments (order_id, amount, status)
           VALUES ($1, $2, $3)
           ON CONFLICT (order_id) DO NOTHING`,
          [orderId, total_amount, "success"],
        );

        console.log(`Payment created for order: ${orderId}`);
      } catch (err) {
        console.error("Payment consumer error:", err.message);
      }
    },
  });
};

module.exports = startConsumer;
