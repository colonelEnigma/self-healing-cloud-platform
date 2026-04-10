import { useState } from "react";
import { useCart } from "./cartContext";
import { createOrder } from "../../services/orderService"; // adjust path
import Card from "@mui/material/Card";
import Icon from "@mui/material/Icon";
import Grid from "@mui/material/Grid";
import MDBox from "components/MDBox";
import MDTypography from "components/MDTypography";
import MDButton from "components/MDButton";
import MDSnackbar from "components/MDSnackbar";

export default function CartBanner({ onSuccess, onError }) {
  const { cart, removeFromCart, clearCart } = useCart();
  const [open, setOpen] = useState(true);

  if (cart.length === 0) return null;

  const total = cart.reduce((sum, item) => sum + item.qty * item.price, 0);

  const handleCheckout = async () => {
    const payload = {
      items: cart.map((item) => ({
        product_id: item.id,
        quantity: item.qty,
      })),
    };

    try {
      const response = await createOrder(payload);
      console.log("Order created:", response);

      clearCart();
      onSuccess(); // ✅ trigger success snackbar in App.js
    } catch (error) {
      console.error("Checkout failed:", error);
      onError(); // ✅ trigger error snackbar in App.js
    }
  };

  return (
    <Card sx={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 2000 }}>
      {/* header + collapse toggle */}
      <MDBox
        pt={2}
        px={2}
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        sx={{ cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <MDTypography variant="h6" fontWeight="medium">
          🛒 Cart ({cart.length} items)
        </MDTypography>
        <Icon>{open ? "expand_more" : "expand_less"}</Icon>
      </MDBox>

      {open && (
        <MDBox p={2}>
          {cart.map((item) => (
            <MDBox
              key={item.id}
              display="flex"
              justifyContent="space-between"
              alignItems="center"
              p={2}
              mb={1}
            >
              <MDTypography>
                {item.qty} x {item.name} (${item.price})
              </MDTypography>
              <MDButton
                variant="gradient"
                color="error"
                size="small"
                onClick={() => removeFromCart(item.id)}
              >
                <Icon fontSize="small">delete</Icon>&nbsp;Remove
              </MDButton>
            </MDBox>
          ))}
          <MDBox display="flex" justifyContent="space-between" alignItems="center" mt={2}>
            <MDTypography variant="subtitle1" fontWeight="medium">
              Total: ${total.toFixed(2)}
            </MDTypography>
            <MDButton variant="gradient" color="secondary" onClick={handleCheckout}>
              <Icon>shopping_cart_checkout</Icon>&nbsp;Checkout
            </MDButton>
          </MDBox>
        </MDBox>
      )}
    </Card>
  );
}
