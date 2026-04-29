import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function patchChannelFromPath(path) {
  const q = String(path).includes("?") ? String(path).split("?")[1] : "";
  const m = q.match(/channel=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "4.18";
}

/** Shared mocks: initial mount + optional Cincinnati refresh job + polling. */
function mockCincinnatiApis(channelList, opts = {}) {
  const { jobStatus = "completed", jobMessage = "" } = opts;
  let jobPollCount = 0;
  vi.mocked(apiFetch).mockImplementation((path, requestOpts) => {
    if (path === "/api/cincinnati/channels") {
      return Promise.resolve({ channels: [...channelList.channels] });
    }
    if (path === "/api/cincinnati/update" && requestOpts?.method === "POST") {
      return Promise.resolve({ channels: [...channelList.channels] });
    }
    if (path === "/api/cincinnati/refresh-job" && requestOpts?.method === "POST") {
      return Promise.resolve({ jobId: "job-cin-1" });
    }
    if (String(path) === "/api/jobs/job-cin-1") {
      jobPollCount += 1;
      return Promise.resolve({
        id: "job-cin-1",
        type: "cincinnati-refresh",
        status: jobStatus,
        message: jobMessage,
        output: jobStatus === "failed" ? "Error: upstream failed\n" : "ok\n",
        progress: 100
      });
    }
    if (String(path).startsWith("/api/cincinnati/patches?")) {
      const ch = patchChannelFromPath(path);
      return Promise.resolve({ versions: [`${ch}.1`, `${ch}.0`] });
    }
    if (path === "/api/cincinnati/patches/update") {
      const body = requestOpts?.body ? JSON.parse(requestOpts.body) : {};
      const ch = body.channel || "4.17";
      return Promise.resolve({ versions: [`${ch}.9`, `${ch}.8`] });
    }
    return Promise.resolve({});
  });
  return { getJobPollCount: () => jobPollCount };
}

describe("BlueprintStep Cincinnati", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });
  afterEach(() => {
    cleanup();
  });

  function renderBlueprint(initialState) {
    const Wrapper = () => {
      const [state, setState] = useState(initialState);
      const updateState = (patch) => setState((prev) => ({ ...prev, ...patch }));
      return (
        <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
          <BlueprintStep />
        </AppContext.Provider>
      );
    };
    return render(<Wrapper />);
  }

  it("lists minor channels newest-first and defaults to newest on load", async () => {
    const channelList = { channels: ["4.17", "4.19", "4.18"] };
    mockCincinnatiApis(channelList);

    const initial = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: null, patchVersion: null, confirmed: false, followLatestMinor: true },
      version: {},
      operators: { stale: false, selected: [], catalogs: {} }
    };
    renderBlueprint(initial);

    const minorSelect = await waitFor(() => screen.getByLabelText(/Minor channel/i));
    await waitFor(() => {
      const opts = [...minorSelect.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
      expect(opts).toEqual(["4.19", "4.18", "4.17"]);
    });
    expect(minorSelect.value).toBe("4.19");

    const patchSelect = screen.getByLabelText(/Patch version/i);
    await waitFor(() => {
      expect(patchSelect.value).toBe("4.19.1");
    });
  });

  it("Update keeps user-selected minor when followLatestMinor is false", async () => {
    const channelList = { channels: ["4.17", "4.18", "4.19"] };
    mockCincinnatiApis(channelList);

    const initial = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.17", patchVersion: "4.17.1", confirmed: false, followLatestMinor: false },
      version: {},
      operators: { stale: false, selected: [], catalogs: {} }
    };
    renderBlueprint(initial);

    const minorSelect = await waitFor(() => screen.getByLabelText(/Minor channel/i));
    await waitFor(() => expect(minorSelect.value).toBe("4.17"));

    channelList.channels = ["4.16", "4.17", "4.18", "4.19", "4.20"];
    fireEvent.click(screen.getByRole("button", { name: /^Update$/i }));

    await waitFor(() => {
      expect(minorSelect.value).toBe("4.17");
    });
    const patchSelect = screen.getByLabelText(/Patch version/i);
    await waitFor(() => expect(patchSelect.value).toBe("4.17.1"));
  });

  it("Update advances to newest minor when followLatestMinor is true", async () => {
    const channelList = { channels: ["4.17", "4.18"] };
    mockCincinnatiApis(channelList);

    const initial = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: null, patchVersion: null, confirmed: false, followLatestMinor: true },
      version: {},
      operators: { stale: false, selected: [], catalogs: {} }
    };
    renderBlueprint(initial);

    const minorSelect = await waitFor(() => screen.getByLabelText(/Minor channel/i));
    await waitFor(() => expect(minorSelect.value).toBe("4.18"));

    channelList.channels = ["4.17", "4.18", "4.19"];
    fireEvent.click(screen.getByRole("button", { name: /^Update$/i }));

    await waitFor(() => {
      expect(minorSelect.value).toBe("4.19");
    });
    const patchSelect = screen.getByLabelText(/Patch version/i);
    await waitFor(() => {
      expect(patchSelect.value).toBe("4.19.1");
    });
  });

  it("clears patches loading when patch fetch rejects", async () => {
    const channelList = { channels: ["4.17"] };
    vi.mocked(apiFetch).mockImplementation((path, requestOpts) => {
      if (path === "/api/cincinnati/channels") {
        return Promise.resolve({ channels: [...channelList.channels] });
      }
      if (path === "/api/cincinnati/update" && requestOpts?.method === "POST") {
        return Promise.resolve({ channels: [...channelList.channels] });
      }
      if (String(path).startsWith("/api/cincinnati/patches?")) {
        return Promise.reject(new Error("patches failed"));
      }
      return Promise.resolve({});
    });

    const initial = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.17", patchVersion: null, confirmed: false, followLatestMinor: false },
      version: {},
      operators: { stale: false, selected: [], catalogs: {} }
    };
    renderBlueprint(initial);

    await waitFor(() => {
      expect(screen.queryByText(/Loading patches/i)).not.toBeInTheDocument();
    });
  });

  it("Update shows refresh error and sets highlightJobId when Cincinnati job fails", async () => {
    const channelList = { channels: ["4.17", "4.18"] };
    let capturedState = null;
    const Wrapper = () => {
      const [state, setState] = useState({
        ui: {},
        blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
        release: { channel: "4.17", patchVersion: "4.17.1", confirmed: false, followLatestMinor: false },
        version: {},
        operators: { stale: false, selected: [], catalogs: {} }
      });
      const updateState = (patch) => {
        setState((prev) => {
          const next = { ...prev, ...patch };
          capturedState = next;
          return next;
        });
      };
      return (
        <AppContext.Provider value={{ state, updateState, loading: false, startOver: vi.fn() }}>
          <BlueprintStep />
        </AppContext.Provider>
      );
    };
    mockCincinnatiApis(channelList, { jobStatus: "failed", jobMessage: "upstream timeout" });
    render(<Wrapper />);

    await waitFor(() => screen.getByLabelText(/Minor channel/i));
    fireEvent.click(screen.getByRole("button", { name: /^Update$/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/upstream timeout/i);
    });
    await waitFor(() => {
      expect(capturedState?.ui?.highlightJobId).toBe("job-cin-1");
    });
  });

  it("manual release Apply updates minor, patch, and patch list", async () => {
    const channelList = { channels: ["4.17"] };
    mockCincinnatiApis(channelList);

    const initial = {
      blueprint: { platform: "Bare Metal", arch: "x86_64", confirmed: false },
      release: { channel: "4.17", patchVersion: "4.17.1", confirmed: false, followLatestMinor: false },
      version: {},
      operators: { stale: false, selected: [], catalogs: {} }
    };
    renderBlueprint(initial);

    await waitFor(() => screen.getByLabelText(/Minor channel/i));

    fireEvent.click(screen.getByText(/Advanced: set release manually/i));
    await screen.findByTestId("blueprint-manual-minor");
    await waitFor(() => expect(screen.getByTestId("blueprint-manual-minor")).toHaveValue("4.17"));
    await act(async () => {
      fireEvent.change(screen.getByTestId("blueprint-manual-minor"), { target: { value: "4.20" } });
      fireEvent.change(screen.getByTestId("blueprint-manual-patch"), { target: { value: "4.20.3" } });
    });
    expect(screen.getByTestId("blueprint-manual-minor")).toHaveValue("4.20");
    expect(screen.getByTestId("blueprint-manual-patch")).toHaveValue("4.20.3");
    fireEvent.click(screen.getByTestId("blueprint-manual-apply"));

    await waitFor(() => {
      const minorSelect = screen.getByLabelText(/Minor channel/i);
      const patchSelect = screen.getByLabelText(/Patch version/i);
      expect(minorSelect.value).toBe("4.20");
      expect(patchSelect.value).toBe("4.20.3");
    });
    const patchSelect = screen.getByLabelText(/Patch version/i);
    expect(patchSelect.querySelectorAll("option").length).toBeGreaterThanOrEqual(2);
  });
});
