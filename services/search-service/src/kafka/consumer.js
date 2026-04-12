const kafka = require("./client");
const pool = require("../config/db");
const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "search-group" });

/**
 * Handles the business logic for processing an incoming Kafka event.
 */
const processEvent = async (data, io, pool) => {
  console.log("Search received:", data);

  const { orderId, user_id, total_amount } = data;

  await pool.query(
    `INSERT INTO orders_search (order_id, user_id, total_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, user_id, total_amount],
  );

  io.emit("order_created", {
    id: data.orderId,
    user_id: data.user_id,
    total_amount: data.total_amount,
    status: data.status,
    created_at: data.created_at,
  });

  console.log(`Order indexed: ${orderId}`);
};

const startConsumer = async (io) => {
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
    eachMessage: async ({ topic, partition, message }) => {
      const start = Date.now();

      try {
        const data = JSON.parse(message.value.toString());

        // 👉 your existing logic now lives in processEvent
        await processEvent(data, io, pool);

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
};

module.exports = startConsumer;
