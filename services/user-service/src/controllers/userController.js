exports.registerUser = (req, res) => {
    res.json({ message: "User registered (mock)" });
};

exports.loginUser = (req, res) => {
    res.json({ message: "User logged in (mock)" });
};

exports.getUser = (req, res) => {
    res.json({ message: `Get user ${req.params.id}` });
};