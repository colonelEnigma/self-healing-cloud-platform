require("dotenv").config();

const initDb = require("../config/initdb");
const { ALLOWED_APP_DEPLOYMENTS } = require("../config/allowlist");
const {
  syncIncidentSummariesForService,
} = require("../services/incidentVectorSyncService");

const parseServices = (value) => {
  if (!value) {
    return ALLOWED_APP_DEPLOYMENTS;
  }

  const selected = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return selected.filter((service) => ALLOWED_APP_DEPLOYMENTS.includes(service));
};

const main = async () => {
  await initDb();

  const services = parseServices(process.env.INCIDENT_EMBEDDING_SERVICES);
  const limit = Number.parseInt(process.env.INCIDENT_EMBEDDING_LIMIT || "200", 10);
  const safeLimit = Number.isNaN(limit) || limit <= 0 ? 200 : Math.min(limit, 1000);

  for (const service of services) {
    const result = await syncIncidentSummariesForService({
      service,
      limit: safeLimit,
    });

    console.log(
      `[incident-embedding-backfill] service=${service} synced=${result.synced} failed=${result.failed}`,
    );
  }

  process.exit(0);
};

main().catch((err) => {
  console.error("[incident-embedding-backfill] failed:", err.message);
  process.exit(1);
});

