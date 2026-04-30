require("dotenv").config();

const app = require("./app");

const PORT = process.env.PORT || 7100;

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required for control-plane-service");
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Control Plane Service running on port ${PORT}`);
});
