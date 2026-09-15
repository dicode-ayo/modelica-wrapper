# Changelog

## [0.0.2](https://github.com/dicode-ayo/modelica-wrapper/compare/@dicode/modelica-mcp-v0.0.1...@dicode/modelica-mcp-v0.0.2) (2026-09-15)


### Features

* **mcp:** publish saveClass so an edit outlives OMC's memory ([#682](https://github.com/dicode-ayo/modelica-wrapper/issues/682)) ([9385299](https://github.com/dicode-ayo/modelica-wrapper/commit/9385299fb668287490e2a294d43953e4f2b85799))


### Bug Fixes

* **mcp-server:** describe fixed-length tuples so every client accepts them ([#691](https://github.com/dicode-ayo/modelica-wrapper/issues/691)) ([2535be1](https://github.com/dicode-ayo/modelica-wrapper/commit/2535be1e0554e4f634ab6aca239fa81e11646eef))
* **mcp-server:** gate save through the write verdict ([#665](https://github.com/dicode-ayo/modelica-wrapper/issues/665)) ([4d5def6](https://github.com/dicode-ayo/modelica-wrapper/commit/4d5def6817b832164a5e8cca7da73820c460a7cd)), closes [#654](https://github.com/dicode-ayo/modelica-wrapper/issues/654)
* **mcp-server:** judge a write by the Modelica text it carries ([#680](https://github.com/dicode-ayo/modelica-wrapper/issues/680)) ([03683b7](https://github.com/dicode-ayo/modelica-wrapper/commit/03683b7d695b2530af4faf9db6217a398b8d6e3b)), closes [#673](https://github.com/dicode-ayo/modelica-wrapper/issues/673)
* **omc-client:** validate command arguments before interpolating them ([#664](https://github.com/dicode-ayo/modelica-wrapper/issues/664)) ([1546a49](https://github.com/dicode-ayo/modelica-wrapper/commit/1546a495a3f981bf6020a53607b11d43f19c2268)), closes [#656](https://github.com/dicode-ayo/modelica-wrapper/issues/656)


### Code Refactoring

* **omc-client:** share the working directory OMC builds into ([#690](https://github.com/dicode-ayo/modelica-wrapper/issues/690)) ([c303055](https://github.com/dicode-ayo/modelica-wrapper/commit/c3030556d192f153602e7c59bee56ff96fe7e443))

## 0.0.1 (2026-09-12)


### ⚠ BREAKING CHANGES

* **omc-client:** registry input schemas reject unknown keys. An argument name the function does not have was silently removed from the input; it now raises a ZodError naming the key.

### Features

* **mcp:** publish createClass in place of raw newModel ([#651](https://github.com/dicode-ayo/modelica-wrapper/issues/651)) ([1cdeb43](https://github.com/dicode-ayo/modelica-wrapper/commit/1cdeb4356ed056498828e61654789597a307389c)), closes [#644](https://github.com/dicode-ayo/modelica-wrapper/issues/644)
* ship an MCP server from the extension at OMEdit parity ([#640](https://github.com/dicode-ayo/modelica-wrapper/issues/640)) ([7ccd220](https://github.com/dicode-ayo/modelica-wrapper/commit/7ccd2201f20f574c76f95e5301e676353c47021a))


### Bug Fixes

* **omc-client:** reject an argument name the function does not have ([#650](https://github.com/dicode-ayo/modelica-wrapper/issues/650)) ([b6869f1](https://github.com/dicode-ayo/modelica-wrapper/commit/b6869f15e926dbd32af4d38caf3d19c948d0376e))
