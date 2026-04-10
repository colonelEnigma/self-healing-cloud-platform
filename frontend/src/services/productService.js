import { productApi } from "./api";

export async function getProducts() {
  try {
    const response = await productApi.get("/api/products");
    // axios puts the parsed JSON directly in response.data
    // console.log("products....", response);
    return response.data;
  } catch (error) {
    console.error("Error fetching products:", error);
    throw new Error("Failed to fetch products");
  }
}
