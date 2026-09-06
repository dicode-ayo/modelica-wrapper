# Changelog

## [0.0.4](https://github.com/dicode-ayo/modelica-wrapper/compare/modelica-wrapper-v0.0.3...modelica-wrapper-v0.0.4) (2026-09-06)


### Features

* **extension:** install OpenModelica from the editor ([#570](https://github.com/dicode-ayo/modelica-wrapper/issues/570)) ([c12726c](https://github.com/dicode-ayo/modelica-wrapper/commit/c12726cc96e0e379668602d1eda220098206779d))
* **extension:** surface which OpenModelica the extension uses ([#567](https://github.com/dicode-ayo/modelica-wrapper/issues/567)) ([8a38aa5](https://github.com/dicode-ayo/modelica-wrapper/commit/8a38aa5ad34a6f3db966c473f7e1375b3b76445e)), closes [#563](https://github.com/dicode-ayo/modelica-wrapper/issues/563)
* **omc-bootstrap:** discard the package cache once a prefix has landed ([#572](https://github.com/dicode-ayo/modelica-wrapper/issues/572)) ([fd9e62f](https://github.com/dicode-ayo/modelica-wrapper/commit/fd9e62f2d208ec2db9835b96ddbf18cf725ab0b0))
* **omc-bootstrap:** install OpenModelica from a committed lockfile ([#589](https://github.com/dicode-ayo/modelica-wrapper/issues/589)) ([fec79df](https://github.com/dicode-ayo/modelica-wrapper/commit/fec79df905864608bb170a43b4bc07f07f7c26c1))
* **omc-client:** announce OMC mutations from the call seam ([#582](https://github.com/dicode-ayo/modelica-wrapper/issues/582)) ([e1a3014](https://github.com/dicode-ayo/modelica-wrapper/commit/e1a3014e9abd4283c77e8bb3d77ad226e14dff44)), closes [#577](https://github.com/dicode-ayo/modelica-wrapper/issues/577)


### Bug Fixes

* **deps:** update dependency lit to ^3.3.3 ([#521](https://github.com/dicode-ayo/modelica-wrapper/issues/521)) ([a120e52](https://github.com/dicode-ayo/modelica-wrapper/commit/a120e525d86f57562052e8f239c7654394df811d))
* **deps:** update dependency web-tree-sitter to ^0.27.0 ([#528](https://github.com/dicode-ayo/modelica-wrapper/issues/528)) ([1d84cff](https://github.com/dicode-ayo/modelica-wrapper/commit/1d84cffce97ca410ff97be72ab43e9c4a258b064))
* **deps:** update dependency zeromq to ^6.6.0 ([#529](https://github.com/dicode-ayo/modelica-wrapper/issues/529)) ([4fbe086](https://github.com/dicode-ayo/modelica-wrapper/commit/4fbe08690da28db661204821cbc08768160d0c55))
* **diagram:** report parameter-field focus from the panel that owns it ([#585](https://github.com/dicode-ayo/modelica-wrapper/issues/585)) ([6e4f625](https://github.com/dicode-ayo/modelica-wrapper/commit/6e4f625a8e8a2d94d5e48b2fe60abaa43370d05e))
* **diagram:** stop an editor reverse-syncing against its own announcement ([#583](https://github.com/dicode-ayo/modelica-wrapper/issues/583)) ([02aa151](https://github.com/dicode-ayo/modelica-wrapper/commit/02aa151f0d7b828dc362e545a64a80c869b4c9f9)), closes [#581](https://github.com/dicode-ayo/modelica-wrapper/issues/581)
* **diagram:** version layout pushes so a stale report cannot delete a fresh component ([aa7ae5c](https://github.com/dicode-ayo/modelica-wrapper/commit/aa7ae5cbeba31701a6da802d1526fe4ccb2e7940)), closes [#513](https://github.com/dicode-ayo/modelica-wrapper/issues/513)
* **repl:** stop no-argument meta-commands from offering OMC-name completions ([#592](https://github.com/dicode-ayo/modelica-wrapper/issues/592)) ([d1ab2a4](https://github.com/dicode-ayo/modelica-wrapper/commit/d1ab2a43485eec0c7b801f9490c0753c369ee1ba))
* **repl:** stop tab-completion from rewriting :load/:cd path arguments ([e6781dd](https://github.com/dicode-ayo/modelica-wrapper/commit/e6781dd0e1659b0034ec95781ed8e52adb8b6a71)), closes [#579](https://github.com/dicode-ayo/modelica-wrapper/issues/579)


### Performance Improvements

* **extension:** share one workspace scan between sessionReplaced listeners ([#569](https://github.com/dicode-ayo/modelica-wrapper/issues/569)) ([071ac6a](https://github.com/dicode-ayo/modelica-wrapper/commit/071ac6ab1156e2dedee9e67215867cc5bf570e29))


### Code Refactoring

* **language:** extract the shared definition/hover/completion request procedure ([#596](https://github.com/dicode-ayo/modelica-wrapper/issues/596)) ([e442332](https://github.com/dicode-ayo/modelica-wrapper/commit/e4423321f3113566345ab3d17fbc7417bd87a2a5))
* **repl:** derive meta-command dispatch from META_COMMANDS ([#588](https://github.com/dicode-ayo/modelica-wrapper/issues/588)) ([#594](https://github.com/dicode-ayo/modelica-wrapper/issues/594)) ([6c98ad8](https://github.com/dicode-ayo/modelica-wrapper/commit/6c98ad8ae7475715a775ab6bd994efbdae6bde6a))


### Tests

* **diagram:** sweep non-null assertions from parameter-edits and display-unit tests ([#575](https://github.com/dicode-ayo/modelica-wrapper/issues/575)) ([ec03bf0](https://github.com/dicode-ayo/modelica-wrapper/commit/ec03bf0d15a66cc57f1edffc1022090d3c67d20a))
* measure coverage with Istanbul across the workspace ([#518](https://github.com/dicode-ayo/modelica-wrapper/issues/518)) ([c96d600](https://github.com/dicode-ayo/modelica-wrapper/commit/c96d600376302606a5b44657e9cfebc675a5deb2))

## [0.0.3](https://github.com/dicode-ayo/modelica-wrapper/compare/modelica-wrapper-v0.0.2...modelica-wrapper-v0.0.3) (2026-08-29)


### Features

* **diagram-ui,extension,omc-client:** edit shape z-order in diagram and icon ([#387](https://github.com/dicode-ayo/modelica-wrapper/issues/387)) ([7a93f88](https://github.com/dicode-ayo/modelica-wrapper/commit/7a93f8897531f7294d8a347f080ca08963eeddfa))
* **diagram-ui,extension:** float the parameter panel over the canvas ([#389](https://github.com/dicode-ayo/modelica-wrapper/issues/389)) ([c4de9a8](https://github.com/dicode-ayo/modelica-wrapper/commit/c4de9a8262fadf4107310a963afe1dc7492dd3a5))
* **diagram-ui:** expand library tree rows by containment, not restriction ([#372](https://github.com/dicode-ayo/modelica-wrapper/issues/372)) ([8a1a69a](https://github.com/dicode-ayo/modelica-wrapper/commit/8a1a69a2ce1f133012c02e7cdb5e6a1c3b803360))
* **diagram:** copy/paste for diagram and icon selections ([#377](https://github.com/dicode-ayo/modelica-wrapper/issues/377)) ([fd573cb](https://github.com/dicode-ayo/modelica-wrapper/commit/fd573cbc3345f4b8e1441d3f58d0eac448230f7b))
* **diagram:** read-only view for system-library classes ([#350](https://github.com/dicode-ayo/modelica-wrapper/issues/350)) ([337cf96](https://github.com/dicode-ayo/modelica-wrapper/commit/337cf963c8de78f3647ffd5343479afb13f7837e))
* **diagram:** select shapes by rubber band, and add Select All ([#398](https://github.com/dicode-ayo/modelica-wrapper/issues/398)) ([1c451d4](https://github.com/dicode-ayo/modelica-wrapper/commit/1c451d46c702ee964fdf623d9eb65d7602f840c1))
* **extension:** react to package.order edits through the .mo watcher ([d8a4a74](https://github.com/dicode-ayo/modelica-wrapper/commit/d8a4a7430b5ea73ef935ad6f26b9cbc043e6e8f9))
* **library:** order a package's members by package.order ([#369](https://github.com/dicode-ayo/modelica-wrapper/issues/369)) ([f39801d](https://github.com/dicode-ayo/modelica-wrapper/commit/f39801dd7f371f678db43d3ff3fe7a140003f72b))
* **library:** react to bare .mo file edits through OMC ([#344](https://github.com/dicode-ayo/modelica-wrapper/issues/344)) ([54bd30b](https://github.com/dicode-ayo/modelica-wrapper/commit/54bd30bdb31f8442380d1cc4ae5b20551de007d0))
* **omc-client:** support OpenModelica 1.27.0 ([#360](https://github.com/dicode-ayo/modelica-wrapper/issues/360)) ([40b8615](https://github.com/dicode-ayo/modelica-wrapper/commit/40b861557e775ac29bb012327a96ec674681d56a))
* **results:** surface a simulation result in an unsaved view when none is open ([#341](https://github.com/dicode-ayo/modelica-wrapper/issues/341)) ([2b0b4b2](https://github.com/dicode-ayo/modelica-wrapper/commit/2b0b4b24fcc9652a310d2d91399a858181062308))


### Bug Fixes

* **commands:** attribute live-check diagnostics to the edited class, not a sibling in its file ([#412](https://github.com/dicode-ayo/modelica-wrapper/issues/412)) ([f9d20cb](https://github.com/dicode-ayo/modelica-wrapper/commit/f9d20cb4793fc99cc3158e72a5e64bbc8deaa73a)), closes [#370](https://github.com/dicode-ayo/modelica-wrapper/issues/370)
* **commands:** live-check the buffer under its real source file ([#367](https://github.com/dicode-ayo/modelica-wrapper/issues/367)) ([c825b0f](https://github.com/dicode-ayo/modelica-wrapper/commit/c825b0f203aae9d8dc3dbc083ce1b46de2918d90))
* **diagram-ui:** thread touched-field tracking through parameter form submit ([#500](https://github.com/dicode-ayo/modelica-wrapper/issues/500)) ([98da05b](https://github.com/dicode-ayo/modelica-wrapper/commit/98da05b9c679c5f0277b12147d3e13acb58d5f6e))
* **diagram,documentation:** refuse to reverse-sync a read-only class into OMC ([#373](https://github.com/dicode-ayo/modelica-wrapper/issues/373)) ([8d3b2a0](https://github.com/dicode-ayo/modelica-wrapper/commit/8d3b2a03966e31940fb5a48b7cc4e580c8ca5c2b))
* **diagram,omc-client:** keep declaration fidelity through copy and paste ([#397](https://github.com/dicode-ayo/modelica-wrapper/issues/397)) ([120bd92](https://github.com/dicode-ayo/modelica-wrapper/commit/120bd92138bf97250ea3ebb4379db8284a6ab318))
* **diagram:** carry array dimensions through copy/paste ([fc9549a](https://github.com/dicode-ayo/modelica-wrapper/commit/fc9549a97c511cfee027e0f6a3d6da85fdf3e8a6))
* **diagram:** compare shapes by meaning, not raw field presence ([#449](https://github.com/dicode-ayo/modelica-wrapper/issues/449)) ([e748c08](https://github.com/dicode-ayo/modelica-wrapper/commit/e748c085914a0e99357a5ab9d5faff0ded4a2c10))
* **diagram:** keep a restored system-library editor read-only ([#362](https://github.com/dicode-ayo/modelica-wrapper/issues/362)) ([d9bbd73](https://github.com/dicode-ayo/modelica-wrapper/commit/d9bbd7364c28293a9051c04be4cec2a020fcc288))
* **diagram:** keep an entity's origin on a move, and its wires on a delete ([#401](https://github.com/dicode-ayo/modelica-wrapper/issues/401)) ([2221487](https://github.com/dicode-ayo/modelica-wrapper/commit/22214873da3ac4828c306bcf35b28bb196906bde))
* **diagram:** keep the simulate form usable on a read-only class ([#361](https://github.com/dicode-ayo/modelica-wrapper/issues/361)) ([f19acbd](https://github.com/dicode-ayo/modelica-wrapper/commit/f19acbd951f2807f4152a17fcb3f599f3ad3ac1e))
* **diagram:** reconcile the class to the layout the webview reports ([6abc3f1](https://github.com/dicode-ayo/modelica-wrapper/commit/6abc3f15e4f826232d1e335e2513db40e8c5955b))
* **diagram:** resolve vertex and rotate handle keys host-side ([#435](https://github.com/dicode-ayo/modelica-wrapper/issues/435)) ([ddf52eb](https://github.com/dicode-ayo/modelica-wrapper/commit/ddf52eb3c523c5ff42a8af45e3926bec9435305e))
* **diagram:** stop a null textString Apply from overwriting it with "" ([#481](https://github.com/dicode-ayo/modelica-wrapper/issues/481)) ([a21901a](https://github.com/dicode-ayo/modelica-wrapper/commit/a21901a592c7ae1f35e1f12953f9ff2872939426))
* **documentation:** keep a restored system-library doc tab read-only ([#365](https://github.com/dicode-ayo/modelica-wrapper/issues/365)) ([b45f1aa](https://github.com/dicode-ayo/modelica-wrapper/commit/b45f1aa4e21e690282148c9c0c781503735853d1))
* **documentation:** reject read-only reflect in refreshFromExternalWrite ([#375](https://github.com/dicode-ayo/modelica-wrapper/issues/375)) ([a14b797](https://github.com/dicode-ayo/modelica-wrapper/commit/a14b797a74f1402737fee6cb35c9f0b2fb9f5b7d))
* **extension:** carry a stale-base signal so a reconcile can't read a missed push as a deletion ([#499](https://github.com/dicode-ayo/modelica-wrapper/issues/499)) ([403b748](https://github.com/dicode-ayo/modelica-wrapper/commit/403b748c550f78c0652cb9cc27ea3dbf3290ecf5))
* **extension:** cascade-clean nested files on handleMoChange removal ([#479](https://github.com/dicode-ayo/modelica-wrapper/issues/479)) ([5ab6591](https://github.com/dicode-ayo/modelica-wrapper/commit/5ab659115b3171d1d688f1df37e44292b16c38ae))
* **extension:** clear stale caches on OMC session reset ([#483](https://github.com/dicode-ayo/modelica-wrapper/issues/483)) ([1785822](https://github.com/dicode-ayo/modelica-wrapper/commit/1785822dd36095b7a517586a0ee4a27db9f06857))
* **extension:** close remaining system-library mutation gaps ([#355](https://github.com/dicode-ayo/modelica-wrapper/issues/355)) ([e9c0acb](https://github.com/dicode-ayo/modelica-wrapper/commit/e9c0acbc2d4326f616acec580d40aa9859302c26))
* **extension:** coalesce concurrent ensureClient callers onto one OMC ([#357](https://github.com/dicode-ayo/modelica-wrapper/issues/357)) ([e990907](https://github.com/dicode-ayo/modelica-wrapper/commit/e990907e0fd71175dfbfb053303dbd7f57f25011))
* **extension:** cover a deleteClass cascade's full blast radius in mo-file-watcher ([#420](https://github.com/dicode-ayo/modelica-wrapper/issues/420)) ([7a118d4](https://github.com/dicode-ayo/modelica-wrapper/commit/7a118d44969ee06bb96c4f74e567a5cae8fb9002))
* **extension:** guard the OMC client cache against close/reset mid-spawn ([#359](https://github.com/dicode-ayo/modelica-wrapper/issues/359)) ([facae0f](https://github.com/dicode-ayo/modelica-wrapper/commit/facae0f0e093cad34cb43efe6def57d9ef101293))
* **extension:** one write verdict for read-only classes ([#441](https://github.com/dicode-ayo/modelica-wrapper/issues/441)) ([485810c](https://github.com/dicode-ayo/modelica-wrapper/commit/485810cd2ff04313f7b84ac42fdffd2a65249ce3))
* **extension:** re-list scopes and update the path→class index on a self-write ([#450](https://github.com/dicode-ayo/modelica-wrapper/issues/450)) ([bedaab9](https://github.com/dicode-ayo/modelica-wrapper/commit/bedaab926b19c57a6d9868785086c52f935e6f94))
* **extension:** refuse .mo files declaring several top-level classes ([#458](https://github.com/dicode-ayo/modelica-wrapper/issues/458)) ([688e7ce](https://github.com/dicode-ayo/modelica-wrapper/commit/688e7ce3dcad00ed890ebaf990dc6c7a50fe7d24))
* **extension:** refuse a buffer save that renames its class ([#460](https://github.com/dicode-ayo/modelica-wrapper/issues/460)) ([4d2a476](https://github.com/dicode-ayo/modelica-wrapper/commit/4d2a476b3f109a95f2814b4b23dce41176d33c3e))
* **extension:** refuse a reverse sync that renamed its class ([#480](https://github.com/dicode-ayo/modelica-wrapper/issues/480)) ([3f4d61c](https://github.com/dicode-ayo/modelica-wrapper/commit/3f4d61ca76a6799cd3630215cfa4d65b51493036))
* **extension:** refuse to save read-only system-library classes ([#349](https://github.com/dicode-ayo/modelica-wrapper/issues/349)) ([29c931d](https://github.com/dicode-ayo/modelica-wrapper/commit/29c931d3531502a95d511636f78178ac8b9fd53b))
* **extension:** reject a read() whose backfill write didn't persist ([#491](https://github.com/dicode-ayo/modelica-wrapper/issues/491)) ([f4ade69](https://github.com/dicode-ayo/modelica-wrapper/commit/f4ade6933cd044434c2eccbbbcfa4e72602b59a3))
* **extension:** retry a package.order reorder once its blocking buffer saves ([#492](https://github.com/dicode-ayo/modelica-wrapper/issues/492)) ([4cd5206](https://github.com/dicode-ayo/modelica-wrapper/commit/4cd5206ae63a90cbccd5ccb2baf1553019d91fab))
* **extension:** route class invalidation through one registry ([#442](https://github.com/dicode-ayo/modelica-wrapper/issues/442)) ([6c81202](https://github.com/dicode-ayo/modelica-wrapper/commit/6c812028392031f5914d84467831b03dfa719c6e))
* **extension:** route every add-result write through ResultViewDocument's queue ([#494](https://github.com/dicode-ayo/modelica-wrapper/issues/494)) ([35d1eea](https://github.com/dicode-ayo/modelica-wrapper/commit/35d1eea113546f39411d0d14a561435d6287b1bc))
* **extension:** save the whole file for a class stored inline ([#352](https://github.com/dicode-ayo/modelica-wrapper/issues/352)) ([d9ae864](https://github.com/dicode-ayo/modelica-wrapper/commit/d9ae864e229d215b328208e496360a35c3e12263))
* **extension:** screen live-check buffers for a class rename before loadString ([#487](https://github.com/dicode-ayo/modelica-wrapper/issues/487)) ([6da396a](https://github.com/dicode-ayo/modelica-wrapper/commit/6da396a228b27c92a363eb38704a4475cf95aa9a))
* **extension:** serialize ParseCache parses and guard borrowed trees ([#498](https://github.com/dicode-ayo/modelica-wrapper/issues/498)) ([983730b](https://github.com/dicode-ayo/modelica-wrapper/commit/983730bfd15191e80c0f07adf541b3f8829a176d))
* **extension:** tell the user when a re-simulate is already in the view ([#497](https://github.com/dicode-ayo/modelica-wrapper/issues/497)) ([84571ee](https://github.com/dicode-ayo/modelica-wrapper/commit/84571ee1528aae4de9b0002d9689e9e7d2012a24))
* **extension:** typecheck extension test files ([#475](https://github.com/dicode-ayo/modelica-wrapper/issues/475)) ([11bacc4](https://github.com/dicode-ayo/modelica-wrapper/commit/11bacc444e5f22c0391852a23684bbc3be9a583a))
* **extension:** watch a result view's backing .mat files for the missing chip ([#501](https://github.com/dicode-ayo/modelica-wrapper/issues/501)) ([1f70238](https://github.com/dicode-ayo/modelica-wrapper/commit/1f70238277b767bbd82cd93814d97a14db2984b0))
* **extension:** wire remove/rename in results channel, add missingResults producer ([#485](https://github.com/dicode-ayo/modelica-wrapper/issues/485)) ([5aa9d89](https://github.com/dicode-ayo/modelica-wrapper/commit/5aa9d896df999c32a4c15b92f3b4e2a1362d11ba))
* **library:** close the mid-render base-edit gap in icon invalidation ([#340](https://github.com/dicode-ayo/modelica-wrapper/issues/340)) ([fd0fa3c](https://github.com/dicode-ayo/modelica-wrapper/commit/fd0fa3c7888d10dde810e5bc33c64642a3d312a2))
* **omc-client:** reap OMC sessions stranded by a dead host ([#419](https://github.com/dicode-ayo/modelica-wrapper/issues/419)) ([a404696](https://github.com/dicode-ayo/modelica-wrapper/commit/a404696f675f55027d288eb56107d97f776ce36e))
* **omc-client:** resolve inherited units the same way in both producers ([#436](https://github.com/dicode-ayo/modelica-wrapper/issues/436)) ([cd27edc](https://github.com/dicode-ayo/modelica-wrapper/commit/cd27edcbc366e9ac5d75e4c54bf5aa148b982f5c))


### Performance Improvements

* **diagram,omc-client:** paste every clipboard item in one OMC call ([#391](https://github.com/dicode-ayo/modelica-wrapper/issues/391)) ([11edf28](https://github.com/dicode-ayo/modelica-wrapper/commit/11edf288f92caa2769b99868ffd210c865a80d95))


### Code Refactoring

* **commands:** extract and test systemLibrarySaveGuard ([#356](https://github.com/dicode-ayo/modelica-wrapper/issues/356)) ([87010f7](https://github.com/dicode-ayo/modelica-wrapper/commit/87010f7d6470644adf27b7f7fe57e1f8a9b86c25))
* **diagram:** declare each shape property once ([#448](https://github.com/dicode-ayo/modelica-wrapper/issues/448)) ([505e979](https://github.com/dicode-ayo/modelica-wrapper/commit/505e979ecad1cb11a9a292648b3606abbb3edb0f))
* **extension:** consolidate webview HTML into one CSP-locked renderer ([#438](https://github.com/dicode-ayo/modelica-wrapper/issues/438)) ([9979fe8](https://github.com/dicode-ayo/modelica-wrapper/commit/9979fe8c231186120c336318f45a505b61c861f7))
* **omc-client,extension:** extract shared shouldRun/describeIf integration gate ([#376](https://github.com/dicode-ayo/modelica-wrapper/issues/376)) ([e62c054](https://github.com/dicode-ayo/modelica-wrapper/commit/e62c0541e56f9d653c7fcbdcb420890e0c1b4328)), closes [#371](https://github.com/dicode-ayo/modelica-wrapper/issues/371)
* **webview:** declare each diagram gesture once ([#443](https://github.com/dicode-ayo/modelica-wrapper/issues/443)) ([e73e3c1](https://github.com/dicode-ayo/modelica-wrapper/commit/e73e3c1703e3bab6c17ee299a56678eb50241d08))

## [0.0.2](https://github.com/dicode-ayo/modelica-wrapper/compare/modelica-wrapper-v0.0.1...modelica-wrapper-v0.0.2) (2026-07-20)


### Features

* adding and moving ([6aece74](https://github.com/dicode-ayo/modelica-wrapper/commit/6aece7431041aa90cb289b3b150f22be20b3212b))
* build and fps ([f9d07e2](https://github.com/dicode-ayo/modelica-wrapper/commit/f9d07e2666aeb7313e77da29f740785320b79041))
* bulk-clear component modifiers via removeElementModifiers ([#30](https://github.com/dicode-ayo/modelica-wrapper/issues/30)) ([#62](https://github.com/dicode-ayo/modelica-wrapper/issues/62)) ([d11e890](https://github.com/dicode-ayo/modelica-wrapper/commit/d11e890ccf50294dd0e063d73c2b4cbdaab90c41))
* check load save through repl ([c683ef4](https://github.com/dicode-ayo/modelica-wrapper/commit/c683ef40bd79359c919fa7abbe375f98f1eb98eb))
* conditional ports/components + resolved-parameter label overlay ([6038ee1](https://github.com/dicode-ayo/modelica-wrapper/commit/6038ee1f659dc3c841bd5808c664b60c5741d323))
* connection ([0edc471](https://github.com/dicode-ayo/modelica-wrapper/commit/0edc47112cec5e3ba58f8abb6bad5ed386140f92))
* debounced semantic check for modelica-source edits with structured diagnostics ([06edec0](https://github.com/dicode-ayo/modelica-wrapper/commit/06edec0e83cb0bdb2de8826fe314debb8e045508))
* debounced semantic check for modelica-source edits with structured diagnostics ([7fe7d24](https://github.com/dicode-ayo/modelica-wrapper/commit/7fe7d240c34f67ad234ab9de862a2787a0552cb1))
* diagram-local snapshot undo ([#29](https://github.com/dicode-ayo/modelica-wrapper/issues/29) deferred half) ([58e21c9](https://github.com/dicode-ayo/modelica-wrapper/commit/58e21c996b19482e5798b13e4b63494409a4471d))
* diagram-local snapshot undo ([#29](https://github.com/dicode-ayo/modelica-wrapper/issues/29) deferred half) ([976adda](https://github.com/dicode-ayo/modelica-wrapper/commit/976adda3b7a8389b540679ef0a3a5b7b0be34370))
* **diagram-ui,extension:** restore per-node library sidebar context actions ([#280](https://github.com/dicode-ayo/modelica-wrapper/issues/280)) ([476fba2](https://github.com/dicode-ayo/modelica-wrapper/commit/476fba2a9ac299e55a8563f3c603b7ba4e856737))
* **diagram-ui:** Babylon.js + Lit graphical layout editor ([0fa25f9](https://github.com/dicode-ayo/modelica-wrapper/commit/0fa25f9589fa82e5b5523701f5d86c5aca5e9c52))
* **diagram-ui:** component class swap via "Change class…" context-menu command ([#145](https://github.com/dicode-ayo/modelica-wrapper/issues/145)) ([#226](https://github.com/dicode-ayo/modelica-wrapper/issues/226)) ([d1848b9](https://github.com/dicode-ayo/modelica-wrapper/commit/d1848b973626bf5d9152207bcdc62b42ee76cc25))
* **diagram-ui:** dock collapsible library palette beside the canvas ([#244](https://github.com/dicode-ayo/modelica-wrapper/issues/244)) ([#255](https://github.com/dicode-ayo/modelica-wrapper/issues/255)) ([4b6c8f8](https://github.com/dicode-ayo/modelica-wrapper/commit/4b6c8f80d6bb026ea8375c2915d11770704ace17))
* **diagram-ui:** draw tools — rectangle + ellipse ([#187](https://github.com/dicode-ayo/modelica-wrapper/issues/187)) ([#207](https://github.com/dicode-ayo/modelica-wrapper/issues/207)) ([75326a3](https://github.com/dicode-ayo/modelica-wrapper/commit/75326a3a456df9a259f422508632e0e4b73f7ed4))
* **diagram-ui:** keymap-help view generated from the command registry ([#330](https://github.com/dicode-ayo/modelica-wrapper/issues/330)) ([a64f84f](https://github.com/dicode-ayo/modelica-wrapper/commit/a64f84f42713c212b14de952e58201ba750e174a))
* **diagram-ui:** render the dragged class as its real node during placement ([#259](https://github.com/dicode-ayo/modelica-wrapper/issues/259)) ([2288812](https://github.com/dicode-ayo/modelica-wrapper/commit/228881214271e007606df9d587959578374003f3))
* **diagram:** drag-to-rotate + corner resize-with-flip ([#160](https://github.com/dicode-ayo/modelica-wrapper/issues/160)) ([d1d9ada](https://github.com/dicode-ayo/modelica-wrapper/commit/d1d9ada1b12ef8ea4e8c609aefb8dd7183cce79d))
* **diagram:** drive diagram shortcuts from VSCode keybindings ([#184](https://github.com/dicode-ayo/modelica-wrapper/issues/184)) ([#210](https://github.com/dicode-ayo/modelica-wrapper/issues/210)) ([6d399ad](https://github.com/dicode-ayo/modelica-wrapper/commit/6d399ad9f51e2de47558830aaaf28054cc4c4465))
* **diagram:** filter change-class candidates by connection compatibility ([#276](https://github.com/dicode-ayo/modelica-wrapper/issues/276)) ([6e5ab16](https://github.com/dicode-ayo/modelica-wrapper/commit/6e5ab16961146c3ded187f2c946eb52332925f5e)), closes [#239](https://github.com/dicode-ayo/modelica-wrapper/issues/239) [#278](https://github.com/dicode-ayo/modelica-wrapper/issues/278)
* **diagram:** interactive rotate handle + flip/mirror affordance ([#154](https://github.com/dicode-ayo/modelica-wrapper/issues/154)) ([cad1c82](https://github.com/dicode-ayo/modelica-wrapper/commit/cad1c8227cf1415301e64946a5dad6eac9575709))
* **diagram:** LCS-based minimal graphics deletes + consolidated deepEqual ([#201](https://github.com/dicode-ayo/modelica-wrapper/issues/201)) ([ebd9426](https://github.com/dicode-ayo/modelica-wrapper/commit/ebd942604f91b11464a0ea673b60107fb823f793))
* **diagram:** Modelica icon editor + title-bar view switcher ([#289](https://github.com/dicode-ayo/modelica-wrapper/issues/289)) ([0609fde](https://github.com/dicode-ayo/modelica-wrapper/commit/0609fdeee648e7edef8a82f32e8a5c7f3e715bbf))
* **diagram:** persist graphics edits via the layout-edit pipeline ([#186](https://github.com/dicode-ayo/modelica-wrapper/issues/186)) ([#198](https://github.com/dicode-ayo/modelica-wrapper/issues/198)) ([c48c786](https://github.com/dicode-ayo/modelica-wrapper/commit/c48c786f34d2a7f156ce11a2e4525a163f7a0a23))
* **diagram:** replace the diagram WebviewPanel with a custom editor (save/undo/redo) ([#284](https://github.com/dicode-ayo/modelica-wrapper/issues/284)) ([ca32a01](https://github.com/dicode-ayo/modelica-wrapper/commit/ca32a01fec5f33fa2742fb8ff66b036b3ab886de))
* **diagram:** show a meaningful error state when the editor can't render ([#320](https://github.com/dicode-ayo/modelica-wrapper/issues/320)) ([fb402f8](https://github.com/dicode-ayo/modelica-wrapper/commit/fb402f8fc1a2509d18ecfb5e7952487b21ca37b9))
* **documentation:** add auto-generated parameter, connector, and extends sections ([#312](https://github.com/dicode-ayo/modelica-wrapper/issues/312)) ([#315](https://github.com/dicode-ayo/modelica-wrapper/issues/315)) ([11965fa](https://github.com/dicode-ayo/modelica-wrapper/commit/11965fa7a1d25b8bdf7d16606f86710430812a25))
* **documentation:** read-only Documentation custom editor ([#290](https://github.com/dicode-ayo/modelica-wrapper/issues/290)) ([#303](https://github.com/dicode-ayo/modelica-wrapper/issues/303)) ([24c1594](https://github.com/dicode-ayo/modelica-wrapper/commit/24c15942d80b360645844ea5bd5c5d4d5df4fda5))
* **documentation:** render symbolic parameter defaults like OMEdit ([#322](https://github.com/dicode-ayo/modelica-wrapper/issues/322)) ([630d46f](https://github.com/dicode-ayo/modelica-wrapper/commit/630d46fa4c8be42282b41eaaad88bd2dedb2f922))
* **documentation:** resolve modelica:// images and links ([#290](https://github.com/dicode-ayo/modelica-wrapper/issues/290)) ([#307](https://github.com/dicode-ayo/modelica-wrapper/issues/307)) ([cb62b2b](https://github.com/dicode-ayo/modelica-wrapper/commit/cb62b2b674dfefa4db71dd6bd16b0e40f54bd736))
* **documentation:** WYSIWYG editor, pretty-printed HTML, native HTML source editor ([#290](https://github.com/dicode-ayo/modelica-wrapper/issues/290)) ([#305](https://github.com/dicode-ayo/modelica-wrapper/issues/305)) ([e330f3b](https://github.com/dicode-ayo/modelica-wrapper/commit/e330f3bb312b0a5dd97f4ed672d975b9db707c23))
* expression eval ([a571eea](https://github.com/dicode-ayo/modelica-wrapper/commit/a571eeabd3704891ec92b7cb6f90faffb630ccbb))
* extension tree ([6ea9320](https://github.com/dicode-ayo/modelica-wrapper/commit/6ea9320f7d069e5255ec1dbf5d43ecba463257d1))
* **extension:** convert modelica-source scheme to FileSystemProvider for write support ([29dcd64](https://github.com/dicode-ayo/modelica-wrapper/commit/29dcd645b0c526ef194b78fa4035d7e68625a37a))
* **extension:** convert modelica-source scheme to FileSystemProvider for write support ([0b2accb](https://github.com/dicode-ayo/modelica-wrapper/commit/0b2accb87a4c867cb623d46f097344cdef8e8704))
* **extension:** highlight embedded HTML in Documentation info strings ([#317](https://github.com/dicode-ayo/modelica-wrapper/issues/317)) ([9c32bd2](https://github.com/dicode-ayo/modelica-wrapper/commit/9c32bd24bda988686fa5a3a0b79247aef43ab31c))
* **extension:** language foundation — modelica language id + tree-sitter parse layer ([#95](https://github.com/dicode-ayo/modelica-wrapper/issues/95)) ([#105](https://github.com/dicode-ayo/modelica-wrapper/issues/105)) ([66aa837](https://github.com/dicode-ayo/modelica-wrapper/commit/66aa837e2a7d77caad3b87e87074ec30ff089549))
* **extension:** Modelica: Check Model button surfaces compile diagnostics ([f97f643](https://github.com/dicode-ayo/modelica-wrapper/commit/f97f6439ce9c0f8fcf6a65bfe3979b444025b3b0))
* **extension:** Modelica: Check Model button surfaces compile diagnostics ([5d005c4](https://github.com/dicode-ayo/modelica-wrapper/commit/5d005c4640f6ebc095bb9464be2eb9060ae9c2e9))
* **extension:** Modelica: Open Diagram webview command ([a4c9b12](https://github.com/dicode-ayo/modelica-wrapper/commit/a4c9b12bcf52bce40104d5ace668c39ff75ca79b))
* **extension:** resolve and relay the drag-to-place preview definition ([#259](https://github.com/dicode-ayo/modelica-wrapper/issues/259)) ([5923725](https://github.com/dicode-ayo/modelica-wrapper/commit/5923725b0fdcee92de4aa3e8b16c1b773290d76e))
* **extension:** semantic highlighting for annotation bodies ([4b3642b](https://github.com/dicode-ayo/modelica-wrapper/commit/4b3642b8b36fe8957f1c313c8159bdf7a180aa7f))
* **extension:** shape properties panel for annotation editing (C6, [#211](https://github.com/dicode-ayo/modelica-wrapper/issues/211)) ([#224](https://github.com/dicode-ayo/modelica-wrapper/issues/224)) ([07e42f1](https://github.com/dicode-ayo/modelica-wrapper/commit/07e42f1dd7ce09c01e866ed1bd5d8d776f15e68f))
* **extension:** wire diagram mutations through omc-client ([0385d04](https://github.com/dicode-ayo/modelica-wrapper/commit/0385d04422d41c7f37efc592cb54aceefbb0abd9))
* gate conditional components/ports + plumb resolved params into the layout ([19e2481](https://github.com/dicode-ayo/modelica-wrapper/commit/19e248100b2a9eff1e5c5df874b0a042e82d6a5b))
* **language:** annotation completion by nested record path ([#134](https://github.com/dicode-ayo/modelica-wrapper/issues/134)) ([d73f6e4](https://github.com/dicode-ayo/modelica-wrapper/commit/d73f6e40468b93e8ee996c57a66369a998065ad1))
* **language:** context-aware autocomplete provider ([#99](https://github.com/dicode-ayo/modelica-wrapper/issues/99)) ([#111](https://github.com/dicode-ayo/modelica-wrapper/issues/111)) ([9b8d086](https://github.com/dicode-ayo/modelica-wrapper/commit/9b8d086af2b348c02b06c478671a0b39bddba01f))
* **language:** document-symbols / outline provider ([#98](https://github.com/dicode-ayo/modelica-wrapper/issues/98)) ([#110](https://github.com/dicode-ayo/modelica-wrapper/issues/110)) ([143615e](https://github.com/dicode-ayo/modelica-wrapper/commit/143615e59d16e256e390f6ed0663b968df96ca75))
* **language:** enclosing-scope class names in type-position completion ([#124](https://github.com/dicode-ayo/modelica-wrapper/issues/124)) ([42d9aaf](https://github.com/dicode-ayo/modelica-wrapper/commit/42d9aafcab1310b329a94943229785552f0c2a13))
* **language:** go-to-definition + hover providers ([#97](https://github.com/dicode-ayo/modelica-wrapper/issues/97)) ([#109](https://github.com/dicode-ayo/modelica-wrapper/issues/109)) ([c2361bb](https://github.com/dicode-ayo/modelica-wrapper/commit/c2361bbb2d63c29236fc078faa2c53a17b12c814))
* **language:** gradual completion narrowing via isIncomplete ([#123](https://github.com/dicode-ayo/modelica-wrapper/issues/123)) ([9fd7861](https://github.com/dicode-ayo/modelica-wrapper/commit/9fd7861b2566ffdab05f8dd45d16116e9055e20b))
* **language:** keyword / built-in-type / snippet completion channels ([#121](https://github.com/dicode-ayo/modelica-wrapper/issues/121)) ([e0da329](https://github.com/dicode-ayo/modelica-wrapper/commit/e0da329b84bbfd127689645507a7d070580c213f))
* **language:** nested sub-component parameter completion in modifiers ([#131](https://github.com/dicode-ayo/modelica-wrapper/issues/131)) ([1a1a67b](https://github.com/dicode-ayo/modelica-wrapper/commit/1a1a67be4492f077b849f17ce2e5c0573a7328e4))
* **language:** OMC resolution layer — resolve, owning-class, sync ([#96](https://github.com/dicode-ayo/modelica-wrapper/issues/96)) ([#108](https://github.com/dicode-ayo/modelica-wrapper/issues/108)) ([c7d2560](https://github.com/dicode-ayo/modelica-wrapper/commit/c7d256004ab48212e2de328dca35e6f569a935c6))
* **language:** package-qualified type completion + FQN insert for global matches ([#125](https://github.com/dicode-ayo/modelica-wrapper/issues/125)) ([1461c60](https://github.com/dicode-ayo/modelica-wrapper/commit/1461c603d20db2290e3c5a639c7fbd5936117cdf))
* **language:** parameter completion in modifier parens (incl. empty parens) ([#130](https://github.com/dicode-ayo/modelica-wrapper/issues/130)) ([846b81a](https://github.com/dicode-ayo/modelica-wrapper/commit/846b81aafaf6ead397805be158c0db58bc084bcd))
* **language:** resolve inherited members in completion + go-to-def/hover ([#120](https://github.com/dicode-ayo/modelica-wrapper/issues/120)) ([49ad56e](https://github.com/dicode-ayo/modelica-wrapper/commit/49ad56e9e61e5319d5b2fcfcd567d90f511ef876))
* **language:** textual completion fallback for unparseable buffers ([#122](https://github.com/dicode-ayo/modelica-wrapper/issues/122)) ([02f6a3b](https://github.com/dicode-ayo/modelica-wrapper/commit/02f6a3b14842fb08655fa3a81fe1aa5a1bd49f6c))
* leftowe webawsome migration ([c92c1b8](https://github.com/dicode-ayo/modelica-wrapper/commit/c92c1b8a528c2f75daaba895befd236d59f5ee34))
* library sidebar as a webview view with host-mediated drag-to-place ([#257](https://github.com/dicode-ayo/modelica-wrapper/issues/257)) ([522e0d8](https://github.com/dicode-ayo/modelica-wrapper/commit/522e0d821ee3863d47544db548ac862518d9ea59))
* **library:** refresh a subtype's icon when its base class changes ([#337](https://github.com/dicode-ayo/modelica-wrapper/issues/337)) ([dc05d15](https://github.com/dicode-ayo/modelica-wrapper/commit/dc05d1581b71424fe23ced10ea94fee9bb324cae))
* **library:** update the tree in place instead of reloading wholesale ([#326](https://github.com/dicode-ayo/modelica-wrapper/issues/326)) ([7ec2a8a](https://github.com/dicode-ayo/modelica-wrapper/commit/7ec2a8a9303d245857e85d853a7f233f0750c825))
* Modelica REPL terminal + programmatic exec command ([4993adb](https://github.com/dicode-ayo/modelica-wrapper/commit/4993adb3f7d8afc8d7d675f4f448e3cbfe6b7772))
* omc api ([4fe996f](https://github.com/dicode-ayo/modelica-wrapper/commit/4fe996f6a061f4f368f671ddbe753b65ffed6a36))
* **omc-client,extension:** preserve __OpenModelica_infoHeader on documentation write ([#308](https://github.com/dicode-ayo/modelica-wrapper/issues/308)) ([b62fee6](https://github.com/dicode-ayo/modelica-wrapper/commit/b62fee671981c5118e6afb8a2f92be407eef2247))
* **omc-client:** graphics write path — Icon/Diagram shape add/modify/delete ([#186](https://github.com/dicode-ayo/modelica-wrapper/issues/186)) ([#197](https://github.com/dicode-ayo/modelica-wrapper/issues/197)) ([7464600](https://github.com/dicode-ayo/modelica-wrapper/commit/7464600cf08ef83dade8fc4dd0fa7ef41240210c))
* OMC-level undo escape hatch (listFile snapshot + loadString restore) ([#29](https://github.com/dicode-ayo/modelica-wrapper/issues/29)) ([#61](https://github.com/dicode-ayo/modelica-wrapper/issues/61)) ([b145e6b](https://github.com/dicode-ayo/modelica-wrapper/commit/b145e6b1ea1c72cd30c24359626db34820b82c8f))
* parameter drover ([e000e80](https://github.com/dicode-ayo/modelica-wrapper/commit/e000e8048307e17900093ab172ecb82f266df500))
* parameter panel ([ab74757](https://github.com/dicode-ayo/modelica-wrapper/commit/ab74757d1fd3862521b821e25ce158e335560c17))
* **persist:** leaf packages write to &lt;Name&gt;/package.mo + workspace-root init ([#180](https://github.com/dicode-ayo/modelica-wrapper/issues/180)) ([fcbcbf3](https://github.com/dicode-ayo/modelica-wrapper/commit/fcbcbf34fbc726a0f3eb924d9d252f65d3977ec6))
* **persist:** write package.order alongside new package.mo files ([#174](https://github.com/dicode-ayo/modelica-wrapper/issues/174)) ([ac610e9](https://github.com/dicode-ayo/modelica-wrapper/commit/ac610e983d20bcc770ceb902d9feb29ac00ab294))
* **postprocessing:** add results from a file pick or the .modelica cache ([1a5e923](https://github.com/dicode-ayo/modelica-wrapper/commit/1a5e923f233847b0c30e5fe7a43b1203dcfbacb8))
* **postprocessing:** create result views and auto-add on simulate ([30c4a8d](https://github.com/dicode-ayo/modelica-wrapper/commit/30c4a8d0751539e080952bd29937c2d5ce8da6c7))
* **postprocessing:** live data path — read .mat trajectories + card edits ([#85](https://github.com/dicode-ayo/modelica-wrapper/issues/85)) ([0ea58f2](https://github.com/dicode-ayo/modelica-wrapper/commit/0ea58f281ae8a693b5b1c87087cdb24504aca935))
* **postprocessing:** live data path — read .mat trajectories + edit handlers ([b0d66f9](https://github.com/dicode-ayo/modelica-wrapper/commit/b0d66f96d9d2385a9ea75de827df192490336dc3))
* **postprocessing:** result-view contract + pure helpers + result-ui/ui-common packages ([#82](https://github.com/dicode-ayo/modelica-wrapper/issues/82)) ([f98f04e](https://github.com/dicode-ayo/modelica-wrapper/commit/f98f04ec9d7904fd4955c207c581fb99f00cd863))
* **postprocessing:** result-view custom editor + webview skeleton ([35497fc](https://github.com/dicode-ayo/modelica-wrapper/commit/35497fc362d3f623daf515b0ac971ffefd59c1eb))
* **postprocessing:** result-view custom editor + webview skeleton ([#83](https://github.com/dicode-ayo/modelica-wrapper/issues/83)) ([c3209d8](https://github.com/dicode-ayo/modelica-wrapper/commit/c3209d8f82c02552827ae824a9c95d47c1059407))
* **postprocessing:** result-view document contract + pure helpers ([039a9dd](https://github.com/dicode-ayo/modelica-wrapper/commit/039a9ddf617b5f0d8500124f8772e08fbb52e570))
* **postprocessing:** the three add-result paths + New Result View command ([03cc10f](https://github.com/dicode-ayo/modelica-wrapper/commit/03cc10fc4ed13af8517b0adfddbc6636528e4076))
* refactor help ([5baf361](https://github.com/dicode-ayo/modelica-wrapper/commit/5baf361214d4d42e04232ab6e5d3aa4f0a5a36b8))
* render parameter labels in displayUnit via convertUnits ([#28](https://github.com/dicode-ayo/modelica-wrapper/issues/28) deferred half) ([9d0cadf](https://github.com/dicode-ayo/modelica-wrapper/commit/9d0cadf7b2714b60c4acc16140323fd8f68562df))
* repl ([a8f352b](https://github.com/dicode-ayo/modelica-wrapper/commit/a8f352b96f66b5cd688cf7b126b71a2081556fba))
* reset-to-defaults button in the component parameter modal ([#30](https://github.com/dicode-ayo/modelica-wrapper/issues/30) deferred half) ([822e039](https://github.com/dicode-ayo/modelica-wrapper/commit/822e03974a21c386015c67edc7f8350b7f0aac30))
* reset-to-defaults button in the component parameter modal ([#30](https://github.com/dicode-ayo/modelica-wrapper/issues/30) deferred half) ([160c7b0](https://github.com/dicode-ayo/modelica-wrapper/commit/160c7b0157a4c2c80de916baa039fc39a9390272))
* **result-ui:** postprocessing polish — missing chip, rename UX, theme refresh, error banner ([#178](https://github.com/dicode-ayo/modelica-wrapper/issues/178)) ([e332247](https://github.com/dicode-ayo/modelica-wrapper/commit/e332247a81c155b7b23fe521b00d48549f7bd82e))
* run simulation ([9900767](https://github.com/dicode-ayo/modelica-wrapper/commit/990076756524b71546dafc06fe4b753b37b0bc9c))
* show units + unit dropdown in the parameter panel ([#72](https://github.com/dicode-ayo/modelica-wrapper/issues/72)) ([09e18d5](https://github.com/dicode-ayo/modelica-wrapper/commit/09e18d549fac75729d1ec95905e919b1d7d2a092))
* show units + unit dropdown in the parameter panel ([#72](https://github.com/dicode-ayo/modelica-wrapper/issues/72)) ([e176068](https://github.com/dicode-ayo/modelica-wrapper/commit/e17606834586780bb83b52af3c2242c49ac3dab3))
* show units on diagram value labels ([#71](https://github.com/dicode-ayo/modelica-wrapper/issues/71)) ([c265736](https://github.com/dicode-ayo/modelica-wrapper/commit/c265736579e278ea5923844a6302db8313ddcde9))
* show units on diagram value labels ([#71](https://github.com/dicode-ayo/modelica-wrapper/issues/71)) ([09cd3a2](https://github.com/dicode-ayo/modelica-wrapper/commit/09cd3a2d0f767055bffb8f4015cc4c01618d3502))
* tree view and text switch ([12a0cba](https://github.com/dicode-ayo/modelica-wrapper/commit/12a0cbae34ee2acd45ea24a6172915d0cbeaf68a))
* updateConnectionNames for in-place connection-endpoint rename ([#26](https://github.com/dicode-ayo/modelica-wrapper/issues/26)) ([#60](https://github.com/dicode-ayo/modelica-wrapper/issues/60)) ([090e3ed](https://github.com/dicode-ayo/modelica-wrapper/commit/090e3edfaf886a6123ea3ce28ee3cdc54f5a9f30))


### Bug Fixes

* address post-merge review follow-ups ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76), items 1–18) ([d4e1bff](https://github.com/dicode-ayo/modelica-wrapper/commit/d4e1bff92199360cca2447bffe22a3bfcbfc476a))
* avoid mis-pairing cascade vector-port re-indexes ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) item 7) ([d5e44f4](https://github.com/dicode-ayo/modelica-wrapper/commit/d5e44f472a7d08ed73717940c88dfa6c03b7565e))
* back-convert parameter values to base unit on submit ([#72](https://github.com/dicode-ayo/modelica-wrapper/issues/72)) ([3c2f7be](https://github.com/dicode-ayo/modelica-wrapper/commit/3c2f7beb4a894c05d57d77d979bdbabc75cb36b4))
* **diagram:** carry connection Line style through the write path ([#219](https://github.com/dicode-ayo/modelica-wrapper/issues/219) P1) ([#237](https://github.com/dicode-ayo/modelica-wrapper/issues/237)) ([8c1474c](https://github.com/dicode-ayo/modelica-wrapper/commit/8c1474cf6610c3f7e6b261c083f19f82c5692e44))
* **diagram:** flush a pending reverse sync before a racing forward edit ([#318](https://github.com/dicode-ayo/modelica-wrapper/issues/318)) ([d286183](https://github.com/dicode-ayo/modelica-wrapper/commit/d286183ed93fe290e419bbc0269485925626ae0c))
* **diagram:** refuse partial classes at drop time ([#283](https://github.com/dicode-ayo/modelica-wrapper/issues/283)) ([8bce8ec](https://github.com/dicode-ayo/modelica-wrapper/commit/8bce8ec5972c534289c149fefff0414774b3f97b)), closes [#277](https://github.com/dicode-ayo/modelica-wrapper/issues/277)
* **diagram:** wire standalone connector delete + move into diffLayouts ([#144](https://github.com/dicode-ayo/modelica-wrapper/issues/144)) ([#229](https://github.com/dicode-ayo/modelica-wrapper/issues/229)) ([a081e75](https://github.com/dicode-ayo/modelica-wrapper/commit/a081e753d58e060eb9bdbe9ca180a122dd7501df))
* **extension:** keep modelica-source resolvable across window reload ([#309](https://github.com/dicode-ayo/modelica-wrapper/issues/309)) ([df90503](https://github.com/dicode-ayo/modelica-wrapper/commit/df905033f27028319d07c2bf177757147d647583))
* **extension:** stop instantiating classes that simply have no icon ([21fe668](https://github.com/dicode-ayo/modelica-wrapper/commit/21fe6687587f7340c93875bbd53e658d83ceed86))
* **extension:** walk the extends chain when building the sub-component parameter form ([d6bfc39](https://github.com/dicode-ayo/modelica-wrapper/commit/d6bfc39633c1826de57f03dc3cd8b1efe0338ce9))
* harden component reset handler (closure state, dedupe, double-click guard) ([6623b5a](https://github.com/dicode-ayo/modelica-wrapper/commit/6623b5a27c6ef3119f30f82920451683364622ea))
* host-class display units, formatNumber rounding, convertUnits fallback ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) items 10, 11, 12) ([3d52d89](https://github.com/dicode-ayo/modelica-wrapper/commit/3d52d89607b52a7b9c9b190b36d301e42ec7c974))
* **lang-core:** keep quoted identifiers with a dot out of leaf-name splits ([#274](https://github.com/dicode-ayo/modelica-wrapper/issues/274)) ([03d58dd](https://github.com/dicode-ayo/modelica-wrapper/commit/03d58dd5edb4dbb04d7e890c0398a276247c27f7))
* **library:** keep the sidebar icon fresh after every edit path ([#333](https://github.com/dicode-ayo/modelica-wrapper/issues/333)) ([51f2888](https://github.com/dicode-ayo/modelica-wrapper/commit/51f2888f2a0113463cb3d2a518fe3bda341692ee))
* **live-check:** read structured messages directly; getErrorString drains the buffer ([e663144](https://github.com/dicode-ayo/modelica-wrapper/commit/e663144e66d7f6fdea73ad981a7a8194c8a25246))
* **omc-client:** add cd wrapper; route REPL :cd through it ([323c776](https://github.com/dicode-ayo/modelica-wrapper/commit/323c776442b2ed7b8dd212c44b50fc8966f15a6e))
* **omc-client:** survive a timed-out call; stop draining superseded library searches ([#260](https://github.com/dicode-ayo/modelica-wrapper/issues/260)) ([34ade9d](https://github.com/dicode-ayo/modelica-wrapper/commit/34ade9d85bf0bc7850295f9a31b163e0d5d68b8c))
* re-establish package-nested classes on snapshot restore ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) item 2) ([a3060c7](https://github.com/dicode-ayo/modelica-wrapper/commit/a3060c762958fe8ce57cb41b5d742b15c256c535))
* route inherited-parameter writes through setExtendsModifierValue ([#24](https://github.com/dicode-ayo/modelica-wrapper/issues/24)) ([#57](https://github.com/dicode-ayo/modelica-wrapper/issues/57)) ([172cc2d](https://github.com/dicode-ayo/modelica-wrapper/commit/172cc2dd749e680aab9802ca53b081e47c34be59))
* route multi-level inherited param writes to the direct extends base ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) item 3) ([ae7a669](https://github.com/dicode-ayo/modelica-wrapper/commit/ae7a6692cecacd4b45a930771384c01d05373fcb))
* scope "blank all params" to surfaced parameters only ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) item 1) ([9a776bc](https://github.com/dicode-ayo/modelica-wrapper/commit/9a776bcbc2252a6532dea5e4bec610ec1d5f941f))
* strip stray NUL byte from display-unit.ts unitPairKey ([bafaa4d](https://github.com/dicode-ayo/modelica-wrapper/commit/bafaa4d3dc0182ca103b40aade328afa72f3808a))
* strip stray NUL byte from unit-options.ts cache-key separator ([506f760](https://github.com/dicode-ayo/modelica-wrapper/commit/506f76002d78c0d66b5b5c1afffaeae69fa0ccc5))
* strip stray NUL byte from unitPairKey cache-key separator ([2ded493](https://github.com/dicode-ayo/modelica-wrapper/commit/2ded493aa1a6b8b95c65ab6651e6e413ab5a7af4))
* surface success:false on connection/component mutators ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) root cause, items 7, 13) ([b352944](https://github.com/dicode-ayo/modelica-wrapper/commit/b352944053115a42bc8b2e87f1f0028bce11ffbc))
* tests and saves ([5844728](https://github.com/dicode-ayo/modelica-wrapper/commit/5844728f93b2c255142aa882d1eb1a09315f8047))
* wire applyEdits({snapshot}) into the onChange batch flow ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) item 14) ([bd6969b](https://github.com/dicode-ayo/modelica-wrapper/commit/bd6969b198a38e9482a373ec9cdbb38fe9a2b461))
* wire fetchIconLayout as lazy library thumbnails + fix null-annotation fallback ([#76](https://github.com/dicode-ayo/modelica-wrapper/issues/76) items 8, 9) ([20ec3c9](https://github.com/dicode-ayo/modelica-wrapper/commit/20ec3c93c0f5528bc582bf1c9e4b01a0e614b4d4))


### Performance Improvements

* filtered getModelInstanceAnnotation for icon-only loads ([#25](https://github.com/dicode-ayo/modelica-wrapper/issues/25)) ([#56](https://github.com/dicode-ayo/modelica-wrapper/issues/56)) ([dec8e69](https://github.com/dicode-ayo/modelica-wrapper/commit/dec8e691d410f5fcaa943a66906fca87426a1174))
* **language:** cache OMC lookups + harden error tolerance and logging ([#100](https://github.com/dicode-ayo/modelica-wrapper/issues/100)) ([#118](https://github.com/dicode-ayo/modelica-wrapper/issues/118)) ([ea874e4](https://github.com/dicode-ayo/modelica-wrapper/commit/ea874e433a1b80ac6bff5075eaff169d3dee4d3d))


### Code Refactoring

* **diagram-ui:** make the sidebar the only library surface ([#245](https://github.com/dicode-ayo/modelica-wrapper/issues/245)) ([407525e](https://github.com/dicode-ayo/modelica-wrapper/commit/407525e9e0287fa20e9c0bdbc8db386a8dfc0483)), closes [#263](https://github.com/dicode-ayo/modelica-wrapper/issues/263)
* extension migration to produceParameterModel + session unit cache (PR 2/2) ([7250703](https://github.com/dicode-ayo/modelica-wrapper/commit/72507033f99b66585d415e475a7286f0c1e597ca))
* **extension,completion:** address PR [#314](https://github.com/dicode-ayo/modelica-wrapper/issues/314) round-1 review ([3ea6656](https://github.com/dicode-ayo/modelica-wrapper/commit/3ea6656b300e25fc00b5768b5b23c48a9a4d0f79))
* **extension:** address PR [#268](https://github.com/dicode-ayo/modelica-wrapper/issues/268) round-1 review ([2d5651a](https://github.com/dicode-ayo/modelica-wrapper/commit/2d5651ae4c20bf77b08be52d750f8fe02a29a4ab))
* **extension:** collapse connectionWaypoints to a single updateConnection ([b6a0538](https://github.com/dicode-ayo/modelica-wrapper/commit/b6a0538ac1bffe55b846a04e42aa917c1671e56d))
* **extension:** collapse connectionWaypoints to one updateConnection ([eee38e4](https://github.com/dicode-ayo/modelica-wrapper/commit/eee38e488ed340a4f88ef4265a89966e9141cca6))
* **extension:** extract shared shadow-buffer reverse-sync ([#334](https://github.com/dicode-ayo/modelica-wrapper/issues/334)) ([0f512d4](https://github.com/dicode-ayo/modelica-wrapper/commit/0f512d457d993eb53e3c64937a28cc8bc6ef0213))
* **extension:** make AnnotationTokenType an as-const object ([26d5df0](https://github.com/dicode-ayo/modelica-wrapper/commit/26d5df0c1351f8b5df866aaef0852d4f988274d9))
* **omc-client:** move expressionToString beside the expression evaluator ([#324](https://github.com/dicode-ayo/modelica-wrapper/issues/324)) ([765cb7f](https://github.com/dicode-ayo/modelica-wrapper/commit/765cb7fe6bc6f29644c2ec281b1614d6a0f27a91))
* **postprocessing:** address review feedback ([27caece](https://github.com/dicode-ayo/modelica-wrapper/commit/27caeced0200c4f656caf79479b068c2570e7d71))
* **postprocessing:** remove unused result read-planner ([01a283c](https://github.com/dicode-ayo/modelica-wrapper/commit/01a283c500d56f5942b574e9e31ef8f93a599440))
* **postprocessing:** review-cycle cleanups ([e1ff356](https://github.com/dicode-ayo/modelica-wrapper/commit/e1ff3564dbe4a5072ce88c40fa0048d2734b4143))
* **postprocessing:** review-pass polish on result-view cards UI (follow-up to [#84](https://github.com/dicode-ayo/modelica-wrapper/issues/84)) ([ea5a8ab](https://github.com/dicode-ayo/modelica-wrapper/commit/ea5a8ab72f3e27246e9359de4bc9f39d2bd25915))
* **postprocessing:** review-pass polish on the result-view cards UI ([b041ecd](https://github.com/dicode-ayo/modelica-wrapper/commit/b041ecd7e783dbc2067742bb3d5533b049d3d63c))
* **release:** publish libraries under the [@dicode](https://github.com/dicode) npm scope ([550c81c](https://github.com/dicode-ayo/modelica-wrapper/commit/550c81c7fde30179d419e968b821429b7b488b59))
* render ParameterModel directly in all parameter panels ([cdc7de0](https://github.com/dicode-ayo/modelica-wrapper/commit/cdc7de0fccc788d68c306080ddb5105e8547f6b8))
* **ui:** extract shared tokens + WA bridge into @modelica-wrapper/ui-common ([a5c7f65](https://github.com/dicode-ayo/modelica-wrapper/commit/a5c7f6574f6e190b7d6759cf58cd4007c44c07b5))


### Documentation

* note instance-modifier displayUnit falls back to source unit ([4f63f72](https://github.com/dicode-ayo/modelica-wrapper/commit/4f63f725396d48ee0853bf0b4eece0610b9856ac))
* standalone docs for packages ([ba40263](https://github.com/dicode-ayo/modelica-wrapper/commit/ba4026330bab5d476c6923cd66543d174f1daff4))


### Tests

* cover onResetComponentParameters handler branches ([76f6c0d](https://github.com/dicode-ayo/modelica-wrapper/commit/76f6c0d470db68fd78d3c3c3411056f50fbd945a))
* **extension:** add Playwright + code-server e2e harness ([#113](https://github.com/dicode-ayo/modelica-wrapper/issues/113)) ([d1be642](https://github.com/dicode-ayo/modelica-wrapper/commit/d1be642167c10ec1db2c7035af46b3c7347afd67))
