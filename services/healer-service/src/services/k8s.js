const k8s = require("@kubernetes/client-node");

const kc = new k8s.KubeConfig();
kc.loadFromCluster();
const appsApi = kc.makeApiClient(k8s.AppsV1Api);

const patchOptions = {
  headers: { "Content-Type": "application/strategic-merge-patch+json" },
};

const restartDeployment = async (namespace, deployment) => {
  return appsApi.patchNamespacedDeployment(
    deployment,
    namespace,
    {
      spec: {
        template: {
          metadata: {
            annotations: {
              "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
            },
          },
        },
      },
    },
    undefined, undefined, undefined, undefined, undefined, patchOptions
  );
};

const scaleDeployment = async (namespace, deployment, replicas) => {
  return appsApi.patchNamespacedDeployment(
    deployment,
    namespace,
    { spec: { replicas } },
    undefined, undefined, undefined, undefined, undefined, patchOptions
  );
};

module.exports = { appsApi, restartDeployment, scaleDeployment };
