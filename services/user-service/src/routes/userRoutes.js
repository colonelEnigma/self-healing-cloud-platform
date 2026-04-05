const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authMiddleware");

const {
    registerUser,
    loginUser,
    getUser,
} = require("../controllers/userController");

router.post("/register", registerUser);
router.post("/login", loginUser);
// router.get("/:id", authenticate, getUser);

module.exports = router;