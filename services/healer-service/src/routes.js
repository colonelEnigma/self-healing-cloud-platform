const express = require("express");
const router = express.Router();
const ALLOWED_ACTIONS = require("./config/actions");
const pool = require("./config/db");
const { appsApi, restartDeployment, scaleDeployment } = require("./services/k8s");
const recordAction = require("./services/recorder");
const { isRateLimited } = require("./services/rateLimiter");
const { retryAsync } = require("./services/retry");
const { isCircuitOpen } = require("./services/circuitBreaker");

/* --- Cooldown logic --- */
const healingCooldowns = new Map();

const getCooldownKey = (alertName, namespace, deployment) =>
  `${alertName}:${namespace}:${deployment}`;

const isInCooldown = (key, cooldownSeconds) => {
  if (!cooldownSeconds || cooldownSeconds <= 0) return false;

  const lastActionTime = healingCooldowns.get(key);
  if (!lastActionTime) return false;

  return Date.now() - lastActionTime < cooldownSeconds * 1000;
};

const markCooldown = (key, cooldownSeconds) => {
  if (!cooldownSeconds || cooldownSeconds <= 0) return;

  healingCooldowns.set(key, Date.now());
};

/* --- Helpers --- */
const extractDeploymentName = (labels = {}) =>
  labels.deployment || labels.service || labels.app || labels.job;
const extractNamespace = (labels = {}) => labels.namespace || "unknown";

/* --- Routes --- */

// Health
router.get("/health", (req, res) => res.status(200).send("OK"));

// Heal
router.post("/heal", async (req, res) => {
  let alertName = "unknown", namespace = "unknown", deploymentName = "unknown", action = "unknown";
  try {
    console.log("Received alert payload:", JSON.stringify(req.body));
    const alert = req.body?.alerts?.[0];
    const labels = alert?.labels || {};

    alertName = labels.alertname;
    namespace = extractNamespace(labels);
    deploymentName = extractDeploymentName(labels);

    if (!alertName) return res.status(400).send("Missing alertname");

    const policy = ALLOWED_ACTIONS[alertName];
    action = policy?.action || "unknown";
    if (!policy) return res.status(200).send("No policy");
    if (!policy.enabled) return res.status(200).send("Notify only");
    if (!deploymentName) return res.status(400).send("Missing deployment");
    if (!policy.allowedNamespaces.includes(namespace)) return res.status(403).send("Namespace not allowed");
    if (!policy.allowedDeployments.includes(deploymentName)) return res.status(403).send("Deployment not allowed");

    const cooldownKey = getCooldownKey(alertName, namespace, deploymentName);
    if (isInCooldown(cooldownKey, policy.cooldownSeconds)) {
      await recordAction({ 
        alertName,
        namespace,
        deployment: deploymentName, 
        action: policy.action, 
        result: "blocked", 
        reason: "cooldown active" 
      });
      return res.status(200).send("Cooldown active");
    }

    // Rate Limit Check
    const rateLimitStatus = await isRateLimited({
      alertName,
      namespace,
      deployment: deploymentName,
      maxActionsPerWindow: policy.maxActionsPerWindow,
      windowMinutes: policy.windowMinutes,
    });

    if (rateLimitStatus.limited) {
      const reason = `rate limit exceeded: ${rateLimitStatus.actionCount}/${rateLimitStatus.maxActionsPerWindow} actions in ${rateLimitStatus.windowMinutes} minutes`;

      await recordAction({
        alertName,
        namespace,
        deployment: deploymentName,
        action: policy.action,
        result: "blocked",
        reason,
      });
      return res.status(200).send(reason);
    }

    //Circuit Breaker Check
    const circuitStatus = await isCircuitOpen({
      alertName,
      namespace,
      deployment: deploymentName,
      failureThreshold: policy.circuitBreakerFailureThreshold,
      windowMinutes: policy.circuitBreakerWindowMinutes,
    });

    if (circuitStatus.open) {
      const reason = `circuit breaker open: ${circuitStatus.failureCount}/${circuitStatus.failureThreshold} failures in ${circuitStatus.windowMinutes} minutes`;

      await recordAction({
        alertName,
        namespace,
        deployment: deploymentName,
        action: policy.action,
        result: "blocked",
        reason,
      });

      return res.status(200).send(reason);
    }

    const deployment = await retryAsync({
      actionName: "read deployment",
      retries: policy.retryAttempts,
      baseDelayMs: policy.retryBaseDelayMs,
      fn: () => appsApi.readNamespacedDeployment(deploymentName, namespace),
    });
    
    const currentReplicas = deployment.body?.spec?.replicas ?? 0;

    if (currentReplicas === 0) {
      await retryAsync({
        actionName: "scale deployment",
        retries: policy.retryAttempts,
        baseDelayMs: policy.retryBaseDelayMs,
        fn: () => scaleDeployment(namespace, deploymentName, 1),
      });
      
      await recordAction({ 
        alertName,
        namespace, 
        deployment: deploymentName, 
        action: "scale", 
        result: "success", 
        reason: "replicas were 0" 
      });
      markCooldown(cooldownKey, policy.cooldownSeconds);
      return res.status(200).send("Scaled to 1");
    }

    await retryAsync({
      actionName: "restart deployment",
      retries: policy.retryAttempts,
      baseDelayMs: policy.retryBaseDelayMs,
      fn: () => restartDeployment(namespace, deploymentName),
    });
    
    await recordAction({ 
      alertName,
      namespace, 
      deployment: deploymentName, 
      action: "restart", 
      result: "success", 
      reason: "replicas already running" 
    });
    markCooldown(cooldownKey, policy.cooldownSeconds);
    return res.status(200).send("Restarted");
  } 
  catch (err) {
    console.error("Unhandled healer error:", err);

    try {
      await recordAction({
        alertName: alertName || "unknown",
        namespace: namespace || "unknown",
        deployment: deploymentName || "unknown",
        action: action || "unknown",
        result: "error",
        reason: err.message || "unknown error",
      });
    } catch (recordErr) {
      console.error("Failed to record healer error:", recordErr.message);
    }

    return res.status(500).json({
      error: "healer failed",
      message: err.message,
    });
  }
});

// History
router.get("/history", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const offset = (page - 1) * limit;
    const sort = req.query.sort === "asc" ? "ASC" : "DESC";
    const conditions = [];
    const values = [];

    if (req.query.namespace) {
      values.push(req.query.namespace);
      conditions.push(`namespace = $${values.length}`);
    }

    if (req.query.deployment) {
      values.push(req.query.deployment);
      conditions.push(`deployment = $${values.length}`);
    }

    if (req.query.result) {
      values.push(req.query.result);
      conditions.push(`result = $${values.length}`);
    }

    if (req.query.alertName) {
      values.push(req.query.alertName);
      conditions.push(`alert_name = $${values.length}`);
    }

    if (req.query.from) {
      values.push(req.query.from);
      conditions.push(`created_at >= $${values.length}`);
    }

    if (req.query.to) {
      values.push(req.query.to);
      conditions.push(`created_at <= $${values.length}`);
    }

    // Build dynamic WHERE conditions
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM healing_actions ${whereClause}`,
      values
    );

    const dataValues = [...values, limit, offset];

    const result = await pool.query(
      `
      SELECT id, alert_name, namespace, deployment, action, result, reason, created_at
      FROM healing_actions
      ${whereClause}
      ORDER BY created_at ${sort}
      LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}
      `,
      dataValues
    );

    const total = countResult.rows[0].total;
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      page,
      limit,
      total,
      totalPages,
      sort: sort.toLowerCase(),
      count: result.rows.length,
      actions: result.rows,
    });
  } catch (err) {
    console.error("History fetch error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch history",
    });
  }
});

module.exports = router;
