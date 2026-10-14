// Development-only Express backend for local testing.
// Production Stripe flow uses api/charge.js on Vercel.
const express = require("express");
const cors = require("cors");

require("dotenv").config();

const app = express();

const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || "").split(","),
  "http://localhost:3000",
  "http://127.0.0.1:3000"
].map((origin) => origin.trim()).filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json());
app.use("/api/charge", require("./charge"));

module.exports = app;
