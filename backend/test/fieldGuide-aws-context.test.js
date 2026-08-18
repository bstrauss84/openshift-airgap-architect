/**
 * Field Guide AWS Context Tests (DOC-103 FG-4.21-AWS-CONTEXT)
 *
 * Proves:
 * - AMI procedure uses openshift-install coreos print-stream-json (not aws ec2 describe-images)
 * - Architecture path renders correctly for x86_64 and aarch64
 * - Configured AWS region appears in rendered commands
 * - Missing region falls back to explicit placeholder, not us-gov-east-1
 * - buildContext propagates blueprint.arch and safe awsRegion
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildContext } from "../src/fieldGuide/context.js";
import { render } from "../src/fieldGuide/template.js";

// Import compartments for direct inspection
import { awsGovCloudPrereqs as prereqs420 } from "../src/fieldGuide/v4.20/aws.js";
import { awsGovCloudPrereqs as prereqs421 } from "../src/fieldGuide/v4.21/aws.js";

const makeState = (overrides = {}) => ({
  blueprint: {
    arch: "x86_64",
    platform: "AWS GovCloud",
    baseDomain: "example.com",
    clusterName: "test-cluster",
    ...(overrides.blueprint || {}),
  },
  release: { patchVersion: "4.20.0", ...(overrides.release || {}) },
  version: { selectedMinor: "4.20", _schemaVersion: 3, ...(overrides.version || {}) },
  methodology: { method: "IPI" },
  platformConfig: {
    aws: { region: "", ...(overrides.aws || {}) },
    ...(overrides.platformConfig || {}),
  },
  ...(overrides.rest || {}),
});

describe("buildContext architecture propagation (DOC-103)", () => {
  it("propagates blueprint.arch as arch", () => {
    const ctx = buildContext(makeState({ blueprint: { arch: "x86_64" } }));
    assert.equal(ctx.arch, "x86_64");
  });

  it("propagates aarch64 arch", () => {
    const ctx = buildContext(makeState({ blueprint: { arch: "aarch64" } }));
    assert.equal(ctx.arch, "aarch64");
  });

  it("missing arch falls back to placeholder", () => {
    const ctx = buildContext(makeState({ blueprint: { arch: undefined } }));
    assert.equal(ctx.arch, "<architecture>");
  });

  it("empty arch falls back to placeholder", () => {
    const ctx = buildContext(makeState({ blueprint: { arch: "" } }));
    assert.equal(ctx.arch, "<architecture>");
  });
});

describe("buildContext awsRegion safety (DOC-103)", () => {
  it("platformConfig.aws.region wins when populated", () => {
    const ctx = buildContext(makeState({ aws: { region: "us-gov-west-1" } }));
    assert.equal(ctx.awsRegion, "us-gov-west-1");
  });

  it("blueprint.awsRegion is used as fallback when platformConfig.aws.region is empty", () => {
    const state = makeState();
    state.blueprint.awsRegion = "us-gov-east-1";
    const ctx = buildContext(state);
    assert.equal(ctx.awsRegion, "us-gov-east-1");
  });

  it("missing region does not fall back to us-gov-east-1", () => {
    const ctx = buildContext(makeState());
    assert.notEqual(ctx.awsRegion, "us-gov-east-1");
  });

  it("missing region falls back to explicit placeholder", () => {
    const ctx = buildContext(makeState());
    assert.equal(ctx.awsRegion, "<aws-region>");
  });
});

describe("4.20 AWS AMI procedure (DOC-103)", () => {
  const amiItem = prereqs420.items.find((item) =>
    item.text.includes("RHCOS AMI ID")
  );

  it("AMI item exists", () => {
    assert(amiItem, "Should have an AMI discovery item");
  });

  it("uses openshift-install coreos print-stream-json", () => {
    assert(
      amiItem.cmd.includes("openshift-install coreos print-stream-json"),
      `AMI cmd should use openshift-install, got: ${amiItem.cmd}`
    );
  });

  it("does not use aws ec2 describe-images", () => {
    assert(
      !amiItem.cmd.includes("aws ec2 describe-images"),
      "AMI cmd should not use aws ec2 describe-images"
    );
  });

  it("does not use rhcos-*4.20* filter", () => {
    assert(
      !amiItem.cmd.includes("rhcos-*4.20*"),
      "AMI cmd should not use rhcos-*4.20* filter"
    );
  });

  it("contains architecture template variable", () => {
    assert(
      amiItem.cmd.includes("{{arch}}"),
      `AMI cmd should include {{arch}}, got: ${amiItem.cmd}`
    );
  });

  it("contains region template variable", () => {
    assert(
      amiItem.cmd.includes("{{awsRegion}}"),
      `AMI cmd should include {{awsRegion}}, got: ${amiItem.cmd}`
    );
  });

  describe("4.20 x86_64 rendering", () => {
    const ctx = buildContext(
      makeState({ blueprint: { arch: "x86_64" }, aws: { region: "us-gov-west-1" } })
    );

    it("renders x86_64 architecture path", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"x86_64"'),
        `Rendered cmd should contain "x86_64", got: ${rendered}`
      );
    });

    it("renders configured region", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"us-gov-west-1"'),
        `Rendered cmd should contain "us-gov-west-1", got: ${rendered}`
      );
    });

    it("does not contain aws ec2 describe-images", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        !rendered.includes("aws ec2 describe-images"),
        "Rendered cmd should not contain aws ec2 describe-images"
      );
    });

    it("does not contain rhcos-*4.20*", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        !rendered.includes("rhcos-*4.20*"),
        "Rendered cmd should not contain rhcos-*4.20*"
      );
    });
  });

  describe("4.20 aarch64 rendering", () => {
    const ctx = buildContext(
      makeState({ blueprint: { arch: "aarch64" }, aws: { region: "us-gov-east-1" } })
    );

    it("renders aarch64 architecture path", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"aarch64"'),
        `Rendered cmd should contain "aarch64", got: ${rendered}`
      );
    });

    it("does not substitute x86_64 for aarch64", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        !rendered.includes('"x86_64"'),
        `Rendered cmd should not contain "x86_64" when arch is aarch64`
      );
    });

    it("renders configured region", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"us-gov-east-1"'),
        `Rendered cmd should contain "us-gov-east-1", got: ${rendered}`
      );
    });
  });
});

describe("4.21 AWS AMI procedure (DOC-103)", () => {
  const amiItem = prereqs421.items.find((item) =>
    item.text.includes("RHCOS AMI ID")
  );

  it("AMI item exists", () => {
    assert(amiItem, "Should have an AMI discovery item");
  });

  it("uses openshift-install coreos print-stream-json", () => {
    assert(
      amiItem.cmd.includes("openshift-install coreos print-stream-json"),
      `AMI cmd should use openshift-install, got: ${amiItem.cmd}`
    );
  });

  it("does not use aws ec2 describe-images", () => {
    assert(
      !amiItem.cmd.includes("aws ec2 describe-images"),
      "AMI cmd should not use aws ec2 describe-images"
    );
  });

  it("does not use rhcos-*4.20* filter", () => {
    assert(
      !amiItem.cmd.includes("rhcos-*4.20*"),
      "AMI cmd should not use rhcos-*4.20* filter"
    );
  });

  it("contains architecture template variable", () => {
    assert(
      amiItem.cmd.includes("{{arch}}"),
      `AMI cmd should include {{arch}}, got: ${amiItem.cmd}`
    );
  });

  describe("4.21 x86_64 rendering", () => {
    const ctx = buildContext(
      makeState({
        blueprint: { arch: "x86_64" },
        aws: { region: "us-gov-west-1" },
        release: { patchVersion: "4.21.0" },
        version: { selectedMinor: "4.21", _schemaVersion: 3 },
      })
    );

    it("renders x86_64 architecture path", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"x86_64"'),
        `Rendered cmd should contain "x86_64", got: ${rendered}`
      );
    });

    it("renders configured region", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"us-gov-west-1"'),
        `Rendered cmd should contain "us-gov-west-1", got: ${rendered}`
      );
    });

    it("does not contain aws ec2 describe-images", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        !rendered.includes("aws ec2 describe-images"),
        "Rendered cmd should not contain aws ec2 describe-images"
      );
    });
  });

  describe("4.21 aarch64 rendering", () => {
    const ctx = buildContext(
      makeState({
        blueprint: { arch: "aarch64" },
        aws: { region: "us-gov-east-1" },
        release: { patchVersion: "4.21.0" },
        version: { selectedMinor: "4.21", _schemaVersion: 3 },
      })
    );

    it("renders aarch64 architecture path", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"aarch64"'),
        `Rendered cmd should contain "aarch64", got: ${rendered}`
      );
    });

    it("does not substitute x86_64 for aarch64", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        !rendered.includes('"x86_64"'),
        `Rendered cmd should not contain "x86_64" when arch is aarch64`
      );
    });

    it("renders configured region", () => {
      const rendered = render(amiItem.cmd, ctx);
      assert(
        rendered.includes('"us-gov-east-1"'),
        `Rendered cmd should contain "us-gov-east-1", got: ${rendered}`
      );
    });
  });
});

describe("missing-region rendering (DOC-103)", () => {
  const ctx = buildContext(makeState());
  const amiItem420 = prereqs420.items.find((item) =>
    item.text.includes("RHCOS AMI ID")
  );
  const amiItem421 = prereqs421.items.find((item) =>
    item.text.includes("RHCOS AMI ID")
  );

  it("4.20 AMI cmd renders placeholder when region is missing", () => {
    const rendered = render(amiItem420.cmd, ctx);
    assert(
      rendered.includes("<aws-region>"),
      `Missing region should render as <aws-region>, got: ${rendered}`
    );
  });

  it("4.21 AMI cmd renders placeholder when region is missing", () => {
    const rendered = render(amiItem421.cmd, ctx);
    assert(
      rendered.includes("<aws-region>"),
      `Missing region should render as <aws-region>, got: ${rendered}`
    );
  });

  it("4.20 AMI text renders placeholder when region is missing", () => {
    const rendered = render(amiItem420.text, ctx);
    assert(
      rendered.includes("<aws-region>"),
      `Missing region text should render as <aws-region>, got: ${rendered}`
    );
  });

  it("missing region never renders as us-gov-east-1 in AMI cmd", () => {
    const stateNoRegion = makeState();
    const ctxNoRegion = buildContext(stateNoRegion);
    const rendered = render(amiItem420.cmd, ctxNoRegion);
    assert(
      !rendered.includes("us-gov-east-1"),
      `Missing region should not render as us-gov-east-1, got: ${rendered}`
    );
  });
});

describe("v4.21 aws.js line 29 unchanged (DOC-103)", () => {
  it("line 29 still references OCP 4.20 permissions", () => {
    const permItem = prereqs421.items[2];
    assert(
      permItem.text.includes("OCP 4.20 AWS IPI required permissions"),
      `items[2] should reference OCP 4.20 permissions, got: ${permItem.text}`
    );
  });
});
