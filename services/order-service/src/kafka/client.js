const { Kafka } = require("kafkajs");

const broker = process.env.KAFKA_BROKER;

const kafka = broker
  ? new Kafka({
      clientId: "order-service",
      brokers: [broker],
    })
  : null;

module.exports = kafka;