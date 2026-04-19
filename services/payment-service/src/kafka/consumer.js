const kafka = require("./client");
const pool = require("../config/db");

const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
  kafkaRetryAttempts,
  kafkaDlqMessages,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "payment-group" });
const producer = kafka.producer();

const SERVICE_NAME = "payment-service";

/**
 * Retry helper
 */
const retry = async (fn, retries = 3, delay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      kafkaRetryAttempts.inc({ service: SERVICE_NAME });
      console.error(`🔁 Retry ${i + 1} failed:`, err.message);

      if (i === retries - 1) throw err;

      await new Promise((res) => setTimeout(res, delay));
    }
  }
};

/**
 * Kafka connection with retry
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
const processEvent = async (data) => {
  console.log("💳 Payment received event:", data);

  const { eventType, orderId, userId, totalAmount } = data;

  if (eventType !== "ORDER_CREATED") {
    console.log("⏭ Ignoring event:", eventType);
    return;
  }

  if (!orderId || !userId || totalAmount == null) {
    throw new Error("Invalid event payload");
  }

  throw new Error("FORCED_FAILURE");

  await pool.query(
    `INSERT INTO payments (order_id, user_id, amount, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, userId, totalAmount, "SUCCESS"]
  );

  console.log(`✅ Payment recorded for order: ${orderId}`);
};

/**
 * Send to DLQ
 */
const sendToDLQ = async (data, error) => {
  kafkaDlqMessages.inc({ service: SERVICE_NAME });
  console.error("☠️ Sending event to DLQ:", error.message);

  await producer.send({
    topic: "order_created_dlq",
    messages: [
      {
        value: JSON.stringify({
          source: SERVICE_NAME,
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
const startConsumer = async () => {
  await new Promise((res) => setTimeout(res, 3000));

  await connectWithRetry();

  try {
    await consumer.subscribe({
      topic: "order_created",
      fromBeginning: false,
    });

    console.log("💳 Payment consumer subscribed to order_created");

    await consumer.run({
      eachMessage: async ({ message }) => {
        const start = Date.now();
        let data;

        try {
          data = JSON.parse(message.value.toString());

          await retry(() => processEvent(data));

          kafkaMessagesConsumed.inc();
        } catch (err) {
          kafkaProcessingErrors.inc();
          console.error("❌ Payment consumer error:", err.message);

          if (data) {
            await sendToDLQ(data, err);
          }
        } finally {
          const duration = (Date.now() - start) / 1000;
          kafkaProcessingDuration.observe(duration);
        }
      },
    });

    console.log("🚀 Payment consumer running");
  } catch (err) {
    console.error("❌ Kafka consumer failed:", err.message);
  }
};

module.exports = startConsumer;