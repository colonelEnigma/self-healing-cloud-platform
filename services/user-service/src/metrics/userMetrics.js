const client = require("prom-client");

// collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics();

// custom metrics
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
});

module.exports = {
  client,
  httpRequestDuration,
};
