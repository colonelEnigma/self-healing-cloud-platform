const { Kafka } = require("kafkajs");

if (!process.env.KAFKA_BROKER) {
  throw new Error("KAFKA_BROKER is not set for search-service");
}

const kafka = new Kafka({
  clientId: "search-service",
  brokers: [process.env.KAFKA_BROKER],
});

module.exports = kafka;