const kafka = require("./client");
const pool = require("../config/db");
const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "payment-group" });

/**
 * Handles the business logic for processing an incoming Kafka event.
 */
const processEvent = async (data, pool) => {
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
};

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

  console.log("Payment Service Kafka Consumer running");

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const start = Date.now();

      try {
        const data = JSON.parse(message.value.toString());

        // 👉 your existing logic now lives in processEvent
        await processEvent(data, pool);

        kafkaMessagesConsumed.inc();
      } catch (err) {
        kafkaProcessingErrors.inc();
        console.error("Payment consumer error:", err.message);
      } finally {
        const duration = (Date.now() - start) / 1000;
        kafkaProcessingDuration.observe(duration);
      }
    },
  });
};

module.exports = startConsumer;
