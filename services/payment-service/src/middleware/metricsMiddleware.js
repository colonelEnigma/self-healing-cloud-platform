const {
  httpRequestDuration,
  httpRequestCounter,
} = require("../metrics/metrics");

const ignoredPaths = new Set([
  "/metrics",
  "/favicon.ico",
  "/.well-known/appspecific/com.chrome.devtools.json",
]);

const normalizeRoute = (req) => {
  const routePath = req.route?.path;

  if (req.baseUrl && routePath) {
    return `${req.baseUrl}${routePath}`;
  }

  return routePath || req.path || "unknown";
};

const metricsMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    if (ignoredPaths.has(req.path)) {
      return;
    }

    const duration = (Date.now() - start) / 1000;
    const route = normalizeRoute(req);
    const statusCode = String(res.statusCode);

    httpRequestCounter.inc({
      method: req.method,
      route,
      status_code: statusCode,
    });

    httpRequestDuration
      .labels(req.method, route, statusCode)
      .observe(duration);
  });

  next();
};

module.exports = metricsMiddleware;
