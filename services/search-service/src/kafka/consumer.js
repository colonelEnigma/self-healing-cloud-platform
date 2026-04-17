const kafka = require("./client");
const pool = require("../config/db");
const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "search-group" });

/**
 * Retry Kafka connection
 */
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
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  throw new Error("Kafka connection failed after retries");
};

/**
 * Business logic
 */
const processEvent = async (data, io) => {
  console.log("Search received:", data);

  const { orderId, userId, totalAmount } = data;

  await pool.query(
    `INSERT INTO orders_search (order_id, user_id, total_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, userId, totalAmount],
  );

  io.emit("order_created", {
    id: orderId,
    user_id,
    total_amount,
  });

  console.log(`Order indexed: ${orderId}`);
};

/**
 * Start consumer (resilient)
 */
const startConsumer = async (io) => {
  // small delay (helps in Kubernetes startup)
  await new Promise((res) => setTimeout(res, 5000));

  await connectWithRetry();

  let retries = 10;

  while (retries) {
    try {
      console.log("Subscribing to topic...");

      await consumer.subscribe({
        topic: "order_created",
        fromBeginning: true,
      });

      console.log("Starting consumer...");

      await consumer.run({
        eachMessage: async ({ message }) => {
          const start = Date.now();

          try {
            const data = JSON.parse(message.value.toString());

            await processEvent(data, io);

            kafkaMessagesConsumed.inc();
          } catch (err) {
            kafkaProcessingErrors.inc();
            console.error("Kafka processing error:", err.message);
          } finally {
            const duration = (Date.now() - start) / 1000;
            kafkaProcessingDuration.observe(duration);
          }
        },
      });

      console.log("Consumer running");
      return;
    } catch (err) {
      console.error("Kafka subscribe/run error:", err.message);
      retries--;

      await new Promise((res) => setTimeout(res, 5000));
    }
  }

  console.error("Consumer failed after retries, continuing without Kafka");
};

module.exports = startConsumer;
