const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const firebaseService = require("../services/firebase.service");
/* ===============================
   EMAIL REGISTER
================================ */
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(400).json("Email already exists");

    const hash = await bcrypt.hash(password, 10);

    let role = "user";

    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      role = "admin";
    }

    const user = await User.create({
      name,
      email,
      password: hash,
      role,
    });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET
    );

    res.json({ token, user });
  } catch (err) {
    console.log(err);
    res.status(500).json("Registration failed");
  }
};

/* ===============================
   EMAIL LOGIN
================================ */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(404).json("No Account found with this email");

    if (!user.password) {
      return res
        .status(400)
        .json(
          "This account uses Google Sign-In. Please login with Google or set a password using forgot password."
        );
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json("Incorrect password");

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET
    );

    res.json({ token, user });
  } catch (err) {
    res.status(500).json(err.message);
  }
};

/* ===============================
   FIREBASE GOOGLE LOGIN
================================ */
exports.firebaseGoogleLogin = async (req, res) => {
  try {
    const firebaseToken = req.headers.authorization;

    if (!firebaseToken)
      return res.status(401).json("No Firebase token");

    const decoded = await firebaseService.verifyFirebaseToken(firebaseToken);

    let user = await User.findOne({
      where: { email: decoded.email },
    });

    if (!user) {
      user = await User.create({
        name: decoded.name,
        email: decoded.email,
        firebase_uid: decoded.uid,
        avatar: decoded.picture,
      });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET);

    res.json({ token, user });
  } catch (err) {
    res.status(500).json(err.message);
  }
};