const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryAsync = async ({
  fn,
  retries = 3,
  baseDelayMs = 500,
  actionName = "operation",
}) => {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      console.error(
        `${actionName} failed. attempt=${attempt}/${retries}. error=${err.message}`
      );

      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError;
};

module.exports = {
  retryAsync,
};