import { Router, type RequestHandler } from "express";
import { economicDataService } from "../services/economicDataService.js";
import type { IndicatorKey, Region, ViewFrequency } from "../types.js";

export const v1Router = Router();

v1Router.get(
  "/dashboard",
  asyncHandler(async (request, response) => {
    const data = await economicDataService.getDashboard({
      countryCode: asString(request.query.countryCode),
      indicatorKey: asIndicatorKey(request.query.indicatorKey),
      from: asDateString(request.query.from),
      to: asDateString(request.query.to),
      range: asRange(request.query.range),
      viewFrequency: asViewFrequency(request.query.viewFrequency),
      region: asRegion(request.query.region)
    });
    response.json({ data });
  })
);

v1Router.get(
  "/countries",
  asyncHandler(async (_request, response) => {
    response.json({ data: await economicDataService.listCountries() });
  })
);

v1Router.get(
  "/indicators",
  asyncHandler(async (_request, response) => {
    response.json({ data: await economicDataService.listIndicators() });
  })
);

v1Router.get(
  "/series",
  asyncHandler(async (request, response) => {
    const data = await economicDataService.listSeries({
      countryCode: asString(request.query.countryCode),
      indicatorKey: asIndicatorKey(request.query.indicatorKey)
    });
    response.json({ data });
  })
);

v1Router.get(
  "/observations",
  asyncHandler(async (request, response) => {
    const data = await economicDataService.listObservations({
      seriesId: asString(request.query.seriesId),
      countryCode: asString(request.query.countryCode),
      indicatorKey: asIndicatorKey(request.query.indicatorKey),
      from: asDateString(request.query.from),
      to: asDateString(request.query.to),
      range: asRange(request.query.range),
      viewFrequency: asViewFrequency(request.query.viewFrequency)
    });
    response.json({ data });
  })
);

v1Router.get(
  "/releases",
  asyncHandler(async (request, response) => {
    const data = await economicDataService.listReleases({
      countryCode: asString(request.query.countryCode),
      indicatorKey: asIndicatorKey(request.query.indicatorKey),
      from: asDateString(request.query.from),
      to: asDateString(request.query.to),
      range: asRange(request.query.range)
    });
    response.json({ data });
  })
);

v1Router.get(
  "/providers",
  asyncHandler(async (_request, response) => {
    response.json({ data: await economicDataService.listProviders() });
  })
);

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asIndicatorKey(value: unknown): IndicatorKey | undefined {
  if (value === "gdp_real" || value === "gdp_nominal" || value === "cpi" || value === "inflation_rate" || value === "policy_rate" || value === "lpr") return value;
  return undefined;
}

function asDateString(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return undefined;
}

function asRange(value: unknown) {
  if (value === "1y" || value === "5y" || value === "10y" || value === "all") return value;
  return undefined;
}

function asViewFrequency(value: unknown): ViewFrequency | undefined {
  if (value === "raw" || value === "quarterly") return value;
  return undefined;
}

function asRegion(value: unknown): Region | "all" | undefined {
  if (value === "north_america" || value === "europe" || value === "east_asia" || value === "china" || value === "all") return value;
  return undefined;
}

function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
