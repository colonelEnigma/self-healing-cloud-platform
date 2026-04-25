const express = require("express");
const k8s = require("@kubernetes/client-node");

const app = express();
app.use(express.json());

const kc = new k8s.KubeConfig();
kc.loadFromCluster();

const appsApi = kc.makeApiClient(k8s.AppsV1Api);

const PORT = process.env.PORT || 3000;

const ALLOWED_ACTIONS = {
  ServiceDown: {
    enabled: true,
    action: "scale-or-restart",
    allowedNamespaces: ["dev"],
    allowedDeployments: [
      "payment-service",
      "order-service",
      "search-service",
      "product-service",
      "user-service",
    ],
  }, 

  KafkaDLQMessagesDetected: {
    enabled: false,
    action: "notify-only",
  },

  KafkaProcessingErrorsHigh: {
    enabled: false,
    action: "notify-only",
  },

  HighKafkaProcessingLatency: {
    enabled: false,
    action: "notify-only",
  },
};

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const patchOptions = {
  headers: {
    "Content-Type": "application/strategic-merge-patch+json",
  },
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    patchOptions
  );
};

const scaleDeployment = async (namespace, deployment, replicas) => {
  return appsApi.patchNamespacedDeployment(
    deployment,
    namespace,
    {
      spec: { replicas },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    patchOptions
  );
};

const extractDeploymentName = (labels = {}) => {
  return (
    labels.deployment ||
    labels.service ||
    labels.app ||
    labels.job
  );
};

const extractNamespace = (labels = {}) => {
  return labels.namespace || "dev";
};

app.post("/heal", async (req, res) => {
  try {
    console.log("Received alert payload:", JSON.stringify(req.body));

    const alert = req.body?.alerts?.[0];
    const labels = alert?.labels || {};

    const alertName = labels.alertname;
    const namespace = extractNamespace(labels);
    const deploymentName = extractDeploymentName(labels);

    if (!alertName) {
      return res.status(400).send("Missing alertname");
    }

    const policy = ALLOWED_ACTIONS[alertName];

    if (!policy) {
      console.log(`Ignored: no policy for alert=${alertName}`);
      return res.status(200).send("No policy");
    }

    if (!policy.enabled) {
      console.log(`Notify-only alert=${alertName}. No action taken.`);
      return res.status(200).send("Notify only");
    }

    if (!deploymentName) {
      console.log("Ignored: missing deployment/service label");
      return res.status(400).send("Missing deployment");
    }

    if (!policy.allowedNamespaces.includes(namespace)) {
      console.log(`Blocked namespace=${namespace}`);
      return res.status(403).send("Namespace not allowed");
    }

    if (!policy.allowedDeployments.includes(deploymentName)) {
      console.log(`Blocked deployment=${deploymentName}`);
      return res.status(403).send("Deployment not allowed");
    }

    console.log(
      `Policy matched: alert=${alertName}, namespace=${namespace}, deployment=${deploymentName}, action=${policy.action}`
    );

    const deployment = await appsApi.readNamespacedDeployment(
      deploymentName,
      namespace
    );

    const currentReplicas = deployment.body?.spec?.replicas ?? 0;

    if (currentReplicas === 0) {
      console.log(`Action: scale ${deploymentName} in ${namespace} to 1`);
      await scaleDeployment(namespace, deploymentName, 1);
      return res.status(200).send("Scaled to 1");
    }

    console.log(`Action: restart ${deploymentName} in ${namespace}`);
    await restartDeployment(namespace, deploymentName);

    return res.status(200).send("Restarted");
  } catch (err) {
    console.error("Healer error:", err?.body || err);
    return res.status(500).send("Error");
  }
});

app.listen(PORT, () => {
  console.log(`Healer service running on port ${PORT}`);
});