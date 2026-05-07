const MAX_ACTIVE_CHAOS_SCENARIOS = Number.parseInt(
  process.env.CHAOS_MAX_ACTIVE_SCENARIOS || "3",
  10,
);

const DEFAULT_MIN_DURATION_SECONDS = Number.parseInt(
  process.env.CHAOS_DEFAULT_MIN_DURATION_SECONDS || "60",
  10,
);

const DEFAULT_MAX_DURATION_SECONDS = Number.parseInt(
  process.env.CHAOS_DEFAULT_MAX_DURATION_SECONDS || "900",
  10,
);

const CANONICAL_SCENARIOS = Object.freeze([
  {
    id: "ScaleToZero",
    category: "Availability Failures",
    name: "Scale To Zero",
    purpose: "Scale one allowlisted service deployment to 0 replicas (PATCH deployment/<service> spec.replicas: 1 -> 0 in namespace=prod).",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "scale_replicas",
    targetReplicas: 0,
  },
  {
    id: "ImagePullFailSimulation",
    category: "Availability Failures",
    name: "Image Pull Fail Simulation",
    purpose: "Simulate rollout failure using an invalid image reference (PATCH deployment/<service> container.image: <current-tag> -> chaos-invalid).",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_container_image",
    chaosImageTagSuffix: "chaos-invalid",
  },
  {
    id: "BadReadinessProbe",
    category: "Health Probe Failures",
    name: "Bad Readiness Probe",
    purpose: "Simulate invalid readiness checks for one service (PATCH deployment/<service> readinessProbe.httpGet.path=/__chaos__/not-ready, port=65535, timeoutSeconds=1).",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_readiness_probe",
    chaosReadinessPath: "/__chaos__/not-ready",
    chaosReadinessPort: 65535,
  },
  {
    id: "BadLivenessProbe",
    category: "Health Probe Failures",
    name: "Bad Liveness Probe",
    purpose: "Simulate invalid liveness checks causing restarts (PATCH deployment/<service> livenessProbe.httpGet.path=/__chaos__/not-live, port=65535, timeoutSeconds=1).",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_liveness_probe",
    chaosLivenessPath: "/__chaos__/not-live",
    chaosLivenessPort: 65535,
  },
  {
    id: "ProbeTimeoutSpike",
    category: "Health Probe Failures",
    name: "Probe Timeout Spike",
    purpose: "Simulate probe timeout pressure (PATCH deployment/<service> readinessProbe.exec='sh -c sleep 5', timeoutSeconds=1, periodSeconds=5).",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_readiness_probe_timeout",
    chaosProbeTimeoutSeconds: 1,
    chaosProbeExecSleepSeconds: 5,
  },
  {
    id: "LatencyInjection",
    category: "Performance Degradation",
    name: "Latency Injection",
    purpose: "Inject fixed startup latency (PATCH deployment/<service> lifecycle.postStart.exec='sh -c sleep 12').",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_container_lifecycle_post_start_sleep",
    chaosPostStartSleepSeconds: 12,
  },
  {
    id: "ErrorRateSpike",
    category: "Error & Reliability Failures",
    name: "Error Rate Spike",
    purpose: "Force real request failures by patching deployment/<service> env PORT to a non-service target port so kube Service traffic fails for the active window.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_container_env_var",
    chaosEnvVarName: "PORT",
    chaosEnvVarValue: "18080",
  },
  {
    id: "DatabaseUnavailable",
    category: "Dependency Failures",
    name: "Database Unavailable",
    purpose: "Break database connectivity by patching deployment/<service> env DB_HOST to an invalid host for the active window, then reverting exact prior DB_HOST state.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_container_env_var",
    chaosEnvVarName: "DB_HOST",
    chaosEnvVarValue: "chaos-db-unreachable.invalid",
  },
  {
    id: "KafkaUnavailable",
    category: "Dependency Failures",
    name: "Kafka Unavailable",
    purpose: "Break Kafka connectivity by patching deployment/<service> env KAFKA_BROKER to an invalid broker for the active window, then reverting exact prior KAFKA_BROKER state.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_container_env_var",
    chaosEnvVarName: "KAFKA_BROKER",
    chaosEnvVarValue: "chaos-kafka-unreachable.invalid:9092",
  },
  {
    id: "MetricsPipelineDrop",
    category: "Observability & Control Plane Blind Spots",
    name: "Metrics Pipeline Drop",
    purpose: "Drop Prometheus scrape visibility for one service by patching deployment/<service> pod template annotation prometheus.io/scrape=false and later restoring the exact prior annotation state.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: true,
    executionType: "patch_pod_template_annotation",
    chaosAnnotationName: "prometheus.io/scrape",
    chaosAnnotationValue: "false",
  },
]);

const CHAOS_SCENARIOS = CANONICAL_SCENARIOS;

const getScenarioById = (scenarioId) =>
  CHAOS_SCENARIOS.find((scenario) => scenario.id === scenarioId) || null;

const resolveScenarioId = (scenarioId) => {
  if (!scenarioId || typeof scenarioId !== "string") {
    return null;
  }

  const canonicalDirect = getScenarioById(scenarioId);
  if (canonicalDirect) {
    return {
      originalId: scenarioId,
      canonicalId: canonicalDirect.id,
      isDeprecatedAlias: false,
    };
  }

  return null;
};

module.exports = {
  CHAOS_SCENARIOS,
  CANONICAL_SCENARIOS,
  MAX_ACTIVE_CHAOS_SCENARIOS,
  getScenarioById,
  resolveScenarioId,
};
