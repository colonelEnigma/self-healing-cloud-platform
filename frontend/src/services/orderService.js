import { orderApi } from "./api";

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
