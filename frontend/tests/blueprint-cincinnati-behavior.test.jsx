import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import BlueprintStep from "../src/steps/BlueprintStep.jsx";
import { AppContext } from "../src/store.jsx";
import { apiFetch } from "../src/api.js";

vi.mock("../src/api.js", () => ({ apiFetch: vi.fn() }));

function patchChannelFromPath(path) {
  const q = String(path).includes("?") ? String(path).split("?")[1] : "";
  const m = q.match(/channel=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "4.18";
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
    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/cincinnati/channels") {
        return Promise.resolve({ channels: ["4.17", "4.19", "4.18"] });
      }
      if (path === "/api/cincinnati/update" && opts?.method === "POST") {
        return Promise.resolve({ channels: ["4.17", "4.19", "4.18"] });
      }
      if (String(path).startsWith("/api/cincinnati/patches?")) {
        const ch = patchChannelFromPath(path);
        return Promise.resolve({ versions: [`${ch}.5`, `${ch}.4`] });
      }
      return Promise.resolve({});
    });

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
      expect(patchSelect.value).toBe("4.19.5");
    });
  });

  it("Update keeps user-selected minor when followLatestMinor is false", async () => {
    const channelList = { channels: ["4.17", "4.18", "4.19"] };

    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/cincinnati/channels") {
        return Promise.resolve({ channels: [...channelList.channels] });
      }
      if (path === "/api/cincinnati/update" && opts?.method === "POST") {
        return Promise.resolve({ channels: [...channelList.channels] });
      }
      if (String(path).startsWith("/api/cincinnati/patches?")) {
        const ch = patchChannelFromPath(path);
        return Promise.resolve({ versions: [`${ch}.1`, `${ch}.0`] });
      }
      if (path === "/api/cincinnati/patches/update") {
        const body = opts?.body ? JSON.parse(opts.body) : {};
        const ch = body.channel || "4.17";
        return Promise.resolve({ versions: [`${ch}.9`, `${ch}.8`] });
      }
      return Promise.resolve({});
    });

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
  });

  it("Update advances to newest minor when followLatestMinor is true", async () => {
    const channelList = { channels: ["4.17", "4.18"] };

    vi.mocked(apiFetch).mockImplementation((path, opts) => {
      if (path === "/api/cincinnati/channels") {
        return Promise.resolve({ channels: [...channelList.channels] });
      }
      if (path === "/api/cincinnati/update" && opts?.method === "POST") {
        return Promise.resolve({ channels: [...channelList.channels] });
      }
      if (String(path).startsWith("/api/cincinnati/patches?")) {
        const ch = patchChannelFromPath(path);
        return Promise.resolve({ versions: [`${ch}.1`, `${ch}.0`] });
      }
      if (path === "/api/cincinnati/patches/update") {
        const body = opts?.body ? JSON.parse(opts.body) : {};
        const ch = body.channel || "4.18";
        return Promise.resolve({ versions: [`${ch}.3`, `${ch}.2`] });
      }
      return Promise.resolve({});
    });

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
      expect(patchSelect.value).toBe("4.19.3");
    });
  });
});
