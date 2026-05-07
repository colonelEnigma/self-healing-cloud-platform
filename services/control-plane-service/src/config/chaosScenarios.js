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
    purpose: "Scale one allowlisted service deployment to 0 replicas.",
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
    purpose: "Simulate rollout failure using an invalid image reference.",
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
    purpose: "Simulate invalid readiness checks for one service.",
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
    purpose: "Simulate invalid liveness checks causing restarts.",
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
    purpose: "Simulate slow probe responses and startup delays.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: false,
  },
  {
    id: "LatencyInjection",
    category: "Performance Degradation",
    name: "Latency Injection",
    purpose: "Inject fixed latency into one service path.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: false,
  },
  {
    id: "ErrorRateSpike",
    category: "Error & Reliability Failures",
    name: "Error Rate Spike",
    purpose: "Simulate a controlled increase in 5xx responses.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: false,
  },
  {
    id: "DatabaseUnavailable",
    category: "Dependency Failures",
    name: "Database Unavailable",
    purpose: "Simulate temporary database connectivity loss.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: false,
  },
  {
    id: "KafkaUnavailable",
    category: "Dependency Failures",
    name: "Kafka Unavailable",
    purpose: "Simulate temporary Kafka broker connectivity loss.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: false,
  },
  {
    id: "MetricsPipelineDrop",
    category: "Observability & Control Plane Blind Spots",
    name: "Metrics Pipeline Drop",
    purpose: "Simulate missing metrics ingestion.",
    defaultDurationSeconds: 180,
    minDurationSeconds: DEFAULT_MIN_DURATION_SECONDS,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    blastRadiusLimit: "single-service",
    autoRevert: true,
    enabled: false,
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
