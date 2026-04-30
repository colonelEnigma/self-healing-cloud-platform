const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/adminMiddleware");
const requireAllowedServiceParam = require("../middleware/serviceAllowlistMiddleware");
const {
  ALLOWED_APP_DEPLOYMENTS,
  CONTROL_PLANE_NAMESPACE,
} = require("../config/allowlist");

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

const notImplemented = (feature) => (req, res) =>
  res.status(501).json({
    message: `${feature} is not implemented yet`,
    status: "not_implemented",
  });

router.get("/status", (req, res) => {
  res.status(200).json({
    service: "control-plane-service",
    status: "ready",
    namespaceScope: CONTROL_PLANE_NAMESPACE,
    allowedDeployments: ALLOWED_APP_DEPLOYMENTS,
  });
});

router.get("/overview", notImplemented("Control Plane overview"));
router.get("/deployments", notImplemented("Prod deployment list"));
router.get(
  "/services/:service",
  requireAllowedServiceParam,
  notImplemented("Service detail"),
);
router.get("/healing-history", notImplemented("Healing history"));
router.get("/alerts", notImplemented("Prometheus alert state"));
router.get("/logs", notImplemented("Combined prod service logs"));
router.get(
  "/logs/:service",
  requireAllowedServiceParam,
  notImplemented("Service logs"),
);
router.get(
  "/events/:service",
  requireAllowedServiceParam,
  notImplemented("Service events"),
);
router.post("/actions/scale", notImplemented("Guarded scale action"));
router.get("/actions", notImplemented("Manual action audit history"));

module.exports = router;
