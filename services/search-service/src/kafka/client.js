const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "search-service",
  brokers: ["kafka:9092"],
});

module.exports = kafka;
