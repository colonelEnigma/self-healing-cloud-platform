const {
  httpRequestDuration,
  httpRequestCounter,
} = require("../metrics/metrics");

const ignoredPaths = new Set([
  "/metrics",
  "/favicon.ico",
  "/.well-known/appspecific/com.chrome.devtools.json",
]);

const metricsMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    if (ignoredPaths.has(req.path)) {
      return;
    }

    const duration = (Date.now() - start) / 1000;

    // Use originalUrl so mounted routes like /api/... are preserved
    const route = req.originalUrl || req.path || "unknown";
    const status = String(res.statusCode);

    httpRequestCounter.inc({
      method: req.method,
      route,
      status,
    });

    httpRequestDuration
      .labels(req.method, route, status)
      .observe(duration);
  });

  next();
};

module.exports = metricsMiddleware;