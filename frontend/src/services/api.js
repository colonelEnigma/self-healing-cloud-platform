import axios from "axios";
import API_URLS from "./config";

const API = axios.create({
  baseURL: API_URLS.USER,
  withCredentials: true,
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export default API;
