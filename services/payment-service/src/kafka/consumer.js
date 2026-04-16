const kafka = require("./client");
const pool = require("../config/db");

const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
} = require("../metrics/metrics");

const consumer = kafka.consumer({ groupId: "search-group" });

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
      console.error("Kafka connection failed, retrying...");
      attempt++;
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  throw new Error("Kafka connection failed after retries");
};

/**
 * Business logic (indexing)
 */
const processEvent = async (data, io) => {
  console.log("🔍 Search received:", data);

  const { eventType, orderId, userId, totalAmount } = data;

  // ✅ only handle correct event
  if (eventType !== "ORDER_CREATED") {
    console.log("⏭ Ignoring event:", eventType);
    return;
  }

  if (!orderId) {
    throw new Error("Invalid event payload");
  }

  // 📦 Index into search table
  await pool.query(
    `INSERT INTO orders_search (order_id, user_id, total_amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId, userId, totalAmount]
  );

  // ⚡ realtime update (if socket enabled)
  if (io) {
    io.emit("order_created", {
      orderId,
      userId,
      totalAmount,
    });
  }

  console.log(`📌 Order indexed in search: ${orderId}`);
};

/**
 * Start consumer (clean + stable)
 */
const startConsumer = async (io) => {
  // small startup buffer (k8s safe)
  await new Promise((res) => setTimeout(res, 3000));

  await connectWithRetry();

  try {
    await consumer.subscribe({
      topic: "order_created",
      fromBeginning: false,
    });

    console.log("🔎 Search consumer subscribed to order_created");

    await consumer.run({
      eachMessage: async ({ message }) => {
        const start = Date.now();

        try {
          const data = JSON.parse(message.value.toString());

          await processEvent(data, io);

          kafkaMessagesConsumed.inc();
        } catch (err) {
          kafkaProcessingErrors.inc();
          console.error("❌ Search consumer error:", err.message);
        } finally {
          const duration = (Date.now() - start) / 1000;
          kafkaProcessingDuration.observe(duration);
        }
      },
    });

    console.log("🚀 Search consumer running");
  } catch (err) {
    console.error("❌ Kafka consumer failed:", err.message);
  }
};

module.exports = startConsumer;