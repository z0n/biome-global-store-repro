# Biome type-aware lint misses React types with pnpm's global virtual store

A real pnpm reproduction, using registry-published React and its types. The
script installs the same locked dependencies into two projects using pnpm
12.17.0, then runs Biome through `pnpm exec` in each project.

**The only configuration difference is `virtualStoreType: project` versus
`virtualStoreType: global`.** No symlinks are manually created or edited.

## Run

Requires Node.js 24+ and pnpm 12.17.0. The package manager version is pinned in
`package.json`. Network access is needed to install the pinned packages.

```sh
git clone https://github.com/z0n/biome-global-store-repro.git
cd biome-global-store-repro
pnpm run repro
```

No root installation is needed: the runner uses only Node built-ins and installs
the two consumer projects itself. Their shared fixture lockfile pins:

- Biome 2.6.5
- React 19.2.8
- `@types/react` 19.2.9

**Exit code 1 is expected while the bug exists.** The runner verifies installation
success, actual dependency paths, the baseline, and the positive/negative controls.
Unexpected failures throw assertions rather than being labeled as this bug. It
exits 0 if both layouts correctly detect the same violations.

## Example

The entire example is a small hook; it is analyzed statically and never executed:

```ts
import { useState } from 'react';

export function useExample() {
  const [text] = useState<string>('hello');
  return [
    text.toString(), // Must report: state is already a string.
    'hello'.toString(), // Positive control: must report.
    (42).toString(), // Negative control: must not report.
  ];
}
```

Only `lint/nursery/noUselessTypeConversion` is enabled. The explicit type argument
keeps this reproduction independent of generic-inference bugs.

## Verified result

Tested on Linux x64, Node.js 24.21.0, pnpm 12.17.0, Biome 2.6.5:

```text
project-store: redundant-conversion diagnostics on lines 6, 7
global-store: redundant-conversion diagnostics on lines 7

BUG REPRODUCED: global-store dependency types silently lose a diagnostic.
Expected lines 6 and 7 in both layouts; global-store only reports line 7.
```

Expected: both layouts report lines 6 and 7. Neither should report line 8.

The runner also prints the actual `@types/react` target. In the project case it
lives under the consumer's `node_modules/.pnpm/`; in the global case it lives
under the shared `pnpm-store/v11/links/`, outside the consumer project.

## How it works

The runner copies `fixtures/project/` to `.repro/project-store/` and
`.repro/global-store/`, changing only `virtualStoreType` in the second copy.
Both retain `addMissingPeerTypes: true`: that setting does not resolve this bug.

It runs the following commands in each generated project:

```sh
pnpm install --frozen-lockfile --ignore-scripts --store-dir /absolute/path/to/.repro/pnpm-store
pnpm exec biome lint --only=nursery/noUselessTypeConversion --reporter=json example.ts
```

Both installs share the same content-addressable store. Its location is scoped
to the reproduction so it does not alter global pnpm configuration. pnpm creates
the package layouts itself. The explicit version-specific release-age exceptions
in the fixture allow testing the newly released Biome version.

Each generated project retains its manifest, workspace configuration, lockfile,
real installation, `install.log`, `diagnostics.json`, and `stderr.txt`. Rerun either:

```sh
(cd .repro/project-store && pnpm exec biome lint --only=nursery/noUselessTypeConversion example.ts)
(cd .repro/global-store && pnpm exec biome lint --only=nursery/noUselessTypeConversion example.ts)
```

Every reproduction run recreates this repo's ignored `.repro/` directory. This
includes its scoped package store, so the run starts with fresh installations.
The runner is verified on Linux; other platforms have not been tested.

## Suspected cause

In Biome 2.6.5,
[`scan_dependencies()` filters out dependency paths outside `project_path`](https://github.com/biomejs/biome/blob/%40biomejs/biome%402.6.5/crates/biome_service/src/scanner.rs#L737-L830):

```rust
.filter(|dependency_path| dependency_path.starts_with(project_path))
```

Resolved external dependencies should remain eligible for type indexing. The
nearby ancestor-directory collection and watching boundaries also need to account
for external paths, instead of simply walking ancestors to the filesystem root.
This repo demonstrates the failure; it does not include a validated Biome patch.
