const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,

  keyGenerator: (req) => {
    return req.user?.id || ipKeyGenerator(req);
  },

  message: {
    message: "Too many requests. Please slow down.",
  },

  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = globalLimiter;