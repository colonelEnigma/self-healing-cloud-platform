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

import { getOrders } from "../../services/orderService";
import { getPayment } from "../../services/paymentService";
import ordersDialog from "./data/style";
import MenuItem from "@mui/material/MenuItem";
import menuItem from "examples/Items/NotificationItem/styles";

function Orders() {
  const [open, setOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [rows, setRows] = useState([]);

  const handleOpen = async (order) => {
    try {
      const paymentDetails = await getPayment(order.id);

      // If paymentDetails.status is missing, default to "pending"
      const paymentStatus = paymentDetails?.status || "pending";

      setSelectedOrder({ ...order, paymentStatus });
      setOpen(true);
    } catch (err) {
      // In case of error, also default to "pending"
      setSelectedOrder({ ...order, paymentStatus: "pending" });
      setOpen(true);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedOrder(null);
  };

  useEffect(() => {
    getOrders().then((data) => {
      const formattedRows = data.map((order) => ({
        id: order.id,
        status: order.status,
        total: order.total_amount,
        created: new Date(order.created_at).toLocaleString(),
        action: (
          <MDTypography
            component="a"
            href="#"
            variant="caption"
            color="info"
            fontWeight="medium"
            onClick={() => handleOpen(order)}
            sx={{ cursor: "pointer" }}
          >
            View
          </MDTypography>
        ),
      }));
      setRows(formattedRows);
    });
  }, []);

  const columns = [
    { Header: "Order ID", accessor: "id", align: "left" },
    { Header: "Status", accessor: "status", align: "center" },
    { Header: "Total Amount", accessor: "total", align: "center" },
    { Header: "Created At", accessor: "created", align: "center" },
    { Header: "Action", accessor: "action", align: "center" },
  ];

  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox pt={6} pb={3}>
        <Grid container spacing={6}>
          <Grid item xs={12}>
            <Card>
              <MDBox
                mx={2}
                mt={-3}
                py={3}
                px={2}
                variant="gradient"
                bgColor="info"
                borderRadius="lg"
                coloredShadow="info"
              >
                <MDTypography variant="h6" color="white">
                  Orders
                </MDTypography>
              </MDBox>
              <MDBox pt={3}>
                <DataTable
                  table={{ columns, rows }}
                  isSorted={false}
                  entriesPerPage={false}
                  showTotalEntries={false}
                  noEndBorder
                  sx={(theme) => ordersTable(theme)}
                />
              </MDBox>
            </Card>
          </Grid>
        </Grid>
      </MDBox>

      {/* Dialog */}
      <MenuItem sx={(theme) => menuItem(theme)}>
        <Dialog open={open} onClose={handleClose}>
          <DialogTitle
            sx={(theme) => ({
              backgroundColor: theme.palette.background.default,
            })}
          >
            Order Details
          </DialogTitle>

          <DialogContent>
            {selectedOrder && (
              <>
                <MDTypography variant="body1" color="secondary">
                  <strong>ID:</strong> {selectedOrder.id}
                </MDTypography>
                <MDTypography variant="body1" color="secondary">
                  <strong>Status:</strong> {selectedOrder.status}
                </MDTypography>
                <MDTypography variant="body1" color="secondary">
                  <strong>Total:</strong> {selectedOrder.total_amount}
                </MDTypography>
                <MDTypography variant="body1" color="secondary">
                  <strong>Created:</strong> {new Date(selectedOrder.created_at).toLocaleString()}
                </MDTypography>
                <MDTypography variant="body1" color="secondary">
                  <strong>Items:</strong>
                </MDTypography>
                {selectedOrder.items.map((item, idx) => (
                  <MDTypography key={idx} variant="body1" color="secondary">
                    Product {item.product_id} — Qty: {item.quantity} — Price: {item.price}
                  </MDTypography>
                ))}
                {selectedOrder.paymentStatus && (
                  <MDTypography variant="body2" color="info" sx={{ mt: 2 }}>
                    <strong>Payment Status:</strong> {selectedOrder.paymentStatus}
                  </MDTypography>
                )}
              </>
            )}
          </DialogContent>

          <DialogActions
            sx={(theme) => ({
              backgroundColor: theme.palette.background.default,
            })}
          >
            <Button onClick={handleClose} color="inherit">
              Close
            </Button>
          </DialogActions>
        </Dialog>
      </MenuItem>
    </DashboardLayout>
  );
}

export default Orders;
