const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "order-service",
  brokers: ["kafka:9092"], // Docker network
});

module.exports = kafka;
