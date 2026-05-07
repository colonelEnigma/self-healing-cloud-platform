const k8s = require("@kubernetes/client-node");
const fs = require("fs");
const { PassThrough } = require("stream");
const { once } = require("events");
const {
  CONTROL_PLANE_NAMESPACE,
  ALLOWED_APP_DEPLOYMENTS,
} = require("../config/allowlist");

let cachedClients;

const strategicMergePatchOptions = {
  headers: { "Content-Type": "application/strategic-merge-patch+json" },
};

const IN_CLUSTER_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const IN_CLUSTER_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
const IN_CLUSTER_NAMESPACE_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasFile = (filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    return false;
  }
};

const hasInClusterCredentials = () =>
  Boolean(process.env.KUBERNETES_SERVICE_HOST) &&
  Boolean(process.env.KUBERNETES_SERVICE_PORT) &&
  hasFile(IN_CLUSTER_TOKEN_PATH) &&
  hasFile(IN_CLUSTER_CA_PATH) &&
  hasFile(IN_CLUSTER_NAMESPACE_PATH);

const getKubernetesClients = () => {
  if (cachedClients) {
    return cachedClients;
  }

  const kc = new k8s.KubeConfig();
  const loadErrors = [];
  let loaded = false;

  if (hasInClusterCredentials()) {
    try {
      kc.loadFromCluster();
      loaded = true;
    } catch (clusterErr) {
      loadErrors.push(`in-cluster config failed: ${clusterErr.message}`);
    }
  } else if (
    process.env.KUBERNETES_SERVICE_HOST ||
    process.env.KUBERNETES_SERVICE_PORT
  ) {
    loadErrors.push(
      "in-cluster env detected but service-account files are missing",
    );
  }

  if (!loaded) {
    try {
      kc.loadFromDefault();
      loaded = true;
    } catch (defaultErr) {
      loadErrors.push(`default kubeconfig failed: ${defaultErr.message}`);
    }
  }

  if (!loaded) {
    throw new Error(
      "Could not load Kubernetes config. " +
        loadErrors.join(" | ") +
        " | If testing locally via docker-compose, run control-plane-service in cluster or mount a kubeconfig into the container.",
    );
  }

  cachedClients = {
    appsApi: kc.makeApiClient(k8s.AppsV1Api),
    coreApi: kc.makeApiClient(k8s.CoreV1Api),
    log: new k8s.Log(kc),
  };

  return cachedClients;
};

const getPodReadiness = (pod) => {
  const statuses = pod?.status?.containerStatuses || [];
  const readyContainers = statuses.filter((status) => status.ready).length;
  const totalContainers = statuses.length;
  const restartCount = statuses.reduce(
    (sum, status) => sum + (status.restartCount || 0),
    0,
  );

  return { readyContainers, totalContainers, restartCount };
};

const summarizePod = (pod) => {
  const readiness = getPodReadiness(pod);

  return {
    name: pod?.metadata?.name,
    phase: pod?.status?.phase || "unknown",
    readyContainers: readiness.readyContainers,
    totalContainers: readiness.totalContainers,
    restartCount: readiness.restartCount,
    startTime: pod?.status?.startTime || null,
    nodeName: pod?.spec?.nodeName || null,
    podIP: pod?.status?.podIP || null,
  };
};

const listPodsByService = async (service) => {
  const { coreApi } = getKubernetesClients();
  const response = await coreApi.listNamespacedPod(
    CONTROL_PLANE_NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=${service}`,
  );

  return (response.body?.items || []).sort((a, b) => {
    const aTime = new Date(
      a?.status?.startTime || a?.metadata?.creationTimestamp || 0,
    ).getTime();
    const bTime = new Date(
      b?.status?.startTime || b?.metadata?.creationTimestamp || 0,
    ).getTime();
    return bTime - aTime;
  });
};

const listDeployments = async () => {
  const { appsApi } = getKubernetesClients();
  const response = await appsApi.listNamespacedDeployment(CONTROL_PLANE_NAMESPACE);
  return response.body?.items || [];
};

const mapDeploymentToSummary = (deployment, pods = []) => {
  if (!deployment) {
    return null;
  }

  const desiredReplicas = deployment.spec?.replicas ?? 0;
  const readyReplicas = deployment.status?.readyReplicas ?? 0;
  const availableReplicas = deployment.status?.availableReplicas ?? 0;
  const containerSpec = deployment.spec?.template?.spec?.containers || [];
  const mainContainer =
    containerSpec.find((container) => container.name === deployment.metadata?.name) ||
    containerSpec[0] ||
    null;

  let status = "degraded";
  if (desiredReplicas === 0 && readyReplicas === 0) {
    status = "scaled_down";
  } else if (availableReplicas >= desiredReplicas && desiredReplicas > 0) {
    status = "healthy";
  } else if (desiredReplicas === 0) {
    status = "scaled_down";
  }

  return {
    service: deployment.metadata?.name,
    namespace: deployment.metadata?.namespace,
    status,
    desiredReplicas,
    readyReplicas,
    availableReplicas,
    updatedReplicas: deployment.status?.updatedReplicas ?? 0,
    unavailableReplicas: deployment.status?.unavailableReplicas ?? 0,
    image: mainContainer?.image || null,
    selector: deployment.spec?.selector?.matchLabels || {},
    observedGeneration: deployment.status?.observedGeneration ?? null,
    createdAt: deployment.metadata?.creationTimestamp || null,
    conditions: (deployment.status?.conditions || []).map((condition) => ({
      type: condition.type,
      status: condition.status,
      reason: condition.reason || null,
      message: condition.message || null,
      lastUpdateTime: condition.lastUpdateTime || condition.lastTransitionTime || null,
    })),
    pods: pods.map(summarizePod),
  };
};

const getAllowlistedDeploymentSummaries = async () => {
  const deployments = await listDeployments();
  const deploymentByName = new Map(
    deployments
      .filter((deployment) =>
        ALLOWED_APP_DEPLOYMENTS.includes(deployment?.metadata?.name || ""),
      )
      .map((deployment) => [deployment.metadata.name, deployment]),
  );

  const summaries = await Promise.all(
    ALLOWED_APP_DEPLOYMENTS.map(async (service) => {
      const deployment = deploymentByName.get(service);
      if (!deployment) {
        return {
          service,
          namespace: CONTROL_PLANE_NAMESPACE,
          status: "not_found",
          desiredReplicas: 0,
          readyReplicas: 0,
          availableReplicas: 0,
          updatedReplicas: 0,
          unavailableReplicas: 0,
          image: null,
          selector: {},
          observedGeneration: null,
          createdAt: null,
          conditions: [],
          pods: [],
        };
      }

      const pods = await listPodsByService(service);
      return mapDeploymentToSummary(deployment, pods);
    }),
  );

  return summaries;
};

const getServiceDeploymentSummary = async (service) => {
  const { appsApi } = getKubernetesClients();
  const deploymentResponse = await appsApi.readNamespacedDeployment(
    service,
    CONTROL_PLANE_NAMESPACE,
  );

  const pods = await listPodsByService(service);
  return mapDeploymentToSummary(deploymentResponse.body, pods);
};

const listReplicaSetsByService = async (service) => {
  const { appsApi } = getKubernetesClients();
  const response = await appsApi.listNamespacedReplicaSet(
    CONTROL_PLANE_NAMESPACE,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=${service}`,
  );

  return (response.body?.items || []).map((replicaSet) => ({
    name: replicaSet.metadata?.name,
    desiredReplicas: replicaSet.spec?.replicas ?? 0,
    readyReplicas: replicaSet.status?.readyReplicas ?? 0,
    availableReplicas: replicaSet.status?.availableReplicas ?? 0,
    createdAt: replicaSet.metadata?.creationTimestamp || null,
    labels: replicaSet.metadata?.labels || {},
  }));
};

const listEventsByFieldSelector = async (fieldSelector, limit = 30) => {
  const { coreApi } = getKubernetesClients();
  const response = await coreApi.listNamespacedEvent(
    CONTROL_PLANE_NAMESPACE,
    undefined,
    undefined,
    undefined,
    fieldSelector,
    undefined,
    limit,
  );

  return response.body?.items || [];
};

const normalizeEvent = (event) => ({
  name: event.metadata?.name,
  reason: event.reason || null,
  type: event.type || null,
  message: event.message || null,
  count: event.count || 1,
  firstTimestamp: event.firstTimestamp || event.eventTime || null,
  lastTimestamp: event.lastTimestamp || event.eventTime || null,
  involvedObject: event.involvedObject
    ? {
        kind: event.involvedObject.kind || null,
        name: event.involvedObject.name || null,
      }
    : null,
});

const getServiceEvents = async (service) => {
  const pods = await listPodsByService(service);
  const eventBatches = [];

  eventBatches.push(
    listEventsByFieldSelector(`involvedObject.kind=Deployment,involvedObject.name=${service}`),
  );

  for (const pod of pods.slice(0, 5)) {
    if (pod?.metadata?.name) {
      eventBatches.push(
        listEventsByFieldSelector(
          `involvedObject.kind=Pod,involvedObject.name=${pod.metadata.name}`,
        ),
      );
    }
  }

  const eventsNested = await Promise.all(eventBatches);
  const seen = new Set();
  const deduped = [];

  for (const batch of eventsNested) {
    for (const event of batch) {
      const key = `${event.metadata?.name}:${event.metadata?.uid}:${event.lastTimestamp || event.eventTime || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(event);
      }
    }
  }

  return deduped
    .sort((a, b) => {
      const aTime = new Date(
        a?.lastTimestamp ||
          a?.eventTime ||
          a?.metadata?.creationTimestamp ||
          0,
      ).getTime();
      const bTime = new Date(
        b?.lastTimestamp ||
          b?.eventTime ||
          b?.metadata?.creationTimestamp ||
          0,
      ).getTime();
      return bTime - aTime;
    })
    .slice(0, 50)
    .map(normalizeEvent);
};

const readPodLog = async ({ podName, containerName, tailLines = 200 }) => {
  const { log } = getKubernetesClients();
  const stream = new PassThrough();
  let output = "";

  stream.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });

  const finishPromise = once(stream, "finish");
  await log.log(CONTROL_PLANE_NAMESPACE, podName, containerName, stream, {
    follow: false,
    tailLines,
    timestamps: true,
  });

  await Promise.race([finishPromise, wait(250)]);
  return output;
};

const getServiceLogs = async (service, options = {}) => {
  const tailLines = Math.min(
    Math.max(Number.parseInt(options.tailLines, 10) || 200, 10),
    500,
  );
  const maxPods = Math.min(
    Math.max(Number.parseInt(options.maxPods, 10) || 3, 1),
    5,
  );

  const pods = await listPodsByService(service);
  const selectedPods = pods.slice(0, maxPods);
  const entries = [];

  for (const pod of selectedPods) {
    const podName = pod?.metadata?.name;
    const containerName = pod?.spec?.containers?.[0]?.name;
    if (!podName || !containerName) {
      continue;
    }

    try {
      const logText = await readPodLog({ podName, containerName, tailLines });
      entries.push({
        service,
        pod: podName,
        container: containerName,
        log: logText || "",
      });
    } catch (err) {
      entries.push({
        service,
        pod: podName,
        container: containerName,
        log: "",
        error: err.message,
      });
    }
  }

  return {
    service,
    namespace: CONTROL_PLANE_NAMESPACE,
    tailLines,
    podCount: entries.length,
    entries,
  };
};

const scaleServiceDeployment = async ({ service, replicas }) => {
  const { appsApi } = getKubernetesClients();
  const deployment = await appsApi.readNamespacedDeployment(
    service,
    CONTROL_PLANE_NAMESPACE,
  );
  const previousReplicas = deployment.body?.spec?.replicas ?? 0;

  if (previousReplicas !== replicas) {
    await appsApi.patchNamespacedDeployment(
      service,
      CONTROL_PLANE_NAMESPACE,
      { spec: { replicas } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      strategicMergePatchOptions,
    );
  }

  return {
    previousReplicas,
    requestedReplicas: replicas,
    changed: previousReplicas !== replicas,
  };
};

const patchServiceContainerImage = async ({ service, containerName, image }) => {
  const { appsApi } = getKubernetesClients();
  const deployment = await appsApi.readNamespacedDeployment(
    service,
    CONTROL_PLANE_NAMESPACE,
  );

  const containers = deployment.body?.spec?.template?.spec?.containers || [];
  const container =
    containers.find((c) => c.name === containerName) ||
    containers.find((c) => c.name === service) ||
    containers[0];

  if (!container || !container.name) {
    throw new Error(`Container ${containerName || "auto"} not found in deployment ${service}`);
  }

  await appsApi.patchNamespacedDeployment(
    service,
    CONTROL_PLANE_NAMESPACE,
    { 
      spec: { 
        template: { 
          spec: { 
            containers: [{ name: container.name, image }],
          } 
        } 
      } 
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    strategicMergePatchOptions,
  );

  return {
    containerName: container.name,
    previousImage: container.image || null,
    requestedImage: image,
    changed: container.image !== image,
  };
};

module.exports = {
  getKubernetesClients,
  getAllowlistedDeploymentSummaries,
  getServiceDeploymentSummary,
  listReplicaSetsByService,
  getServiceEvents,
  getServiceLogs,
  scaleServiceDeployment,
  patchServiceContainerImage,
};
