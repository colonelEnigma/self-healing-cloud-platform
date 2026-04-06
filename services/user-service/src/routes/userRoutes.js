const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authMiddleware");

const {
  registerUser,
  loginUser,
  getProfile,
  updateProfile,
} = require("../controllers/userController");

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/profile", authenticate, getProfile);
router.put("/update-profile", authenticate, updateProfile);

module.exports = router;
