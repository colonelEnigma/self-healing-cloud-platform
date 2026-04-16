const kafka = require("./client");
const pool = require("../config/db");

const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "payment-group" });

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
 * Business logic for payment-service
 */
const processEvent = async (data) => {
  console.log("💳 Payment received event:", data);

  const { eventType, orderId, userId, totalAmount } = data;

  // only process order created events
  if (eventType !== "ORDER_CREATED") {
    console.log("⏭ Ignoring event:", eventType);
    return;
  }

  if (!orderId || !userId || totalAmount == null) {
    throw new Error("Invalid event payload");
  }

  // simulate successful payment entry
  await pool.query(
    `INSERT INTO payments (order_id, user_id, amount, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, userId, totalAmount, "SUCCESS"]
  );

  console.log(`✅ Payment recorded for order: ${orderId}`);
};

/**
 * Start consumer
 */
const startConsumer = async () => {
  // small startup buffer for k8s
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

        try {
          const data = JSON.parse(message.value.toString());

          await processEvent(data);

          kafkaMessagesConsumed.inc();
        } catch (err) {
          kafkaProcessingErrors.inc();
          console.error("❌ Payment consumer error:", err.message);
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