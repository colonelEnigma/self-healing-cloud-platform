const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const requireAdmin = require("../middleware/adminMiddleware");
const requireAllowedServiceParam = require("../middleware/serviceAllowlistMiddleware");
const {
  getStatus,
  getOverview,
  getDeployments,
  getServiceDetail,
  getHealingHistoryHandler,
  getAlerts,
  getCombinedLogs,
  getServiceLogsHandler,
  getServiceEventsHandler,
  postScaleAction,
  getControlPlaneActions,
} = require("../controllers/controlPlaneController");

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get("/status", getStatus);
router.get("/overview", getOverview);
router.get("/deployments", getDeployments);
router.get(
  "/services/:service",
  requireAllowedServiceParam,
  getServiceDetail,
);
router.get("/healing-history", getHealingHistoryHandler);
router.get("/alerts", getAlerts);
router.get("/logs", getCombinedLogs);
router.get(
  "/logs/:service",
  requireAllowedServiceParam,
  getServiceLogsHandler,
);
router.get(
  "/events/:service",
  requireAllowedServiceParam,
  getServiceEventsHandler,
);
router.post("/actions/scale", postScaleAction);
router.get("/actions", getControlPlaneActions);

module.exports = router;
