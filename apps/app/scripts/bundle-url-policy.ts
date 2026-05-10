import { strict as assert } from "node:assert";

import { describeBundleUrlTrust, isConfiguredBundlePublisherUrl } from "../src/app/bundles/url-policy";

const trusted = describeBundleUrlTrust(
  "https://share.aiworklabs.com/b/01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "https://share.aiworklabs.com",
);

assert.deepEqual(trusted, {
  trusted: true,
  bundleId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  actualOrigin: "https://share.aiworklabs.com",
  configuredOrigin: "https://share.aiworklabs.com",
});

const untrusted = describeBundleUrlTrust(
  "https://evil.example/b/01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "https://share.aiworklabs.com",
);

assert.deepEqual(untrusted, {
  trusted: false,
  bundleId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  actualOrigin: "https://evil.example",
  configuredOrigin: "https://share.aiworklabs.com",
});

assert.equal(
  isConfiguredBundlePublisherUrl(
    "https://share.aiworklabs.com/b/01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "https://share.aiworklabs.com",
  ),
  true,
);

assert.equal(
  isConfiguredBundlePublisherUrl(
    "https://share.aiworklabs.com/not-a-bundle",
    "https://share.aiworklabs.com",
  ),
  false,
);

console.log("bundle-url-policy ok");
