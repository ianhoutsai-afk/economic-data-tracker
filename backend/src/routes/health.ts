import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  response.json({
    data: {
      status: "ok",
      service: "economic-data-tracker-api",
      timestamp: new Date().toISOString()
    }
  });
});
