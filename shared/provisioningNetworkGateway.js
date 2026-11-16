/**
 * platform.baremetal.provisioningNetworkGateway — shared validation.
 *
 * New at OpenShift 4.22. Red Hat documents three constraints, verbatim, in the
 * OCP 4.22 Provisioning APIs book, Chapter 13 "Provisioning [metal3.io/v1alpha1]"
 * §13.1.1 `.spec`:
 *
 *   "This field is optional and only used when ProvisioningNetwork is set to
 *    Managed. The gateway IP must be within the ProvisioningNetworkCIDR but
 *    outside of the ProvisioningDHCPRange and must not be the same as
 *    ProvisioningIP."
 *
 * ADDRESS FAMILY: IPv4 **and** IPv6, established from the exact 4.22.16 source
 * rather than from the surrounding UI code:
 *
 *   - `pkg/types/baremetal/validation/platform.go` parses the gateway with
 *     `net.ParseIP`, which accepts both families, and the kubebuilder marker is
 *     `+kubebuilder:validation:Format=ip`, not `ipv4`;
 *   - containment is `ProvisioningNetworkCIDR.Contains(gatewayIP)` on an
 *     `ipnet.IPNet`, which is family-agnostic — and Red Hat's own
 *     `provisioningNetworkCIDR` text discusses IPv6 provisioning networks
 *     ("When using IPv6 ... this cannot be a network larger than a /64");
 *   - the DHCP-range endpoints are likewise `net.ParseIP`;
 *   - the equality check against `ClusterProvisioningIP` is a plain comparison.
 *
 * So every relational constraint applies to both families, and this module
 * implements them for both. An earlier draft format-checked IPv6 and then
 * silently skipped all three relations, which is strictly worse than rejecting
 * it: the value looked validated and was not.
 *
 * WHY THE TOOL CHECKS THESE ITSELF
 *
 * Against the exact released openshift-install 4.22.16 only the IP-FORMAT
 * rejection fires. The installer's own DHCP-overlap rule is inert — a gateway
 * inside the allocated range was accepted at validation time (mechanical delta
 * ledger D1), and the pre-existing clusterProvisioningIP check of the same code
 * shape is equally inert, so this is a shared mechanism rather than a 4.22
 * regression. An overlapping gateway therefore passes `create manifests` and
 * fails later, during provisioning.
 *
 * Two consequences, pulling in opposite directions:
 *   - the tool must NOT rely on the installer to catch the relationships, so it
 *     checks them here;
 *   - the tool must NOT tell the user the installer enforces them, so no message
 *     claims installer rejection.
 *
 * One implementation, used by both boundaries: `frontend/src/validation.js` for
 * live feedback and `backend/src/generate.js` before emission.
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** @returns {boolean} dotted-quad IPv4 with octets 0-255 and no leading zeros oddities. */
function isIpv4(value) {
  const m = IPV4_RE.exec(String(value ?? "").trim());
  if (!m) return false;
  return m.slice(1).every((o) => {
    const n = Number(o);
    return String(n) === o.replace(/^0+(?=\d)/, "") && n >= 0 && n <= 255;
  });
}

function ipv4ToBigInt(addr) {
  return addr
    .trim()
    .split(".")
    .reduce((acc, oct) => (acc << 8n) + BigInt(Number(oct)), 0n);
}

/**
 * Parse an IPv6 address, including `::` compression and a trailing IPv4 tail.
 * @returns {bigint|null}
 */
function ipv6ToBigInt(value) {
  let v = String(value ?? "").trim();
  if (!v.includes(":")) return null;
  if (v.includes("%")) v = v.slice(0, v.indexOf("%")); // drop any zone id
  if ((v.match(/::/g) || []).length > 1) return null;

  // A trailing dotted-quad becomes two hextets.
  const lastColon = v.lastIndexOf(":");
  const tail = v.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIpv4(tail)) return null;
    const n = ipv4ToBigInt(tail);
    v = `${v.slice(0, lastColon + 1)}${((n >> 16n) & 0xffffn).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }

  const [headRaw, tailRaw, extra] = v.split("::");
  if (extra !== undefined) return null;
  const split = (s) => (s ? s.split(":") : []);
  const head = split(headRaw);
  const rest = v.includes("::") ? split(tailRaw) : [];
  if (!v.includes("::") && head.length !== 8) return null;
  if (head.length + rest.length > 8) return null;

  const groups = v.includes("::")
    ? [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest]
    : head;
  if (groups.length !== 8) return null;

  let out = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    out = (out << 16n) + BigInt(parseInt(g, 16));
  }
  return out;
}

/** True for anything that parses as IPv6 (used for shape checks, not comparison). */
function isIpv6(value) {
  return ipv6ToBigInt(value) !== null;
}

/**
 * Parse an address into a comparable form.
 *
 * IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is normalised to family 4 so it compares
 * equal to the same address written in dotted-quad form, which is how Go's
 * net.IP behaves.
 *
 * @returns {{family: 4|6, value: bigint}|null}
 */
function parseIp(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (isIpv4(v)) return { family: 4, value: ipv4ToBigInt(v) };
  const six = ipv6ToBigInt(v);
  if (six === null) return null;
  const V4_MAPPED_PREFIX = 0xffffn << 32n;
  if (six >> 32n === V4_MAPPED_PREFIX >> 32n) {
    return { family: 4, value: six & 0xffffffffn };
  }
  return { family: 6, value: six };
}

/**
 * Parse a CIDR into an inclusive range.
 * @returns {{family: 4|6, start: bigint, end: bigint}|null}
 */
function parseCidr(value) {
  const raw = String(value ?? "").trim();
  const slash = raw.lastIndexOf("/");
  if (slash === -1) return null;
  const base = parseIp(raw.slice(0, slash));
  const bits = Number(raw.slice(slash + 1));
  if (!base) return null;
  const width = base.family === 4 ? 32 : 128;
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return null;
  const hostBits = BigInt(width - bits);
  const start = (base.value >> hostBits) << hostBits;
  const end = start + ((1n << hostBits) - 1n);
  return { family: base.family, start, end };
}

/** Back-compat shim for callers that only need an integer range for IPv4. */
function cidrRange(cidr) {
  const r = parseCidr(cidr);
  if (!r || r.family !== 4) return null;
  return { start: Number(r.start), end: Number(r.end) };
}

/**
 * Validate the gateway and its documented relationships.
 *
 * Relationship checks are SKIPPED (not failed) when the field they compare
 * against is absent or itself unparseable: that neighbouring field raises its
 * own error, and a derived failure on top of it would be noise.
 *
 * An address-family MISMATCH is not skipped. A gateway outside the provisioning
 * network is reported as such regardless of why, which is exactly what the
 * installer's `ProvisioningNetworkCIDR.Contains()` does for a cross-family
 * address.
 *
 * @param {object} args
 * @param {string} [args.gateway]
 * @param {string} [args.provisioningNetwork] Managed | Unmanaged | Disabled
 * @param {string} [args.cidr]
 * @param {string} [args.dhcpRange] "start,end"
 * @param {string} [args.clusterProvisioningIP]
 * @returns {{valid: boolean, blank: boolean, value?: string, family?: 4|6,
 *            applicable: boolean, errors: string[]}}
 */
function validateProvisioningNetworkGateway({
  gateway,
  provisioningNetwork,
  cidr,
  dhcpRange,
  clusterProvisioningIP,
} = {}) {
  const raw = typeof gateway === "string" ? gateway.trim() : gateway == null ? "" : null;
  if (raw === null) {
    return {
      valid: false,
      blank: false,
      applicable: false,
      errors: ["hostInventory.provisioningNetworkGateway must be a string"],
    };
  }
  // "Only used when ProvisioningNetwork is set to Managed." An absent mode is
  // treated as not-Managed: applicability has not been established, and
  // guessing Managed would emit a field the installer ignores.
  const applicable = provisioningNetwork === "Managed";
  if (!raw) return { valid: true, blank: true, applicable, errors: [] };

  const gw = parseIp(raw);
  if (!gw) {
    return {
      valid: false,
      blank: false,
      value: raw,
      applicable,
      errors: ["Provisioning network gateway must be a valid IP address."],
    };
  }

  const errors = [];
  const net_ = parseCidr(cidr);
  if (net_) {
    if (net_.family !== gw.family) {
      errors.push(
        `Provisioning network gateway (${raw}) is IPv${gw.family} but the provisioning network CIDR (${String(cidr).trim()}) is IPv${net_.family}. The gateway must be inside the provisioning network.`
      );
    } else if (gw.value < net_.start || gw.value > net_.end) {
      errors.push(
        `Provisioning network gateway (${raw}) is outside provisioning network CIDR (${String(cidr).trim()}).`
      );
    }
  }

  const parts = String(dhcpRange ?? "").split(",").map((p) => p.trim());
  if (parts.length === 2) {
    const start = parseIp(parts[0]);
    const end = parseIp(parts[1]);
    // Only compare when the range is well formed AND in the gateway's family;
    // a mixed-family range is the range's own defect, reported on that field.
    if (start && end && start.family === end.family && start.family === gw.family) {
      if (gw.value >= start.value && gw.value <= end.value) {
        errors.push(
          `Provisioning network gateway (${raw}) falls inside the provisioning DHCP range (${String(dhcpRange).trim()}). The gateway must be outside the DHCP range.`
        );
      }
    }
  }

  const cpip = parseIp(clusterProvisioningIP);
  if (cpip && cpip.family === gw.family && cpip.value === gw.value) {
    errors.push(
      `Provisioning network gateway (${raw}) must not be the same address as the cluster provisioning IP.`
    );
  }

  return { valid: errors.length === 0, blank: false, value: raw, family: gw.family, applicable, errors };
}

export { validateProvisioningNetworkGateway, isIpv4, isIpv6, parseIp, parseCidr, cidrRange };
