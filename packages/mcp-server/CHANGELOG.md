# Changelog

## [0.0.2](https://github.com/dicode-ayo/modelica-wrapper/compare/@dicode/modelica-mcp-v0.0.1...@dicode/modelica-mcp-v0.0.2) (2026-09-20)


### Features

* **mcp:** publish saveClass so an edit outlives OMC's memory ([#682](https://github.com/dicode-ayo/modelica-wrapper/issues/682)) ([9385299](https://github.com/dicode-ayo/modelica-wrapper/commit/9385299fb668287490e2a294d43953e4f2b85799))


### Bug Fixes

* **mcp-server:** describe fixed-length tuples so every client accepts them ([#691](https://github.com/dicode-ayo/modelica-wrapper/issues/691)) ([2535be1](https://github.com/dicode-ayo/modelica-wrapper/commit/2535be1e0554e4f634ab6aca239fa81e11646eef))
* **mcp-server:** gate loadFile and loadFiles on the classes they declare ([#694](https://github.com/dicode-ayo/modelica-wrapper/issues/694)) ([1e10e13](https://github.com/dicode-ayo/modelica-wrapper/commit/1e10e132a6801464da0668cba885f58eb197271b))
* **mcp-server:** gate save through the write verdict ([#665](https://github.com/dicode-ayo/modelica-wrapper/issues/665)) ([4d5def6](https://github.com/dicode-ayo/modelica-wrapper/commit/4d5def6817b832164a5e8cca7da73820c460a7cd)), closes [#654](https://github.com/dicode-ayo/modelica-wrapper/issues/654)
* **mcp-server:** gate the file loadString binds its classes to ([#701](https://github.com/dicode-ayo/modelica-wrapper/issues/701)) ([96947c7](https://github.com/dicode-ayo/modelica-wrapper/commit/96947c72336df55e924dfd42fcb34afa9b6eaa1f)), closes [#679](https://github.com/dicode-ayo/modelica-wrapper/issues/679)
* **mcp-server:** gate the file setSourceFile repoints a class at ([#702](https://github.com/dicode-ayo/modelica-wrapper/issues/702)) ([1b393ac](https://github.com/dicode-ayo/modelica-wrapper/commit/1b393ac07b16bb6a8707dc8bcd63810e9ea0fe78)), closes [#700](https://github.com/dicode-ayo/modelica-wrapper/issues/700)
* **mcp-server:** judge a write by the Modelica text it carries ([#680](https://github.com/dicode-ayo/modelica-wrapper/issues/680)) ([03683b7](https://github.com/dicode-ayo/modelica-wrapper/commit/03683b7d695b2530af4faf9db6217a398b8d6e3b)), closes [#673](https://github.com/dicode-ayo/modelica-wrapper/issues/673)
* **mcp-server:** point a published tool name at its own schema, not omc_list_functions ([#708](https://github.com/dicode-ayo/modelica-wrapper/issues/708)) ([7fbe39b](https://github.com/dicode-ayo/modelica-wrapper/commit/7fbe39bb638938eed6fa892c87a106951cd9d3ed))
* **mcp-server:** publish tool schemas at the draft clients hold them to ([#717](https://github.com/dicode-ayo/modelica-wrapper/issues/717)) ([9082cb0](https://github.com/dicode-ayo/modelica-wrapper/commit/9082cb0264100a7a43451db5c276a1c8efbda002)), closes [#714](https://github.com/dicode-ayo/modelica-wrapper/issues/714)
* **mcp-server:** reject an unknown argument in the server's own tool schemas ([#696](https://github.com/dicode-ayo/modelica-wrapper/issues/696)) ([1eda0d3](https://github.com/dicode-ayo/modelica-wrapper/commit/1eda0d3dfc1441df730beaaa265c31638b5a7ae8)), closes [#687](https://github.com/dicode-ayo/modelica-wrapper/issues/687)
* **mcp-server:** render omc_invoke's zod failures as sentences, not the issue array ([#706](https://github.com/dicode-ayo/modelica-wrapper/issues/706)) ([d4efb06](https://github.com/dicode-ayo/modelica-wrapper/commit/d4efb069918aa1efd9c25d587de8eff755c39707))
* **mcp:** describe three tools' actual shape instead of an implied one ([#707](https://github.com/dicode-ayo/modelica-wrapper/issues/707)) ([2ef955f](https://github.com/dicode-ayo/modelica-wrapper/commit/2ef955fa665d50821cb4ad5dbd1dff4f6e3fe01e))
* **omc-client:** drain OMC's error buffer around every mutation, serialized per client ([64841d8](https://github.com/dicode-ayo/modelica-wrapper/commit/64841d8cb9683b5e2d960c5ad26d82c725122ffe))
* **omc-client:** report OMC's reason for a result read it could not perform ([#722](https://github.com/dicode-ayo/modelica-wrapper/issues/722)) ([1bc4e21](https://github.com/dicode-ayo/modelica-wrapper/commit/1bc4e210af5eaa139e3362d139a45f40c60228f5)), closes [#720](https://github.com/dicode-ayo/modelica-wrapper/issues/720) [#681](https://github.com/dicode-ayo/modelica-wrapper/issues/681)
* **omc-client:** stop listFile's description claiming it reads the file ([#705](https://github.com/dicode-ayo/modelica-wrapper/issues/705)) ([2287517](https://github.com/dicode-ayo/modelica-wrapper/commit/22875178f89810008dcf2f2e339e5e364bd06ec0))
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
