const express = require("express");
const userRoutes = require("./routes/userRoutes");

const app = express();

app.use(express.json());

// routes
app.use("/users", userRoutes);

// health check
app.get("/health", (req, res) => {
    res.status(200).json({ status: "user-service is running" });
});

module.exports = app;