const { Kafka } = require("kafkajs");

const ORDER_CREATED_TOPIC = process.env.ORDER_CREATED_TOPIC || "order_created";
const ORDER_CREATED_DLQ_TOPIC = process.env.ORDER_CREATED_DLQ_TOPIC || "order_created_dlq";

const {
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
  kafkaRetryAttempts,
  kafkaDlqMessages,
} = require("../metrics/metrics");


if (!process.env.KAFKA_BROKER) {
  throw new Error("KAFKA_BROKER is not set for product-service");
}

const kafka = new Kafka({
  clientId: "product-service",
  brokers: [process.env.KAFKA_BROKER],
});


const consumer = kafka.consumer({ groupId: "product-service-group" });
const producer = kafka.producer();

const SERVICE_NAME = "product-service";
const start = Date.now();

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
 * Connect Kafka
 */
const connectWithRetry = async () => {
  let retries = 10;

  while (retries) {
    try {
      await consumer.connect();
      await producer.connect();
      console.log("Kafka connected");
      return;
    } catch (err) {
      console.error("Kafka connection failed, retrying...");
      retries--;
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  throw new Error("Kafka connection failed");
};

/**
 * Business logic
 */
const processEvent = async (event) => {
  console.log("📩 Event received:", event);

  if (event.eventType !== "ORDER_CREATED") {
    console.log("⏭ Ignoring event:", event.eventType);
    return;
  }

  if (!event.items || !Array.isArray(event.items)) {
    throw new Error("Invalid event payload: items missing");
  }

  for (const item of event.items) {
    const { product_id, quantity } = item;

    if (!product_id || !quantity) {
      throw new Error("Invalid item payload");
    }

    console.log(
      `📉 Reduce stock for product=${product_id}, qty=${quantity}`
    );

    // TODO: DB update logic later
  }
};

/**
 * Send to DLQ
 */
const sendToDLQ = async (event, error) => {
  kafkaDlqMessages.inc({ service: SERVICE_NAME });
  console.error("☠️ Sending product event to DLQ:", error.message);

  await producer.send({
    topic: ORDER_CREATED_DLQ_TOPIC,
    messages: [
      {
        value: JSON.stringify({
          source: "product-service",
          originalEvent: event,
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
const runConsumer = async () => {
  await connectWithRetry();

  await consumer.subscribe({
    topic: ORDER_CREATED_TOPIC,
    fromBeginning: false,
  });

  console.log("📦 Product-service Kafka consumer started");

  await consumer.run({
    eachMessage: async ({ message }) => {
      let event;

      try {
        event = JSON.parse(message.value.toString());

        await retry(() => processEvent(event));
        kafkaMessagesConsumed.inc();
      } catch (err) {
        kafkaProcessingErrors.inc();
        console.error("❌ Product consumer error:", err.message);

        if (event) {
          await sendToDLQ(event, err);
        }
      } finally {
          const duration = (Date.now() - start) / 1000;
          kafkaProcessingDuration.observe(duration);
        }
    },
  });
};

module.exports = { runConsumer };