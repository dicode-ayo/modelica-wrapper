# Changelog

## 0.0.1 (2026-09-12)


### ⚠ BREAKING CHANGES

* **omc-client:** registry input schemas reject unknown keys. An argument name the function does not have was silently removed from the input; it now raises a ZodError naming the key.

### Features

* **mcp:** publish createClass in place of raw newModel ([#651](https://github.com/dicode-ayo/modelica-wrapper/issues/651)) ([1cdeb43](https://github.com/dicode-ayo/modelica-wrapper/commit/1cdeb4356ed056498828e61654789597a307389c)), closes [#644](https://github.com/dicode-ayo/modelica-wrapper/issues/644)
* ship an MCP server from the extension at OMEdit parity ([#640](https://github.com/dicode-ayo/modelica-wrapper/issues/640)) ([7ccd220](https://github.com/dicode-ayo/modelica-wrapper/commit/7ccd2201f20f574c76f95e5301e676353c47021a))


### Bug Fixes

* **omc-client:** reject an argument name the function does not have ([#650](https://github.com/dicode-ayo/modelica-wrapper/issues/650)) ([b6869f1](https://github.com/dicode-ayo/modelica-wrapper/commit/b6869f15e926dbd32af4d38caf3d19c948d0376e))
