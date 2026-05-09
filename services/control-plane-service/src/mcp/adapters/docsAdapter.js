const { validateDocEvidenceList } = require("../contracts/schemas");

const toDocEvidence = (payload) => validateDocEvidenceList(payload);

module.exports = {
  toDocEvidence,
};
