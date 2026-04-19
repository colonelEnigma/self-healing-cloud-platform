const {
  httpRequestDuration,
  httpRequestCounter,
} = require("../metrics/metrics");

const metricsMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;

    const route = req.route?.path || req.path || "unknown";

    // ✅ Count requests
    httpRequestCounter.inc({
      method: req.method,
      route: route,
      status: res.statusCode,
    });

    // ✅ Measure latency
    httpRequestDuration
      .labels(req.method, route, res.statusCode)
      .observe(duration);
  });

  next();
};

module.exports = metricsMiddleware;