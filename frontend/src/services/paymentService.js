import { paymentApi } from "./api";

export async function getPayment(id) {
  try {
    const response = await paymentApi.get(`/api/payment/${id}`);
    // axios automatically parses JSON, so use response.data
    return response.data;
  } catch (error) {
    // console.error("Error fetching payment:", error);
    throw new Error("Failed to fetch payment");
  }
}
