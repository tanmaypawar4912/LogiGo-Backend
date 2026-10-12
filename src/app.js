
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { env } from "./config/env.js";
import authRoutes from "./routes/authRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";

const app = express();

// Explicitly allow the frontend origin.
// In production, env.CLIENT_URL must contain your deployed frontend URL.
const allowedOrigins = new Set(
  [
    env.CLIENT_URL,
    ...(env.NODE_ENV !== "production"
      ? [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
        ]
      : []),
  ].filter(Boolean)
);

const corsOptions = {
  origin(origin, callback) {
    // Requests from Postman and other non-browser clients may have no Origin.
    if (!origin || allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(
      new Error(`CORS blocked origin: ${origin}`)
    );
  },

  credentials: true,

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
  ],
};

// CORS must run before API routes.
app.use(cors(corsOptions));

app.use(helmet());

app.use(
  express.json({
    limit: "1mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(cookieParser());

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "LogiGo API is running",
  });
});

// Authentication APIs
app.use("/api/auth", authRoutes);

// Vehicle catalog APIs
app.use("/api/vehicles", vehicleRoutes);

// Not found
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
  });
});

// Central error handler
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.message?.startsWith("CORS blocked origin:")) {
    return res.status(403).json({
      success: false,
      message: error.message,
    });
  }

  console.error("API error:", error.message);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

export default app;
