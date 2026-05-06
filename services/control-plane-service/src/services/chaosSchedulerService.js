const { processDueAutoReverts } = require("./chaosService");

const AUTO_REVERT_POLL_MS = Number.parseInt(
  process.env.CHAOS_AUTO_REVERT_POLL_MS || "15000",
  10,
);

let intervalRef = null;
let runInProgress = false;

const runAutoRevertTick = async () => {
  if (runInProgress) {
    return;
  }

  runInProgress = true;
  try {
    const result = await processDueAutoReverts();
    if (result.reverted > 0 || result.errors > 0) {
      console.log(
        `Chaos auto-revert tick: checked=${result.checked}, reverted=${result.reverted}, errors=${result.errors}`,
      );
    }
  } catch (err) {
    console.error("Chaos auto-revert tick failed:", err.message);
  } finally {
    runInProgress = false;
  }
};

const startChaosAutoRevertScheduler = () => {
  if (intervalRef) {
    return;
  }

  intervalRef = setInterval(runAutoRevertTick, AUTO_REVERT_POLL_MS);
  if (typeof intervalRef.unref === "function") {
    intervalRef.unref();
  }

  console.log(
    `Chaos auto-revert scheduler started (poll every ${AUTO_REVERT_POLL_MS}ms)`,
  );
};

module.exports = {
  startChaosAutoRevertScheduler,
  runAutoRevertTick,
};
