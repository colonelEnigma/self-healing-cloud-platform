const { httpRequestsTotal } = require("../metrics/metrics");

const metricsMiddleware = (req, res, next) => {
  res.on("finish", () => {
    const route = req.route?.path || req.path || "unknown";

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: String(res.statusCode),
    });
  });

  next();
};

module.exports = metricsMiddleware;
