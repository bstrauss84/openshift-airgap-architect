"""Fixture generator for scripts/security/gitleaks-selftest.sh.

Builds every secret-shaped value AT RUNTIME into a temp directory, so no realistic
credential-shaped literal is committed to the repository and none is ever printed.

DETERMINISM MATTERS HERE. gitleaks' `generic-api-key` rule is entropy-gated: a uniformly
random alphanumeric string occasionally falls below the threshold, which made an earlier
revision of the self-test flake between PASS and FAIL across consecutive runs. Values are
therefore generated with guaranteed character-class diversity via `high_entropy`.

Usage:  python3 -I _selftest_fixtures.py <workdir> <path-to-real-schema-json>
"""

import json
import os
import random
import string
import sys


def high_entropy(n: int) -> str:
    """A length-n token of DISTINCT characters, so Shannon entropy is maximal.

    gitleaks' generic-api-key rule is entropy-gated. Guaranteeing only character-class
    diversity is not enough: a value can still contain enough repeats to fall below the
    threshold, which made this self-test flake roughly 1 run in 8. Sampling WITHOUT
    replacement from the 62-character pool makes every character distinct, which is the
    maximum-entropy arrangement for a given length and removes the flake entirely.

    For n > 62 the pool is exhausted, so successive distinct samples are concatenated.
    """
    pool = string.ascii_letters + string.digits
    out = []
    while len(out) < n:
        take = min(n - len(out), len(pool))
        out.extend(random.sample(pool, take))
    return "".join(out[:n])


def hexish(n: int) -> str:
    """n lowercase hex characters, with every hex digit guaranteed to appear.

    This is the shape that reliably triggers gitleaks' `generic-api-key` rule - exactly
    the shape of the real provenance-SHA false positive the allowlist exists for. Using
    it for the negative controls makes them test the rule the allowlist actually
    touches, rather than hoping a random alphanumeric clears an entropy threshold.

    The rule is entropy-gated, and a hex string drawn uniformly at random can still
    cluster enough to fall below the bar (observed ~1 run in 20). Seeding with a
    shuffled copy of the full hex alphabet guarantees maximal character spread and
    removes the flake.
    """
    alphabet = list("0123456789abcdef")
    out = list(alphabet)
    random.shuffle(out)
    out = out[:n]
    while len(out) < n:
        out.append(random.choice(alphabet))
    random.shuffle(out)
    return "".join(out)


def rnd(n: int, alphabet: str = string.ascii_letters + string.digits) -> str:
    return "".join(random.choice(alphabet) for _ in range(n))


def write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def load_schema(src: str) -> dict:
    try:
        with open(src, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {"provenance": {"apiCommit": "0" * 40}}


def main() -> int:
    work, schema_src = sys.argv[1], sys.argv[2]
    schema_rel = "data/oc-mirror-v2/imageset-config-schema.json"
    schema_dir = os.path.dirname(schema_rel)
    schema_name = os.path.basename(schema_rel)

    # --- A. rules-are-live corpus -----------------------------------------
    # Three structurally detected shapes (prefix/format based, entropy-independent)
    # plus two entropy-gated generic keys built to clear the threshold.
    live = os.path.join(work, "live")
    write(os.path.join(live, "a.txt"), "token = ghp_" + rnd(36) + "\n")
    write(
        os.path.join(live, "d.txt"),
        "slack = xoxb-" + rnd(12, "0123456789") + "-" + rnd(12, "0123456789") + "-" + rnd(24) + "\n",
    )
    write(
        os.path.join(live, "e.txt"),
        "-----BEGIN RSA PRIVATE KEY-----\n" + rnd(64) + "\n-----END RSA PRIVATE KEY-----\n",
    )
    write(os.path.join(live, "b.txt"), 'api_key = "' + high_entropy(40) + '"\n')
    write(os.path.join(live, "c.txt"), 'apiKey: "' + high_entropy(44) + '"\n')

    # --- B. the real file, unmodified: the provenance SHA must be suppressed
    schema = load_schema(schema_src)
    write(os.path.join(work, "fp", schema_dir, schema_name), json.dumps(schema, indent=2))

    # --- C. same file, DIFFERENT field. Catches a path-only exemption. -----
    neg1 = load_schema(schema_src)
    neg1.setdefault("provenance", {})["registryApiKey"] = hexish(40)
    write(os.path.join(work, "neg1", schema_dir, schema_name), json.dumps(neg1, indent=2))

    # --- D. apiCommit-named field in a DIFFERENT path. Catches a field-only
    #        exemption.
    write(
        os.path.join(work, "neg2", "data", "other", "elsewhere.json"),
        json.dumps({"provenance": {"apiCommit": hexish(40)}}, indent=2),
    )

    # --- E. right field, right path, but NOT a 40-hex Git SHA. Catches an
    #        exemption that does not constrain the value shape.
    neg3 = load_schema(schema_src)
    neg3.setdefault("provenance", {})["apiCommit"] = hexish(41)
    write(os.path.join(work, "neg3", schema_dir, schema_name), json.dumps(neg3, indent=2))

    # --- F. a DIFFERENT rule inside the exempted path. Catches an exemption
    #        that is not scoped with targetRules.
    write(
        os.path.join(work, "neg4", schema_dir, schema_name),
        '{\n  "note": "token = ghp_' + rnd(36) + '"\n}\n',
    )
    # --- G. a REAL (synthetic) secret planted in a file that carries an
    #        allowlisted stopword must STILL fire. Proves the stopwords exempt a
    #        value, never a file.
    write(
        os.path.join(work, "neg5", "docs", "UPI_PREP_GUIDES", "bare-metal-upi-prep-guide.md"),
        'Example pull secret:\n\n    {"auths":{"r":{"auth":"dXNlcm5hbWU6cGFzc3dvcmQ="}}}\n\n'
        "Unrelated leaked token: ghp_" + rnd(36) + "\n",
    )

    # --- H. a NEAR-MISS of an allowlisted stopword must STILL fire. Proves the
    #        match is exact-value, not prefix/fuzzy.
    write(
        os.path.join(work, "neg6", "docs", "example.md"),
        '{"auths":{"r":{"auth":"' + hexish(40) + '"}}}\n',
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
