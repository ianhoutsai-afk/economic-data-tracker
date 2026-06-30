import cors from "cors";
import "./env.js";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { v1Router } from "./routes/v1.js";

const app = express();

app.use(
  cors({
    origin: corsOrigins()
  })
);
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/v1", v1Router);

app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: "not_found",
      message: "Route not found"
    }
  });
});

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({
    error: {
      code: "internal_error",
      message: error.message || "Unexpected server error"
    }
  });
});

export default app;

function corsOrigins() {
  const value = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 1 ? origins : origins[0];
}
