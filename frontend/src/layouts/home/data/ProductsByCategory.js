import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import DashboardLayout from "examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "examples/Navbars/DashboardNavbar";
import MDBox from "components/MDBox";
import MDTypography from "components/MDTypography";
import { getProducts } from "../../../services/productService";
import Grid from "@mui/material/Grid";
import TextField from "@mui/material/TextField";
import { useCart } from "../../cart/cartContext";
import MDButton from "components/MDButton";

function ProductsByCategory() {
  const { category } = useParams();
  const [products, setProducts] = useState([]);
  const [quantities, setQuantities] = useState({});
  const { addToCart } = useCart();

  useEffect(() => {
    console.log("category....", category);
    getProducts().then((data) => {
      const filtered = data.filter((p) => p.category === category);
      setProducts(filtered);
    });
  }, [category]);

  const handleQuantityChange = (id, value) => {
    setQuantities((prev) => ({
      ...prev,
      [id]: value,
    }));
  };

  //   const handleAddToCart = (product) => {
  //     const qty = quantities[product.id] || 1;
  //     console.log("Adding to cart:", product.name, "Quantity:", qty);
  //     // Here you can integrate with your cart service or context
  //   };

  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox py={3}>
        <MDTypography variant="h4" mb={2}>
          Products in {category}
        </MDTypography>
        <Grid container spacing={3} py={3} px={3}>
          {products.map((p) => (
            <Grid item xs={12} md={6} lg={3} key={p.id}>
              <MDBox mb={1.5} p={2} px={3} border="1px solid #ddd" borderRadius="8px">
                <MDTypography variant="h6">{p.name}</MDTypography>
                <MDTypography variant="body2">{p.description}</MDTypography>
                <MDTypography variant="body2">Price: ${p.price}</MDTypography>

                {/* Quantity Selector */}
                <TextField
                  type="number"
                  label="Quantity"
                  variant="outlined"
                  size="small"
                  value={quantities[p.id] || 1}
                  onChange={(e) => {
                    let value = parseInt(e.target.value, 10);
                    if (isNaN(value) || value < 1) value = 1; // minimum 1
                    if (value > 100) value = 100;
                    handleQuantityChange(p.id, value);
                  }}
                  sx={{ mt: 2, width: "100px" }}
                />
                <MDButton
                  variant="gradient"
                  color="secondary"
                  sx={{ mt: 2, ml: 2 }}
                  onClick={() => addToCart(p, quantities[p.id] || 1)}
                >
                  Add to Cart
                </MDButton>
              </MDBox>
            </Grid>
          ))}
        </Grid>
      </MDBox>
    </DashboardLayout>
  );
}

export default ProductsByCategory;
