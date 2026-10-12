/**
 * OpenShift Airgap Architect - Test Suite
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

/**
 * Text dropped into a field must be COPIED, never moved.
 *
 * Reported on Fedora: dragging a selected pull secret out of a desktop text
 * editor into the Blueprint field inserted it correctly and then DELETED it
 * from the source document. The drag had been negotiated as a move, and the
 * worst possible payload to lose that way is a credential.
 *
 * `SecretInput` already asked for copy on its own wrapper. Every plain
 * `<input type="password">` — BMC, vCenter, Prism Central, the mirror-registry
 * helper — had no drag handling at all. `installTextDropCopyPolicy` covers
 * those from the document.
 *
 * The boundary these tests are careful about: the SOURCE declares
 * `effectAllowed`, and a target may only pick from what the source permits.
 * A move-only source cannot be talked into a copy, so the policy asks when
 * copy is on offer and otherwise leaves the negotiation untouched. It never
 * asks for "move" — asserted directly below rather than inferred.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveTextDropEffect,
  installTextDropCopyPolicy
} from "../src/dragDropCopyPolicy.js";
import SecretInput from "../src/components/SecretInput.jsx";

const testDir = path.dirname(fileURLToPath(import.meta.url));

/** A DataTransfer stand-in that records what the target asked for. */
function makeDataTransfer({ effectAllowed = "copyMove", types = ["text/plain"], text = "" } = {}) {
  return {
    effectAllowed,
    dropEffect: "none",
    types,
    files: [],
    getData: (t) => (t === "text/plain" || t === "text" ? text : ""),
    setData: () => {}
  };
}

const textInput = (type = "text") => {
  const el = document.createElement("input");
  el.setAttribute("type", type);
  return el;
};

afterEach(() => {
  cleanup();
  if (document.__oaaTextDropCopyPolicy) document.__oaaTextDropCopyPolicy();
});

describe("the policy decides copy only where copy is on offer", () => {
  it("requests copy for text dropped on a plain text input", () => {
    expect(resolveTextDropEffect(textInput("text"), makeDataTransfer())).toBe("copy");
  });

  it("requests copy for text dropped on a PASSWORD input", () => {
    // BMC, vCenter, Prism Central and the mirror-registry helper are all this.
    expect(resolveTextDropEffect(textInput("password"), makeDataTransfer())).toBe("copy");
  });

  it("requests copy for text dropped on a textarea", () => {
    expect(resolveTextDropEffect(document.createElement("textarea"), makeDataTransfer())).toBe("copy");
  });

  it("requests copy when the drop lands on a child of a contenteditable", () => {
    const host = document.createElement("div");
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(host, "isContentEditable", { value: true });
    const child = document.createElement("span");
    host.appendChild(child);
    expect(resolveTextDropEffect(child, makeDataTransfer())).toBe("copy");
  });

  it("still requests copy when the source permits everything", () => {
    for (const effectAllowed of ["copy", "copyLink", "all", "uninitialized"]) {
      expect(resolveTextDropEffect(textInput(), makeDataTransfer({ effectAllowed }))).toBe("copy");
    }
  });

  it("leaves a MOVE-ONLY source alone rather than claiming a copy it cannot have", () => {
    /* The honest half. The spec resets a dropEffect the source does not
       permit, so asking would be a no-op that misrepresents what happened. */
    for (const effectAllowed of ["move", "link", "linkMove", "none"]) {
      expect(resolveTextDropEffect(textInput(), makeDataTransfer({ effectAllowed }))).toBeNull();
    }
  });

  it("NEVER resolves to move, for any input it can be given", () => {
    const effects = ["none", "copy", "copyLink", "copyMove", "link", "linkMove", "move", "all", "uninitialized"];
    const targets = [textInput("text"), textInput("password"), document.createElement("textarea"), document.createElement("div")];
    for (const effectAllowed of effects) {
      for (const target of targets) {
        expect(resolveTextDropEffect(target, makeDataTransfer({ effectAllowed }))).not.toBe("move");
      }
    }
  });
});

describe("the policy keeps out of the way of everything else", () => {
  it("ignores a drag carrying FILES, so file-drop zones keep their contract", () => {
    // The PEM and pull-secret upload zones rely on the file payload.
    const dt = makeDataTransfer({ types: ["Files"] });
    expect(resolveTextDropEffect(document.createElement("textarea"), dt)).toBeNull();
  });

  it("ignores a drop on a non-text element", () => {
    expect(resolveTextDropEffect(document.createElement("div"), makeDataTransfer())).toBeNull();
    expect(resolveTextDropEffect(document.createElement("button"), makeDataTransfer())).toBeNull();
  });

  it("ignores a non-text input such as a checkbox", () => {
    expect(resolveTextDropEffect(textInput("checkbox"), makeDataTransfer())).toBeNull();
  });

  it("tolerates a missing dataTransfer", () => {
    expect(resolveTextDropEffect(textInput(), null)).toBeNull();
  });
});

describe("installed on the document, it reaches real fields", () => {
  it("sets copy on dragover for a password input that has no handler of its own", () => {
    installTextDropCopyPolicy(document);
    render(<input type="password" aria-label="BMC password" />);
    const el = screen.getByLabelText("BMC password");
    const dataTransfer = makeDataTransfer();
    fireEvent.dragOver(el, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("sets copy on dragenter too — the agent reads whichever came last", () => {
    installTextDropCopyPolicy(document);
    render(<input type="password" aria-label="vCenter password" />);
    const dataTransfer = makeDataTransfer();
    fireEvent.dragEnter(screen.getByLabelText("vCenter password"), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("does not touch dropEffect for a file drag over a text field", () => {
    installTextDropCopyPolicy(document);
    render(<textarea aria-label="trust bundle" />);
    const dataTransfer = makeDataTransfer({ types: ["Files"] });
    fireEvent.dragOver(screen.getByLabelText("trust bundle"), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");
  });

  it("is idempotent and fully removable", () => {
    const first = installTextDropCopyPolicy(document);
    const second = installTextDropCopyPolicy(document);
    expect(second).toBe(first);
    first();
    render(<input type="password" aria-label="after uninstall" />);
    const dataTransfer = makeDataTransfer();
    fireEvent.dragOver(screen.getByLabelText("after uninstall"), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("none");
  });

  it("is installed by the application entry point", () => {
    // Pins the wiring: the policy is useless if nothing mounts it.
    const main = fs.readFileSync(path.resolve(testDir, "../src/main.jsx"), "utf8");
    expect(main).toMatch(/installTextDropCopyPolicy\(document\)/);
  });
});

describe("SecretInput keeps its own copy request and still inserts the text", () => {
  const renderSecret = (onChange = vi.fn()) => {
    render(<SecretInput value="" onChange={onChange} label="Pull secret (JSON)" />);
    return onChange;
  };

  it("asks for copy on dragover", () => {
    renderSecret();
    const dataTransfer = makeDataTransfer({ text: "{}" });
    fireEvent.dragOver(screen.getByLabelText(/Pull secret/i), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("asks for copy on dragenter", () => {
    renderSecret();
    const dataTransfer = makeDataTransfer({ text: "{}" });
    fireEvent.dragEnter(screen.getByLabelText(/Pull secret/i), { dataTransfer });
    expect(dataTransfer.dropEffect).toBe("copy");
  });

  it("still inserts the dropped text — copy semantics must not break the drop", () => {
    const secret = '{"auths":{"quay.io":{"auth":"T0FBX1RFU1Q="}}}';
    const onChange = renderSecret();
    fireEvent.drop(screen.getByLabelText(/Pull secret/i), {
      dataTransfer: makeDataTransfer({ text: secret })
    });
    expect(onChange).toHaveBeenCalledWith(secret);
  });

  it("paste is unaffected", () => {
    const onChange = renderSecret();
    fireEvent.paste(screen.getByLabelText(/Pull secret/i), {
      clipboardData: { getData: () => '{"auths":{}}' }
    });
    expect(onChange).toHaveBeenCalledWith('{"auths":{}}');
  });

  it("no OAA source file ever requests a move effect", () => {
    /* The product-wide property, asserted over the source rather than one
       component: nothing in the app may ask a drag source to cut. */
    const root = path.resolve(testDir, "../src");
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|jsx)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        if (/dropEffect\s*=\s*["'](move|link)["']/.test(text)) offenders.push(full);
        if (/effectAllowed\s*=\s*["']move["']/.test(text)) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
