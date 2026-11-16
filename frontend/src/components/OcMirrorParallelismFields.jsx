/**
 * OpenShift Airgap Architect - oc-mirror parallelism fields (v2.2.0 M5, F12)
 *
 * Parallel images / parallel layers, shared by Install "Run oc-mirror" and the
 * Mirroring run options so both offer exactly the range the oc-mirror binary
 * accepts (1–10, shared/ocMirrorCliLimits.js) instead of the 1–32 the Install
 * form used to advertise.
 *
 * Validation follows the design system: the message appears after the field is
 * blurred, after an explicit attempt (`attempted`), or when the server reported
 * the field (`serverErrors`), never on first render. A whole number is committed
 * even when it is out of range, so the server-side checks see what the user
 * sees; anything that is not a whole number is not committed.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import React, { useEffect, useState } from "react";
import FieldLabelWithInfo from "./FieldLabelWithInfo.jsx";
import { OC_MIRROR_CLI_LIMITS, isWithinCliLimit, cliLimitMessage } from "../../../shared/ocMirrorCliLimits.js";

const IMAGES = OC_MIRROR_CLI_LIMITS.parallelImages;
const LAYERS = OC_MIRROR_CLI_LIMITS.parallelLayers;

const FIELDS = [
  {
    key: "parallelImages",
    label: "Parallel images",
    hint: `How many container images oc-mirror copies at the same time (${IMAGES.min}–${IMAGES.max}).

**Default:**
${IMAGES.default}, oc-mirror's own default.

**Range:**
oc-mirror refuses any value outside ${IMAGES.min}–${IMAGES.max} before it starts ("the flag parallel-images must be between the range ${IMAGES.min} to ${IMAGES.max}"). Earlier versions of this form offered up to 32, which the binary never accepted.

**When to raise it:**
Fast, stable links to the source registry with spare memory and CPU on this machine.

**When to lower it:**
Slow or unstable links, registry throttling (HTTP 429), or memory pressure: each image in flight holds its own connections and buffers.

**Example:**
8 on a fast data-centre link; 2 over a slow VPN.`
  },
  {
    key: "parallelLayers",
    label: "Parallel layers",
    hint: `How many image layers oc-mirror copies at the same time (${LAYERS.min}–${LAYERS.max}).

**Default:**
${LAYERS.default}, oc-mirror's own default.

**Range:**
oc-mirror refuses any value outside ${LAYERS.min}–${LAYERS.max} before it starts ("the flag parallel-layers must be between the range ${LAYERS.min} to ${LAYERS.max}").

**What layers are:**
The filesystem chunks an image is made of. Large operator and release images have many.

**Works with Parallel images:**
The two settings multiply: 8 images × 10 layers is up to 80 transfers at once. Tune them together.

**Example:**
Keep ${LAYERS.default} for most mirrors; raise it only on very fast links with large images.`
  }
];

const toWhole = (text) => {
  const t = String(text ?? "").trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};

/**
 * @param {{ values: { parallelImages?: number, parallelLayers?: number },
 *   onCommit: (key: string, value: number) => void, attempted?: boolean,
 *   serverErrors?: Record<string, { message: string }>, idPrefix: string,
 *   disabled?: boolean }} props
 */
export default function OcMirrorParallelismFields({ values, onCommit, attempted = false, serverErrors = {}, idPrefix, disabled = false }) {
  const [text, setText] = useState({
    parallelImages: String(values.parallelImages ?? IMAGES.default),
    parallelLayers: String(values.parallelLayers ?? LAYERS.default)
  });
  const [touched, setTouched] = useState({});

  useEffect(() => {
    setText((prev) => ({ ...prev, parallelImages: String(values.parallelImages ?? IMAGES.default) }));
  }, [values.parallelImages]);
  useEffect(() => {
    setText((prev) => ({ ...prev, parallelLayers: String(values.parallelLayers ?? LAYERS.default) }));
  }, [values.parallelLayers]);

  return FIELDS.map(({ key, label, hint }) => {
    const whole = toWhole(text[key]);
    const localError = whole === null || !isWithinCliLimit(key, whole) ? cliLimitMessage(key, label) : "";
    const message = localError || serverErrors[key]?.message || "";
    const visible = Boolean(message) && (touched[key] || attempted || Boolean(serverErrors[key]));
    const errorId = `${idPrefix}-${key}-error`;
    const limit = OC_MIRROR_CLI_LIMITS[key];
    return (
      <div className="field-control-stack" key={key}>
        <FieldLabelWithInfo label={label} hint={hint}>
          <input
            id={`${idPrefix}-${key}`}
            type="number"
            inputMode="numeric"
            min={limit.min}
            max={limit.max}
            step={1}
            value={text[key]}
            disabled={disabled}
            className={visible ? "input-error" : ""}
            aria-invalid={visible ? "true" : undefined}
            aria-describedby={visible ? errorId : undefined}
            onChange={(e) => setText((prev) => ({ ...prev, [key]: e.target.value }))}
            onBlur={() => {
              setTouched((prev) => ({ ...prev, [key]: true }));
              if (whole !== null && whole !== values[key]) onCommit(key, whole);
            }}
          />
        </FieldLabelWithInfo>
        <div className="field-control-support">
          {visible ? <span id={errorId} className="field-error" role="alert">{message}</span> : null}
          <div className="field-helper">{limit.min}–{limit.max}, default {limit.default}</div>
        </div>
      </div>
    );
  });
}
