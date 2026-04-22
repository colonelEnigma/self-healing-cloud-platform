const { Kafka } = require("kafkajs");

if (!process.env.KAFKA_BROKER) {
  throw new Error("KAFKA_BROKER is not set for payment-service");
}

const kafka = new Kafka({
  clientId: "payment-service",
  brokers: [process.env.KAFKA_BROKER],
});

module.exports = kafka;