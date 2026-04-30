const CONTROL_PLANE_NAMESPACE = "prod";

const ALLOWED_APP_DEPLOYMENTS = Object.freeze([
  "user-service",
  "order-service",
  "payment-service",
  "product-service",
  "search-service",
]);

const isAllowedDeployment = (deployment) =>
  ALLOWED_APP_DEPLOYMENTS.includes(deployment);

module.exports = {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
  isAllowedDeployment,
};
