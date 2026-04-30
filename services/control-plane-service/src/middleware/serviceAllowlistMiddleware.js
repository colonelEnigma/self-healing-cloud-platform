const { isAllowedDeployment } = require("../config/allowlist");

const requireAllowedServiceParam = (req, res, next) => {
  const { service } = req.params;

  if (!isAllowedDeployment(service)) {
    return res.status(400).json({
      message: "Service is not allowlisted for Control Plane access",
      service,
    });
  }

  return next();
};

module.exports = requireAllowedServiceParam;
