const { validateAlertRecordList } = require("../contracts/schemas");

const toAlertRecords = (payload) =>
  validateAlertRecordList(
    (Array.isArray(payload) ? payload : []).map((alert) => ({
      name: alert?.name || alert?.labels?.alertname || "unknown",
      severity: alert?.severity || alert?.labels?.severity || "unknown",
      state: alert?.state || "unknown",
      activeAt: alert?.activeAt || null,
      summary: alert?.summary || alert?.annotations?.summary || null,
      service: alert?.service || alert?.labels?.service || alert?.labels?.deployment || null,
    })),
  );

module.exports = {
  toAlertRecords,
};
