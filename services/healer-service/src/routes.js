const express = require("express");
const router = express.Router();
const ALLOWED_ACTIONS = require("./config/actions");
const pool = require("./config/db");
const { appsApi, restartDeployment, scaleDeployment } = require("./services/k8s");
const recordAction = require("./services/recorder");

/* --- Cooldown logic --- */
const COOLDOWN_MS = 5 * 60 * 1000;
const healingCooldowns = new Map();
const getCooldownKey = (alertName, namespace, deployment) => `${alertName}:${namespace}:${deployment}`;
const isInCooldown = (key) => Date.now() - (healingCooldowns.get(key) || 0) < COOLDOWN_MS;
const markCooldown = (key) => healingCooldowns.set(key, Date.now());

/* --- Helpers --- */
const extractDeploymentName = (labels = {}) =>
  labels.deployment || labels.service || labels.app || labels.job;
const extractNamespace = (labels = {}) => labels.namespace || "unknown";

/* --- Routes --- */

// Health
router.get("/health", (req, res) => res.status(200).send("OK"));

// Heal
router.post("/heal", async (req, res) => {
  let alertName = "unknown", namespace = "unknown", deploymentName = "unknown";
  try {
    console.log("Received alert payload:", JSON.stringify(req.body));
    const alert = req.body?.alerts?.[0];
    const labels = alert?.labels || {};

    alertName = labels.alertname;
    namespace = extractNamespace(labels);
    deploymentName = extractDeploymentName(labels);

    if (!alertName) return res.status(400).send("Missing alertname");

    const policy = ALLOWED_ACTIONS[alertName];
    if (!policy) return res.status(200).send("No policy");
    if (!policy.enabled) return res.status(200).send("Notify only");
    if (!deploymentName) return res.status(400).send("Missing deployment");
    if (!policy.allowedNamespaces.includes(namespace)) return res.status(403).send("Namespace not allowed");
    if (!policy.allowedDeployments.includes(deploymentName)) return res.status(403).send("Deployment not allowed");

    const cooldownKey = getCooldownKey(alertName, namespace, deploymentName);
    if (isInCooldown(cooldownKey)) {
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

    const deployment = await appsApi.readNamespacedDeployment(deploymentName, namespace);
    const currentReplicas = deployment.body?.spec?.replicas ?? 0;

    if (currentReplicas === 0) {
      await scaleDeployment(namespace, deploymentName, 1);
      await recordAction({ 
        alertName,
        namespace, 
        deployment: deploymentName, 
        action: "scale", 
        result: "success", 
        reason: "replicas were 0" 
      });
      markCooldown(cooldownKey);
      return res.status(200).send("Scaled to 1");
    }

    await restartDeployment(namespace, deploymentName);
    await recordAction({ 
      alertName,
      namespace, 
      deployment: deploymentName, 
      action: "restart", 
      result: "success", 
      reason: "replicas already running" 
    });
    markCooldown(cooldownKey);
    return res.status(200).send("Restarted");
  } catch (err) {
    await recordAction({
      alertName,
      namespace, 
      deployment: deploymentName, 
      action: "unknown", 
      result: "error", 
      reason: err?.message || "unknown error" 
    });
    console.error("Healer error:", err?.body || err);
    return res.status(500).send("Error");
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
