const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "product-service",
  brokers: [process.env.KAFKA_BROKER || "kafka:9092"],
});

const consumer = kafka.consumer({ groupId: "product-service-group" });

const runConsumer = async () => {
  await consumer.connect();
  await consumer.subscribe({ topic: "order_created", fromBeginning: false });

  console.log("📦 Product-service Kafka consumer started");

  await consumer.run({
    eachMessage: async ({ message }) => {
      const event = JSON.parse(message.value.toString());

      console.log("📩 Event received:", event);

      if (event.eventType === "ORDER_CREATED") {
        console.log(
          `📉 Reduce stock for product=${event.productId}, qty=${event.quantity}`
        );

        // TODO: DB update logic (you can implement later)
      }
    },
  });
};

module.exports = { runConsumer };