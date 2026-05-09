const { validateDeploymentState } = require("../contracts/schemas");

const toDeploymentState = (payload) =>
  validateDeploymentState({
    service: payload?.service || payload?.name || null,
    status: payload?.status || null,
    desiredReplicas: payload?.desiredReplicas,
    readyReplicas: payload?.readyReplicas,
    unavailableReplicas: payload?.unavailableReplicas,
  });

module.exports = {
  toDeploymentState,
};
