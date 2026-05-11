/**
 * OpenShift Airgap Architect - Duplicate Hostname Validation Tests
 *
 * Tests duplicate hostname detection across nodes in host inventory.
 * Covers DOC-024: Node drawer data integrity (duplicate hostname validation).
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic) and Cursor AI.
 */

import { describe, it, expect } from "vitest";
import { validateStep } from "../src/validation.js";

describe("Duplicate Hostname Validation", () => {
  const makeBaseState = () => ({
    blueprint: {
      platform: "Bare Metal",
      confirmed: true
    },
    methodology: {
      method: "Agent-Based Installer"
    },
    hostInventory: {
      nodes: []
    }
  });

  const makeNode = (hostname, role = "master") => ({
    hostname,
    role,
    rootDevice: "/dev/sda",
    primary: {
      type: "ethernet",
      mode: "dhcp",
      ethernet: {
        name: "ens192",
        macAddress: "00:50:56:12:34:56"
      }
    }
  });

  it("allows unique hostnames across all nodes", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("master-0"),
      makeNode("master-1"),
      makeNode("master-2")
    ];

    const result = validateStep(state, "inventory-v2");

    // Should have no duplicate hostname errors
    const duplicateErrors = result.errors.filter(err => err.includes("Duplicate hostname"));
    expect(duplicateErrors).toHaveLength(0);
  });

  it("detects duplicate hostnames and reports all affected nodes", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("master-0"),
      makeNode("master-1"),
      makeNode("master-0"), // Duplicate
    ];

    const result = validateStep(state, "inventory-v2");

    // Should have duplicate hostname error
    const duplicateErrors = result.errors.filter(err => err.includes("Duplicate hostname"));
    expect(duplicateErrors.length).toBeGreaterThan(0);

    // Error should mention the duplicate hostname and affected nodes
    const masterDupeError = duplicateErrors.find(err => err.includes("master-0"));
    expect(masterDupeError).toBeDefined();
    expect(masterDupeError).toMatch(/node.*1.*3/i); // Nodes 1 and 3
  });

  it("detects multiple sets of duplicate hostnames", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("master-0"),
      makeNode("master-1"),
      makeNode("master-0"), // Duplicate of node 1
      makeNode("worker-0"),
      makeNode("worker-0"), // Duplicate of node 4
    ];

    const result = validateStep(state, "inventory-v2");

    const duplicateErrors = result.errors.filter(err => err.includes("Duplicate hostname"));

    // Should have errors for both duplicate sets
    expect(duplicateErrors.length).toBeGreaterThan(0);

    const master0Error = duplicateErrors.find(err => err.includes("master-0"));
    const worker0Error = duplicateErrors.find(err => err.includes("worker-0"));

    expect(master0Error).toBeDefined();
    expect(worker0Error).toBeDefined();
  });

  it("detects duplicates among more than 2 nodes with same hostname", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("duplicate"),
      makeNode("duplicate"),
      makeNode("duplicate"),
      makeNode("unique")
    ];

    const result = validateStep(state, "inventory-v2");

    const duplicateErrors = result.errors.filter(err => err.includes("Duplicate hostname") && err.includes("duplicate"));
    expect(duplicateErrors.length).toBeGreaterThan(0);

    // Should mention nodes 1, 2, and 3
    const duplicateError = duplicateErrors[0];
    expect(duplicateError).toMatch(/1/);
    expect(duplicateError).toMatch(/2/);
    expect(duplicateError).toMatch(/3/);
  });

  it("treats hostnames as case-sensitive", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("Master-0"),
      makeNode("master-0"), // Different case
    ];

    const result = validateStep(state, "inventory-v2");

    // Should NOT flag as duplicate (case-sensitive)
    const duplicateErrors = result.errors.filter(err => err.includes("Duplicate hostname"));
    expect(duplicateErrors).toHaveLength(0);
  });

  it("ignores empty or missing hostnames in duplicate detection", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode(""),
      makeNode(""),
      makeNode("master-0")
    ];

    const result = validateStep(state, "inventory-v2");

    // Should have "hostname required" errors but not "duplicate hostname" errors
    const requiredErrors = result.errors.filter(err => err.includes("required"));
    const duplicateErrors = result.errors.filter(err => err.includes("Duplicate hostname"));

    expect(requiredErrors.length).toBeGreaterThan(0); // Missing hostnames
    expect(duplicateErrors).toHaveLength(0); // Empty strings should not be treated as duplicates
  });

  it("includes duplicate error in per-node field errors", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("master-0"),
      makeNode("master-0"), // Duplicate
    ];

    const result = validateStep(state, "inventory-v2");

    // Per-node errors should include duplicate hostname error
    expect(result.perNode).toBeDefined();
    expect(result.perNode.length).toBe(2);

    // Both nodes should have the duplicate error
    const node1Errors = result.perNode[0]?.errors || [];
    const node2Errors = result.perNode[1]?.errors || [];

    const node1HasDuplicateError = node1Errors.some(err => err.includes("Duplicate"));
    const node2HasDuplicateError = node2Errors.some(err => err.includes("Duplicate"));

    expect(node1HasDuplicateError).toBe(true);
    expect(node2HasDuplicateError).toBe(true);
  });

  it("includes duplicate error in per-node fieldErrors for hostname field", () => {
    const state = makeBaseState();
    state.hostInventory.nodes = [
      makeNode("master-0"),
      makeNode("master-0"), // Duplicate
    ];

    const result = validateStep(state, "inventory-v2");

    // Per-node fieldErrors should include hostname field error
    expect(result.perNode[0]?.fieldErrors?.hostname).toBeDefined();
    expect(result.perNode[0]?.fieldErrors?.hostname).toMatch(/Duplicate/i);

    expect(result.perNode[1]?.fieldErrors?.hostname).toBeDefined();
    expect(result.perNode[1]?.fieldErrors?.hostname).toMatch(/Duplicate/i);
  });
});
