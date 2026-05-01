const axios = require("axios");
const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
} = require("../config/allowlist");

const prometheusClient = axios.create({
  baseURL: process.env.PROMETHEUS_BASE_URL || "http://prometheus:9090",
  timeout: 7000,
});

const healerClient = axios.create({
  baseURL:
    process.env.HEALER_BASE_URL ||
    "http://healer-service.default.svc.cluster.local:7000",
  timeout: 7000,
});

const orderServiceClient = axios.create({
  baseURL:
    process.env.ORDER_SERVICE_BASE_URL ||
    "http://order-service.prod.svc.cluster.local:3003",
  timeout: 5000,
});

const toAlertService = (labels = {}) =>
  labels.deployment || labels.service || labels.app || labels.job || null;

const queryPrometheus = async (query) => {
  const response = await prometheusClient.get("/api/v1/query", {
    params: { query },
  });

  if (response.data?.status !== "success") {
    throw new Error("Prometheus query failed");
  }

  return response.data?.data?.result || [];
};

const getServiceHealthFromPrometheus = async () => {
  const health = {};

  for (const service of ALLOWED_APP_DEPLOYMENTS) {
    let result = await queryPrometheus(
      `up{namespace="${CONTROL_PLANE_NAMESPACE}",service="${service}"}`,
    );

    if (!result.length) {
      result = await queryPrometheus(
        `up{namespace="${CONTROL_PLANE_NAMESPACE}",deployment="${service}"}`,
      );
    }

    if (!result.length) {
      result = await queryPrometheus(`up{job="${service}"}`);
    }

    if (!result.length) {
      health[service] = { status: "unknown", value: null };
      continue;
    }

    const sample = result[0];
    const rawValue = Number.parseFloat(sample.value?.[1] || "0");

    health[service] = {
      status: rawValue >= 1 ? "up" : "down",
      value: rawValue,
      metric: sample.metric || {},
      sampledAt: sample.value?.[0] || null,
    };
  }

  return health;
};

const getAlertsFromPrometheus = async () => {
  const response = await prometheusClient.get("/api/v1/alerts");
  const alerts = response.data?.data?.alerts || [];

  return alerts
    .filter((alert) => {
      const labels = alert.labels || {};
      const namespace = labels.namespace || labels.kubernetes_namespace;
      const service = toAlertService(labels);

      if (namespace && namespace !== CONTROL_PLANE_NAMESPACE) {
        return false;
      }

      if (!service) {
        return false;
      }

      return isAllowedDeployment(service);
    })
    .map((alert) => ({
      state: alert.state || "unknown",
      name: alert.labels?.alertname || null,
      service: toAlertService(alert.labels || {}),
      namespace:
        alert.labels?.namespace || alert.labels?.kubernetes_namespace || null,
      severity: alert.labels?.severity || null,
      summary: alert.annotations?.summary || null,
      description: alert.annotations?.description || null,
      activeAt: alert.activeAt || null,
      value: alert.value ?? null,
      labels: alert.labels || {},
    }));
};

const getHealingHistory = async (params = {}) => {
  const response = await healerClient.get("/history", {
    params: {
      namespace: CONTROL_PLANE_NAMESPACE,
      ...params,
    },
  });

  return response.data;
};

const getOrderServiceResilience = async () => {
  const response = await orderServiceClient.get("/internal/resilience");
  return response.data;
};

module.exports = {
  getServiceHealthFromPrometheus,
  getAlertsFromPrometheus,
  getHealingHistory,
  getOrderServiceResilience,
};
