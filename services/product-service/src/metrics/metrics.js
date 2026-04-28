const client = require("prom-client");

// collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics();

// custom metrics
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
});

const kafkaMessagesConsumed = new client.Counter({
  name: "kafka_messages_consumed_total",
  help: "Total Kafka messages consumed",
});

const kafkaProcessingDuration = new client.Histogram({
  name: "kafka_processing_duration_seconds",
  help: "Time taken to process Kafka message",
});

const kafkaProcessingErrors = new client.Counter({
  name: "kafka_processing_errors_total",
  help: "Total Kafka processing errors",
});

// retry attempts
const kafkaRetryAttempts = new client.Counter({
  name: "kafka_retry_attempts_total",
  help: "Total number of Kafka retry attempts",
  labelNames: ["service"],
});

// DLQ messages
const kafkaDlqMessages = new client.Counter({
  name: "kafka_dlq_messages_total",
  help: "Total number of messages sent to DLQ",
  labelNames: ["service"],
});

const httpRequestCounter = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"],
});

module.exports = {
  client,
  httpRequestDuration,
  kafkaMessagesConsumed,
  kafkaProcessingDuration,
  kafkaProcessingErrors,
  kafkaRetryAttempts,
  kafkaDlqMessages,
  httpRequestCounter,
};
