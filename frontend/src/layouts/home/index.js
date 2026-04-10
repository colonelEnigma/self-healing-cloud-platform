import { useState, useEffect } from "react";
import DashboardLayout from "examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "examples/Navbars/DashboardNavbar";
import MDBox from "components/MDBox";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import MDTypography from "components/MDTypography";
import DataTable from "examples/Tables/DataTable";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import ComplexStatisticsCard from "examples/Cards/StatisticsCards/ComplexStatisticsCard";
import ButtonBase from "@mui/material/ButtonBase";
import CategoryCard from "./data/CategoryCard";

import { getProducts } from "../../services/productService";
import { getPayment } from "../../services/paymentService";
import MenuItem from "@mui/material/MenuItem";
import menuItem from "examples/Items/NotificationItem/styles";
import { useNavigate } from "react-router-dom";

function Home() {
  const [categories, setCategories] = useState([]);
  const navigate = useNavigate();
  useEffect(() => {
    getProducts().then((data) => {
      const uniqueCategories = [...new Set(data.map((p) => p.category))];
      setCategories(uniqueCategories);
      console.log(uniqueCategories);
    });
  }, []);

  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox py={3}>
        <Grid container spacing={3}>
          {categories.map((category, index) => (
            <Grid item xs={12} md={6} lg={3} key={index}>
              <MDBox mb={1.5}>
                <CategoryCard
                  category={category}
                  icon="category" // or any Material icon name
                  onClick={() => navigate(`/products/${category}`)}
                />
              </MDBox>
            </Grid>
          ))}
        </Grid>
      </MDBox>
    </DashboardLayout>
  );
}

export default Home;
