import API from "./api";

export const registerUser = async (data) => {
  try {
    const response = await API.post("/users/register", data);
    return response.data;
  } catch (error) {
    console.error("Register Error:", error.response?.data || error.message);
    throw error;
  }
};

export const loginUser = async (data) => {
  try {
    const response = await API.post("/login", data);
    return response.data;
  } catch (error) {
    console.error("Login Error:", error.response?.data || error.message);
    throw error;
  }
};
