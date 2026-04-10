// services/apiClient.js
import axios from "axios";
import API_URLS from "../config";

function createApiClient(baseURL) {
  const client = axios.create({
    baseURL,
    withCredentials: true,
  });

  client.interceptors.request.use((config) => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  return client;
}

// Export clients for each service
export const userApi = createApiClient(API_URLS.USER);
export const orderApi = createApiClient(API_URLS.ORDER);
export const paymentApi = createApiClient(API_URLS.PAYMENT);
export const productApi = createApiClient(API_URLS.PRODUCT);
export const searchApi = createApiClient(API_URLS.SEARCH);
