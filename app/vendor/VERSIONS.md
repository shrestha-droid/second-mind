# Vendored files

Downloaded with `curl -fsSL`, one file at a time, never executed (marked.esm.js is only imported by node/browser).
Fonts are not wired into CSS yet (Task 9).

| File | Version | URL | Bytes | sha256 | Licence |
|---|---|---|---|---|---|
| marked.esm.js | marked 18.3.0 | https://unpkg.com/marked@18.3.0/lib/marked.esm.js | 54651 | 4d2d824f3035e79b6887380d88c6c9ca0958215d1f4f6c053c562d60babc7172 | MIT |
| fonts/IBMPlexSans-Regular-Latin1.woff2 | @ibm/plex-sans 2.0.0 | https://unpkg.com/@ibm/plex-sans@2.0.0/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2 | 21300 | bdb53f2af84b15e0a742428f5e199dacc3e6fd60776f0aebd9f700e2c97c960f | OFL-1.1 |
| fonts/IBMPlexSans-Medium-Latin1.woff2 | @ibm/plex-sans 2.0.0 | https://unpkg.com/@ibm/plex-sans@2.0.0/fonts/split/woff2/IBMPlexSans-Medium-Latin1.woff2 | 22304 | 668a0d9eabbfac0925f431988f56222b8b989ad66a0a78e91bc5889f73fe274a | OFL-1.1 |
| fonts/IBMPlexSans-SemiBold-Latin1.woff2 | @ibm/plex-sans 2.0.0 | https://unpkg.com/@ibm/plex-sans@2.0.0/fonts/split/woff2/IBMPlexSans-SemiBold-Latin1.woff2 | 22736 | 8251b7fc61b580c2f52550fa69b3c49fb94fc333815ad301ca6b1f6d15420f85 | OFL-1.1 |
| fonts/IBMPlexMono-Regular-Latin1.woff2 | @ibm/plex-mono 2.5.0 | https://unpkg.com/@ibm/plex-mono@2.5.0/fonts/split/woff2/IBMPlexMono-Regular-Latin1.woff2 | 17544 | e8993d946649b9d01abb1ed06d574b19d8ea3e66b5c3948602db335c44c18e56 | OFL-1.1 |
| fonts/IBMPlexMono-Medium-Latin1.woff2 | @ibm/plex-mono 2.5.0 | https://unpkg.com/@ibm/plex-mono@2.5.0/fonts/split/woff2/IBMPlexMono-Medium-Latin1.woff2 | 17868 | 41201b658a328b9d00368215c2f1102770f80b15952ab82631e4006255e6365d | OFL-1.1 |
| fonts/SourceSerif4-Regular.ttf.woff2 | adobe-fonts/source-serif 4.005R | https://raw.githubusercontent.com/adobe-fonts/source-serif/4.005R/WOFF2/TTF/SourceSerif4-Regular.ttf.woff2 | 76260 | 6b053e98f0838afe81f3e784727be4583a7c13bb42f198dc5202ecffee0aaee0 | OFL-1.1 |
| fonts/SourceSerif4-Semibold.ttf.woff2 | adobe-fonts/source-serif 4.005R | https://raw.githubusercontent.com/adobe-fonts/source-serif/4.005R/WOFF2/TTF/SourceSerif4-Semibold.ttf.woff2 | 80732 | 457a13ac92e977d82e376038a2daac7fdb5433610910bf5787bdf6c1c3781865 | OFL-1.1 |

Font total: 258744 bytes (cap 600 KB). Plex files are the Latin1 split subset; Source Serif 4 files are the full static TTF-flavoured woff2 (roman only).

## three.js

WebGL graph only (`graph-gl.js`, loaded lazily). 0.187 ships no `.min.js`, so these are the unminified builds. In `addons/`, each `import ... from 'three';` was rewritten to a relative `../../three.module.js`, so no import map is needed; sizes and hashes below are after that rewrite.

| File | Version | URL | Bytes | sha256 | Licence |
|---|---|---|---|---|---|
| three/LICENSE | three 0.187.0 | https://unpkg.com/three@0.187.0/LICENSE | 1081 | 8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc | MIT |
| three/addons/postprocessing/EffectComposer.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/EffectComposer.js | 8501 | 4e079a5886152d7e529a59aef644e968ab4d32c6a33ce016b36bf29b2eac26f7 | MIT |
| three/addons/postprocessing/MaskPass.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/MaskPass.js | 4694 | 7cd08eee9d5d6f5578beaddbdcbe9c384f6873810af27f22ab7db3ceeb127aa3 | MIT |
| three/addons/postprocessing/OutputPass.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/OutputPass.js | 4184 | 02e4a261af34de71338185e9e87f0cbe5cba9115608d984363e1269dec1d2272 | MIT |
| three/addons/postprocessing/Pass.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/Pass.js | 4218 | 444b409c235ead986893c472e720da1b779a56985c7d10b279c7944b52bd61c5 | MIT |
| three/addons/postprocessing/RenderPass.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/RenderPass.js | 4280 | 817f6c3cdcd0fd41515d112359ea0532568eefb5aabd3b33903957ebca1b8a6a | MIT |
| three/addons/postprocessing/ShaderPass.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/ShaderPass.js | 3228 | e2500a5913b26bbf5148ceaae644c6edcff06a18b01494ee37bf856353d2ab9d | MIT |
| three/addons/postprocessing/UnrealBloomPass.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/postprocessing/UnrealBloomPass.js | 15397 | ba8f2fcadfa6588384c9473498f974d81d120f02f0e63a0e59c265202a006b5a | MIT |
| three/addons/shaders/CopyShader.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/shaders/CopyShader.js | 729 | a33057d5ac91c43304c186ac0e8816e62bb2ed471d3a00ff3018dfd5c0389718 | MIT |
| three/addons/shaders/LuminosityHighPassShader.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/shaders/LuminosityHighPassShader.js | 1291 | 5044f780b6e6cf863947f64c36fe1587132f7fbe395ada863cd1e5f0388dcf1e | MIT |
| three/addons/shaders/OutputShader.js | three 0.187.0 | https://unpkg.com/three@0.187.0/examples/jsm/shaders/OutputShader.js | 1876 | 353479f77a8d7e2629d49ccac9fc2f5dbfdda5442e0adf867b00377a2fcb0cb2 | MIT |
| three/three.core.js | three 0.187.0 | https://unpkg.com/three@0.187.0/build/three.core.js | 1474799 | 613e370f76638fdef83926642bf256dc9615684922de1ce1f63a8583e5d78578 | MIT |
| three/three.module.js | three 0.187.0 | https://unpkg.com/three@0.187.0/build/three.module.js | 658900 | 104f56145899722094556490d787aae0617cc2fc3382f31df02d724ea1aee341 | MIT |
