# Changelog

## [0.0.3](https://github.com/dicode-ayo/modelica-wrapper/compare/@dicode/ui-common-v0.0.2...@dicode/ui-common-v0.0.3) (2026-08-29)


### Features

* **diagram-ui,extension:** float the parameter panel over the canvas ([#389](https://github.com/dicode-ayo/modelica-wrapper/issues/389)) ([c4de9a8](https://github.com/dicode-ayo/modelica-wrapper/commit/c4de9a8262fadf4107310a963afe1dc7492dd3a5))
* **diagram-ui:** dock collapsible library palette beside the canvas ([#244](https://github.com/dicode-ayo/modelica-wrapper/issues/244)) ([#255](https://github.com/dicode-ayo/modelica-wrapper/issues/255)) ([4b6c8f8](https://github.com/dicode-ayo/modelica-wrapper/commit/4b6c8f80d6bb026ea8375c2915d11770704ace17))
* **diagram-ui:** drag-to-instantiate from library tree onto canvas ([#243](https://github.com/dicode-ayo/modelica-wrapper/issues/243)) ([#254](https://github.com/dicode-ayo/modelica-wrapper/issues/254)) ([b4c2c79](https://github.com/dicode-ayo/modelica-wrapper/commit/b4c2c79a8e0adc9706fe334e14c586587b78898a))
* **diagram-ui:** reusable &lt;om-library-tree&gt; on headless-tree + virtualizer ([#248](https://github.com/dicode-ayo/modelica-wrapper/issues/248)) ([b95e9c1](https://github.com/dicode-ayo/modelica-wrapper/commit/b95e9c195d30ea129604ff2d478300c2a26426e6))
* **diagram-ui:** right-click context menu over the command registry ([#185](https://github.com/dicode-ayo/modelica-wrapper/issues/185)) ([c7d672d](https://github.com/dicode-ayo/modelica-wrapper/commit/c7d672dd75c9021cabbad49748f12898e0f5bc28))
* **diagram:** show a meaningful error state when the editor can't render ([#320](https://github.com/dicode-ayo/modelica-wrapper/issues/320)) ([fb402f8](https://github.com/dicode-ayo/modelica-wrapper/commit/fb402f8fc1a2509d18ecfb5e7952487b21ca37b9))
* **postprocessing:** result-view contract + pure helpers + result-ui/ui-common packages ([#82](https://github.com/dicode-ayo/modelica-wrapper/issues/82)) ([f98f04e](https://github.com/dicode-ayo/modelica-wrapper/commit/f98f04ec9d7904fd4955c207c581fb99f00cd863))
* **release:** build [@modelica-wrapper](https://github.com/modelica-wrapper) libs with tsup and publish to npm ([0a4ae50](https://github.com/dicode-ayo/modelica-wrapper/commit/0a4ae506928f19fa1579cda0ca78f5e95a40d376))


### Code Refactoring

* **diagram-ui:** address PR [#202](https://github.com/dicode-ayo/modelica-wrapper/issues/202) review ([786cbf0](https://github.com/dicode-ayo/modelica-wrapper/commit/786cbf0dfa32f4bb1aaef23565e3a0261d6c2fc4))
* **diagram-ui:** make the sidebar the only library surface ([#245](https://github.com/dicode-ayo/modelica-wrapper/issues/245)) ([407525e](https://github.com/dicode-ayo/modelica-wrapper/commit/407525e9e0287fa20e9c0bdbc8db386a8dfc0483)), closes [#263](https://github.com/dicode-ayo/modelica-wrapper/issues/263)
* **postprocessing:** review-cycle cleanups ([e1ff356](https://github.com/dicode-ayo/modelica-wrapper/commit/e1ff3564dbe4a5072ce88c40fa0048d2734b4143))
* **postprocessing:** review-pass polish on result-view cards UI (follow-up to [#84](https://github.com/dicode-ayo/modelica-wrapper/issues/84)) ([ea5a8ab](https://github.com/dicode-ayo/modelica-wrapper/commit/ea5a8ab72f3e27246e9359de4bc9f39d2bd25915))
* **postprocessing:** review-pass polish on the result-view cards UI ([b041ecd](https://github.com/dicode-ayo/modelica-wrapper/commit/b041ecd7e783dbc2067742bb3d5533b049d3d63c))
* **release:** publish libraries under the [@dicode](https://github.com/dicode) npm scope ([550c81c](https://github.com/dicode-ayo/modelica-wrapper/commit/550c81c7fde30179d419e968b821429b7b488b59))
* **ui:** extract shared tokens + WA bridge into @modelica-wrapper/ui-common ([a5c7f65](https://github.com/dicode-ayo/modelica-wrapper/commit/a5c7f6574f6e190b7d6759cf58cd4007c44c07b5))

## [0.0.2](https://github.com/dicode-ayo/modelica-wrapper/compare/@dicode/ui-common-v0.0.1...@dicode/ui-common-v0.0.2) (2026-07-20)


### Features

* **diagram-ui:** dock collapsible library palette beside the canvas ([#244](https://github.com/dicode-ayo/modelica-wrapper/issues/244)) ([#255](https://github.com/dicode-ayo/modelica-wrapper/issues/255)) ([4b6c8f8](https://github.com/dicode-ayo/modelica-wrapper/commit/4b6c8f80d6bb026ea8375c2915d11770704ace17))
* **diagram-ui:** drag-to-instantiate from library tree onto canvas ([#243](https://github.com/dicode-ayo/modelica-wrapper/issues/243)) ([#254](https://github.com/dicode-ayo/modelica-wrapper/issues/254)) ([b4c2c79](https://github.com/dicode-ayo/modelica-wrapper/commit/b4c2c79a8e0adc9706fe334e14c586587b78898a))
* **diagram-ui:** reusable &lt;om-library-tree&gt; on headless-tree + virtualizer ([#248](https://github.com/dicode-ayo/modelica-wrapper/issues/248)) ([b95e9c1](https://github.com/dicode-ayo/modelica-wrapper/commit/b95e9c195d30ea129604ff2d478300c2a26426e6))
* **diagram-ui:** right-click context menu over the command registry ([#185](https://github.com/dicode-ayo/modelica-wrapper/issues/185)) ([c7d672d](https://github.com/dicode-ayo/modelica-wrapper/commit/c7d672dd75c9021cabbad49748f12898e0f5bc28))
* **diagram:** show a meaningful error state when the editor can't render ([#320](https://github.com/dicode-ayo/modelica-wrapper/issues/320)) ([fb402f8](https://github.com/dicode-ayo/modelica-wrapper/commit/fb402f8fc1a2509d18ecfb5e7952487b21ca37b9))
* **postprocessing:** result-view contract + pure helpers + result-ui/ui-common packages ([#82](https://github.com/dicode-ayo/modelica-wrapper/issues/82)) ([f98f04e](https://github.com/dicode-ayo/modelica-wrapper/commit/f98f04ec9d7904fd4955c207c581fb99f00cd863))
* **release:** build [@modelica-wrapper](https://github.com/modelica-wrapper) libs with tsup and publish to npm ([0a4ae50](https://github.com/dicode-ayo/modelica-wrapper/commit/0a4ae506928f19fa1579cda0ca78f5e95a40d376))


### Code Refactoring

* **diagram-ui:** address PR [#202](https://github.com/dicode-ayo/modelica-wrapper/issues/202) review ([786cbf0](https://github.com/dicode-ayo/modelica-wrapper/commit/786cbf0dfa32f4bb1aaef23565e3a0261d6c2fc4))
* **diagram-ui:** make the sidebar the only library surface ([#245](https://github.com/dicode-ayo/modelica-wrapper/issues/245)) ([407525e](https://github.com/dicode-ayo/modelica-wrapper/commit/407525e9e0287fa20e9c0bdbc8db386a8dfc0483)), closes [#263](https://github.com/dicode-ayo/modelica-wrapper/issues/263)
* **postprocessing:** review-cycle cleanups ([e1ff356](https://github.com/dicode-ayo/modelica-wrapper/commit/e1ff3564dbe4a5072ce88c40fa0048d2734b4143))
* **postprocessing:** review-pass polish on result-view cards UI (follow-up to [#84](https://github.com/dicode-ayo/modelica-wrapper/issues/84)) ([ea5a8ab](https://github.com/dicode-ayo/modelica-wrapper/commit/ea5a8ab72f3e27246e9359de4bc9f39d2bd25915))
* **postprocessing:** review-pass polish on the result-view cards UI ([b041ecd](https://github.com/dicode-ayo/modelica-wrapper/commit/b041ecd7e783dbc2067742bb3d5533b049d3d63c))
* **release:** publish libraries under the [@dicode](https://github.com/dicode) npm scope ([550c81c](https://github.com/dicode-ayo/modelica-wrapper/commit/550c81c7fde30179d419e968b821429b7b488b59))
* **ui:** extract shared tokens + WA bridge into @modelica-wrapper/ui-common ([a5c7f65](https://github.com/dicode-ayo/modelica-wrapper/commit/a5c7f6574f6e190b7d6759cf58cd4007c44c07b5))
