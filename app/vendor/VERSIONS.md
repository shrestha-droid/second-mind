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
