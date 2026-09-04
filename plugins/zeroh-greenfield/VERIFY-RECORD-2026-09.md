# Archetype verification record

| archetype | date | command | observed | box | tool version | execution commit |
| --- | --- | --- | --- | --- | --- | --- |
| web | 2026-09-04 | npx create-next-app@^16 my-app --typescript --tailwind --eslint --app --src-dir --import-alias @/* --use-npm --yes; manifest Verify | exit 0 | linux-x64 Node 22.23.2 | create-next-app 16.3.4 | 92b9791 |
| android | 2026-09-04 | command -v gradle; android.md Verify | unavailable — apt-get install gradle | linux-x64 Node 22.23.2 | gradle unavailable | 9613781 |
| flutter | 2026-09-04 | command -v flutter; flutter.md Verify | unavailable — brew install --cask flutter | linux-x64 Node 22.23.2 | flutter unavailable | 72ee3a4 |
| expo | 2026-09-04 | npx create-expo-app@^4 my-app --yes; move SDK 57 src/app compatibility path to app; manifest Verify | exit 0 | linux-x64 Node 22.23.2 | create-expo-app 4.0.0 | 694a3da |
| nx-monorepo | 2026-09-04 | npx create-nx-workspace@^23 my-workspace --preset=ts --workspaceType=integrated --packageManager=npm --nxCloud=skip --interactive=false; manifest Verify | exit 0 | linux-x64 Node 22.23.2 | create-nx-workspace 23.2.0 | 336e82b |
| library-cli | 2026-09-04 | npx create-vite@^8 my-lib --template vanilla-ts; tsup build; manifest Verify under capbuild | exit 0 | linux-x64 Node 22.23.2 | create-vite 8.3.0; tsup 8.5.1 | 86b3126 |
