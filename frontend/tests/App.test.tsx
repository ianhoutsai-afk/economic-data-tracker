import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { economicApi, fallbackData } from "../src/apiClient";

describe("App", () => {
  beforeEach(() => {
    economicApi.clearDashboardCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: fallbackData
        })
      })
    );
  });

  afterEach(() => {
    cleanup();
    economicApi.clearDashboardCache();
    vi.unstubAllGlobals();
  });

  it("renders the dashboard shell and chart regions", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "經濟數據追蹤" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GDP" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "全部" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "北美" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /歐元區/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /5Y/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quarterly/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2020=100" })).toBeInTheDocument();
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(await screen.findByText(/API 未連線|API 已連線/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/api/v1/dashboard");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("region=north_america");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("indicatorKey=gdp_real");
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toContain("indicatorKey=gdp_nominal");
    const fallbackCountryCodes = fallbackData.countries.map((country) => country.code);
    expect(fallbackCountryCodes).toContain("EU");
    expect(fallbackCountryCodes).not.toContain("DE");
    expect(fallbackCountryCodes).not.toContain("FR");
    expect(fallbackData.series.map((series) => series.id)).not.toContain("CN-policy_rate");
  });

  it("lets users switch the chart history range and frequency view", async () => {
    render(<App />);

    const oneYear = screen.getByRole("button", { name: /1Y/ });
    const raw = screen.getByRole("button", { name: /Raw/ });
    fireEvent.click(oneYear);
    fireEvent.click(raw);

    expect(oneYear).toHaveClass("active");
    expect(raw).toHaveClass("active");
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(await screen.findByText(/API 未連線|API 已連線/)).toBeInTheDocument();
  });

  it("refreshes only the current dashboard request", async () => {
    render(<App />);

    await screen.findByText(/API 未連線|API 已連線/);
    fireEvent.click(screen.getByRole("button", { name: "重新整理目前資料" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(String(vi.mocked(fetch).mock.calls[2][0])).toContain("/api/v1/dashboard");
    expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain("/api/v1/dashboard");
  });

  it("lets users switch GDP charts to a 2020 indexed comparison", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "2020=100" }));

    expect(screen.getByRole("button", { name: "2020=100" })).toHaveClass("active");
    expect(screen.getByRole("heading", { name: "GDP 指數化比較" })).toBeInTheDocument();
  });

  it("explains that quarterly policy-rate charts use the last available value", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /政策利率/ }));

    expect(await screen.findByText(/政策利率季度視圖顯示每季最後可用值/)).toBeInTheDocument();
  });
});
