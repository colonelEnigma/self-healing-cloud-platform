import { orderApi } from "./api";
import { io } from "socket.io-client";
import API_URLS from "../config";

let socket;

export async function getOrders() {
  try {
    const response = await orderApi.get("/api/orders/my-orders");
    // axios puts the parsed JSON directly in response.data
    return response.data;
  } catch (error) {
    console.error("Error fetching orders:", error);
    throw new Error("Failed to fetch orders");
  }
}

export async function createOrder(orderData) {
  try {
    const response = await orderApi.post("/api/orders", orderData);
    return response.data;
  } catch (error) {
    console.error("Error creating order:", error);
    throw new Error("Failed to create order");
  }
}

export const initSocket = () => {
  if (!socket) {
    socket = io(API_URLS.SEARCH); // 👈 your backend socket server
  }
  return socket;
};

export const getSocket = () => {
  if (!socket) {
    throw new Error("Socket not initialized. Call initSocket() first.");
  }
  return socket;
};
