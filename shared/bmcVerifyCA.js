const MAX_BMC_VERIFY_CA_BYTES = 262144; // 256 KiB

function validateBmcVerifyCA(value) {
  if (value === undefined || value === null) return { valid: true, blank: true };
  if (typeof value !== "string") return { valid: false, error: "hostInventory.bmcVerifyCA must be a string" };
  if (value.trim() === "") return { valid: true, blank: true };
  if (value.includes("\0")) return { valid: false, error: "hostInventory.bmcVerifyCA contains a NUL byte" };
  const byteLength = new TextEncoder().encode(value).byteLength;
  if (byteLength > MAX_BMC_VERIFY_CA_BYTES) return { valid: false, error: "hostInventory.bmcVerifyCA exceeds 256 KiB (" + byteLength + " bytes)" };
  return { valid: true, value };
}

export { validateBmcVerifyCA, MAX_BMC_VERIFY_CA_BYTES };
