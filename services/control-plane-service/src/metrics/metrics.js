const client = require("prom-client");

client.collectDefaultMetrics({
  prefix: "control_plane_",
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests handled by control-plane-service",
  labelNames: ["method", "route", "status_code"],
});

module.exports = {
  client,
  httpRequestsTotal,
};
