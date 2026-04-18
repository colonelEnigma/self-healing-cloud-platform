const kafka = require("./client");
const pool = require("../config/db");
const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "search-group" });
const producer = kafka.producer();

const retry = async (fn, retries = 3, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      console.error(`🔁 Retry ${i + 1} failed:`, err.message);

      if (i === retries - 1) throw err;

      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

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
      await producer.connect();
      console.log("Kafka connected");
      return;
    } catch (err) {
      console.error("Kafka connection failed, retrying...", err.message);
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

  const { eventType, orderId, userId, totalAmount } = data;

  if (eventType !== "ORDER_CREATED") {
    console.log("⏭ Ignoring event:", eventType);
    return;
  }

  if (!orderId || !userId || totalAmount == null) {
    throw new Error("Invalid event payload");
  }

  await pool.query(
    `INSERT INTO orders_search (order_id, user_id, total_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, userId, totalAmount]
  );

  if (io) {
    io.emit("order_created", {
      id: orderId,
      user_id: userId,
      total_amount: totalAmount,
    });
  }

  console.log(`📌 Order indexed: ${orderId}`);
};

/**
 * Send to DLQ
 */
const sendToDLQ = async (data, error) => {
  console.error("☠️ Sending search event to DLQ:", error.message);

  await producer.send({
    topic: "order_created_dlq",
    messages: [
      {
        value: JSON.stringify({
          source: "search-service",
          originalEvent: data,
          error: error.message,
          failedAt: new Date().toISOString(),
        }),
      },
    ],
  });
};

/**
 * Start consumer
 */
const startConsumer = async (io) => {
  await new Promise((res) => setTimeout(res, 5000));

  await connectWithRetry();

  let retries = 10;

  while (retries) {
    try {
      console.log("Subscribing to topic...");

      await consumer.subscribe({
        topic: "order_created",
        fromBeginning: false,
      });

      console.log("Starting consumer...");

      await consumer.run({
        eachMessage: async ({ message }) => {
          const start = Date.now();
          let data;

          try {
            data = JSON.parse(message.value.toString());

            await retry(() => processEvent(data, io));

            kafkaMessagesConsumed.inc();
          } catch (err) {
            kafkaProcessingErrors.inc();
            console.error("Kafka processing error:", err.message);

            if (data) {
              await sendToDLQ(data, err);
            }
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