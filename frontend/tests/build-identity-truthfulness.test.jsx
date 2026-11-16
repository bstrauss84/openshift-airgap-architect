/**
 * OpenShift Airgap Architect - Test Suite
 *
 * BUILD IDENTITY TRUTHFULNESS (v2.1.1).
 *
 * Version, revision and build time are three INDEPENDENT facts. The defect this
 * guards against was inferring one from another: `docker-compose.yml` defaults
 * `APP_GIT_SHA` to "unknown", and the UI turned that single missing fact into
 * "Version 2.1.0 (dev)" plus "dev build" — telling users a signed release build
 * was a development build. The Tools drawer separately asserted the branch was
 * "main" whether or not anyone had supplied one.
 *
 * The backend was never the problem: /api/build-info and /api/update-info
 * already reported unknown values honestly and fail closed. Only the
 * presentation lied, so these tests pin the presentation.
 *
 * Both directions are covered — with supplied revision metadata and without —
 * because a fix that only works when the SHA is present fixes nothing.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import AboutModal from "../src/components/AboutModal.jsx";
import ToolsDrawer from "../src/components/ToolsDrawer.jsx";

const drawerProps = {
  isOpen: true,
  onClose: () => {},
  theme: "light",
  setTheme: () => {},
  onExportRun: () => {},
  onImportClick: () => {},
  onStartOver: () => {},
  logAction: () => {}
};

const aboutText = () => document.querySelector(".about-modal").textContent;
const drawerBuildText = () => document.querySelector(".about-build-info").textContent;

afterEach(() => cleanup());

describe("AboutModal — revision supplied", () => {
  it("shows the version, the short revision and the build date", () => {
    render(
      <AboutModal
        isOpen
        onClose={() => {}}
        appVersion="2.1.0"
        gitSha="5e0adb139bfe433d2e323d6143eb32c153b8bd44"
        buildTime="2026-10-20T19:59:41Z"
      />
    );
    const text = aboutText();
    expect(text).toContain("Version 2.1.0");
    expect(text).toContain("Revision 5e0adb1");
    expect(text).not.toContain("unavailable");
    expect(text).not.toMatch(/\(dev\)|dev build/);
  });
});

describe("AboutModal — revision genuinely unavailable", () => {
  it("never claims a development build, and keeps version and build date", () => {
    render(
      <AboutModal
        isOpen
        onClose={() => {}}
        appVersion="2.1.0"
        gitSha="unknown"
        buildTime="2026-10-20T19:59:41Z"
      />
    );
    const text = aboutText();
    // The release version is known even when the commit is not.
    expect(text).toContain("Version 2.1.0");
    // The revision is optional provenance: omitted when unknown, not guessed.
    expect(text).not.toContain("Revision");
    // The regression: a missing SHA must not be reported as a dev build.
    expect(text).not.toMatch(/\(dev\)|dev build|development build/);
    // The build timestamp is always stamped by the build-info stage, so a
    // missing SHA must not suppress it.
    expect(text).not.toContain("Built unavailable");
  });

  it("treats an empty-string SHA the same as unknown", () => {
    render(<AboutModal isOpen onClose={() => {}} appVersion="2.1.0" gitSha="" buildTime="2026-10-20T19:59:41Z" />);
    expect(aboutText()).not.toContain("Revision");
  });

  it("reports an unparseable build time as unavailable, never 'Invalid Date'", () => {
    render(<AboutModal isOpen onClose={() => {}} appVersion="2.1.0" gitSha="abc1234" buildTime="not-a-timestamp" />);
    const text = aboutText();
    expect(text).not.toContain("Invalid Date");
    expect(text).toContain("Built unavailable");
  });

  it("links to the canonical repository, not the stale owner", () => {
    render(<AboutModal isOpen onClose={() => {}} appVersion="2.1.0" gitSha="abc1234" buildTime="2026-10-20T19:59:41Z" />);
    const link = Array.from(document.querySelectorAll("a")).find((a) => a.href.includes("github.com"));
    expect(link.href).toBe("https://github.com/bstrauss84/openshift-airgap-architect");
    expect(link.href).not.toContain("billstrauss");
  });
});

describe("ToolsDrawer — build identity line", () => {
  it("shows version and revision when both are supplied", () => {
    render(<ToolsDrawer {...drawerProps} buildInfo={{ version: "2.1.0", gitSha: "5e0adb139bfe", buildTime: "2026-10-20T19:59:41Z", branch: "main" }} />);
    const text = drawerBuildText();
    expect(text).toContain("Version 2.1.0");
    expect(text).toContain("Revision 5e0adb1");
  });

  it("omits an unknown revision rather than showing 'Build unknown' or 'dev'", () => {
    render(<ToolsDrawer {...drawerProps} buildInfo={{ version: "2.1.0", gitSha: "unknown", buildTime: "2026-10-20T19:59:41Z", branch: "main" }} />);
    const text = drawerBuildText();
    expect(text).not.toContain("Revision");
    expect(text).not.toContain("unknown");
    expect(text).not.toMatch(/\bdev\b/);
    // The version must still be visible; it previously was not shown at all.
    expect(text).toContain("Version 2.1.0");
  });

  it("never presents the configured APP_BRANCH as the build's source branch", () => {
    // /api/build-info reports branch "main" because Compose sets APP_BRANCH=main
    // unconditionally. That is configuration, not provenance, so it is not shown.
    render(<ToolsDrawer {...drawerProps} buildInfo={{ version: "2.1.0", gitSha: "unknown", buildTime: "2026-10-20T19:59:41Z", branch: "main" }} />);
    const text = drawerBuildText();
    expect(text).not.toContain("main");
    expect(document.querySelector(".about-branch")).toBeNull();
  });

  it("OMITS the branch entirely when none was supplied, rather than asserting 'main'", () => {
    render(<ToolsDrawer {...drawerProps} buildInfo={{ version: "2.1.0", gitSha: "abc1234", buildTime: "2026-10-20T19:59:41Z" }} />);
    const text = drawerBuildText();
    expect(text).not.toContain("main");
    expect(text).toContain("Revision abc1234");
  });

  it("omits the build time when it is unknown instead of printing the word", () => {
    render(<ToolsDrawer {...drawerProps} buildInfo={{ version: "2.1.0", gitSha: "abc1234", buildTime: "unknown", branch: "develop" }} />);
    const text = drawerBuildText();
    expect(text).not.toContain("unknown");
    expect(text).not.toContain("develop");
  });
});
