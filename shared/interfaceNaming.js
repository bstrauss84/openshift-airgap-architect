/**
 * Canonical host-interface name derivation (Day-1 Agent NMState, domain A).
 *
 * WHY THIS MODULE EXISTS
 *
 * The name of the interface a host row actually produces — the `interfaces[].name`
 * in `agent-config.yaml hosts[].networkConfig`, and the `next-hop-interface` of
 * every route that points at it — was derived independently in six places:
 *
 *   1. frontend/src/steps/HostInventoryV2Step.jsx   `primaryBaseIface` + `suggestedVlanName`
 *   2. frontend/src/components/NodeDrawerAgentContent.jsx  additional-interface
 *      "VLAN Interface Name (auto)" field
 *   3. frontend/src/components/NodeDrawerAgentContent.jsx  route next-hop placeholder
 *   4. frontend/src/validation.js                   `effectiveVlanName`
 *   5. backend/src/generate.js                      `addVlan`
 *   6. backend/src/generate.js                      `getPrimaryInterfaceName`
 *
 * They did not agree. Site 2 checked `ethernet.name` BEFORE `bond.name`, and the
 * UI seeds `ethernet.name` for every new row regardless of its type (see
 * `createInterfaceConfig` / `addAdditionalInterface`), so a VLAN-on-bond row
 * displayed `eno2.100` — a bond MEMBER nic — while the generator correctly
 * emitted `bond0.100`. Site 1 ignored `vlan.baseIface` entirely, so an imported
 * run that carried an explicit base rendered one name and generated another.
 *
 * THE CONTRACT (one definition, used by UI and generator alike)
 *
 *   - An explicit `vlan.name` always wins. It is what the user typed.
 *   - Otherwise a VLAN row is named `<base>.<vlan id>`.
 *   - The base is `vlan.baseIface` when set; otherwise it is derived FROM THE ROW
 *     TYPE: `bond.name` for `vlan-on-bond`, `ethernet.name` for `vlan-on-ethernet`.
 *     Type decides — never "whichever field happens to be populated".
 *   - A bond row is named `bond.name`; an ethernet row `ethernet.name`.
 *
 * FALLBACKS ARE A CALLER DECISION, NOT A DEFAULT HERE
 *
 * The generator substitutes `eth0` / `bond0` for a blank PRIMARY interface name
 * (buildNmState), but substitutes nothing for an ADDITIONAL interface — a blank
 * additional row is skipped outright by `hasResolvableIdentity`. Baking one of
 * those policies in would re-create the drift this module removes, so callers
 * pass the fallbacks that match the surface they render:
 *
 *   primary    → PRIMARY_NAME_FALLBACKS
 *   additional → {} (no substitution; an incomplete row has no name)
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */

/** Interface row types that stack a VLAN on top of a base interface. */
const VLAN_INTERFACE_TYPES = Object.freeze(["vlan-on-ethernet", "vlan-on-bond"]);

/** Interface row types whose base interface is a bond. */
const BOND_INTERFACE_TYPES = Object.freeze(["bond", "vlan-on-bond"]);

/**
 * Name substitutions the generator applies to the PRIMARY interface only.
 * Mirrors backend/src/generate.js buildNmState (`primary.ethernet?.name || "eth0"`,
 * `bond.name || "bond0"`) so the UI can display exactly what will be generated.
 */
const PRIMARY_NAME_FALLBACKS = Object.freeze({ ethernet: "eth0", bond: "bond0" });

const trimmed = (value) => String(value ?? "").trim();

/** @returns {boolean} true when the row type stacks a VLAN. */
function isVlanInterfaceType(type) {
  return VLAN_INTERFACE_TYPES.includes(trimmed(type));
}

/** @returns {boolean} true when the row type is backed by a bond. */
function isBondInterfaceType(type) {
  return BOND_INTERFACE_TYPES.includes(trimmed(type));
}

/**
 * The base (L2) interface a row is built on, BEFORE any VLAN is stacked.
 *
 * `vlan.baseIface` wins when present — an imported run may carry a base that is
 * neither the row's bond nor its ethernet. Otherwise the base is chosen by row
 * TYPE, which is what makes a stale invisible `ethernet.name` on a bond row
 * harmless.
 *
 * @param {object} iface - interface row (`primary` or an `additionalInterfaces[]` entry)
 * @param {{ethernet?: string, bond?: string}} [fallbacks] - substitutions for a blank name
 * @returns {string} base interface name, or "" when unresolvable
 */
function resolveBaseInterfaceName(iface, fallbacks = {}) {
  const explicit = trimmed(iface?.vlan?.baseIface);
  if (explicit) return explicit;
  return isBondInterfaceType(iface?.type)
    ? trimmed(iface?.bond?.name) || trimmed(fallbacks.bond)
    : trimmed(iface?.ethernet?.name) || trimmed(fallbacks.ethernet);
}

/**
 * The VLAN interface name a row produces.
 *
 * @param {object} iface - interface row
 * @param {{ethernet?: string, bond?: string}} [fallbacks]
 * @returns {string} `vlan.name` when set, else `<base>.<id>`, else "" when the
 *   row is incomplete (no base or no VLAN id). "" is deliberate: an incomplete
 *   row has no NMState identity, and the generator's name invariant rejects it.
 */
function resolveVlanInterfaceName(iface, fallbacks = {}) {
  const explicitName = trimmed(iface?.vlan?.name);
  if (explicitName) return explicitName;
  const base = resolveBaseInterfaceName(iface, fallbacks);
  const id = trimmed(iface?.vlan?.id);
  return base && id ? `${base}.${id}` : "";
}

/**
 * The name of the interface that actually carries L3 for this row — the one an
 * IP address is assigned to and the one a route's `next-hop-interface` names.
 *
 * For a VLAN row that is the VLAN interface; for a bond row the bond; otherwise
 * the ethernet device. A VLAN row that has a base but no id degrades to the
 * base rather than to "", so a route next-hop never silently becomes blank
 * while the user is still typing the VLAN id.
 *
 * @param {object} iface - interface row
 * @param {{ethernet?: string, bond?: string}} [fallbacks]
 * @returns {string} effective interface name, or "" when unresolvable
 */
function resolveEffectiveInterfaceName(iface, fallbacks = {}) {
  if (isVlanInterfaceType(iface?.type)) {
    return resolveVlanInterfaceName(iface, fallbacks) || resolveBaseInterfaceName(iface, fallbacks);
  }
  return resolveBaseInterfaceName(iface, fallbacks);
}

export {
  VLAN_INTERFACE_TYPES,
  BOND_INTERFACE_TYPES,
  PRIMARY_NAME_FALLBACKS,
  isVlanInterfaceType,
  isBondInterfaceType,
  resolveBaseInterfaceName,
  resolveVlanInterfaceName,
  resolveEffectiveInterfaceName
};
