const axios = require("axios");
const axiosRetry = require("axios-retry").default;

const httpClient = axios.create({
  timeout: 2000,
});

axiosRetry(httpClient, {
  retries: 3,
  retryDelay: (retryCount, error) => {
    console.log(
      `Retry attempt: ${retryCount}, reason: ${error.code || error.message}`
    );
    return retryCount * 500;
  },
  retryCondition: (error) => {
    console.log("Retry check error code:", error.code);
    return (
      error.code === "ECONNREFUSED" ||
      error.code === "ENOTFOUND" ||
            error.code === "ECONNABORTED" ||
            axiosRetry.isNetworkError(error) ||
            axiosRetry.isRetryableError(error)
        );
    }
});

module.exports = httpClient;