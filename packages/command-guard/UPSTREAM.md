# Upstream provenance

Command Guard uses official Tree-sitter packages. It does not vendor their source.

## `tree-sitter-bash`

- Package: `tree-sitter-bash@0.25.1`
- Repository: <https://github.com/tree-sitter/tree-sitter-bash>
- License: MIT
- Runtime artifact: `tree-sitter-bash.wasm`
- SHA-256: `8292919c88a0f7d3fb31d0cd0253ca5a9531bc1ede82b0537f2c63dd8abe6a7a`

The review covered `package.json`, `LICENSE`, `README.md`, `grammar.js`, `tree-sitter.json`, the
published WASM grammar, the Node binding entry points, the query files, and the published package
file list. Command Guard loads only the WASM grammar. It does not load the native Node binding.

The package has an install script for its optional native binding. The published package includes
prebuilt binaries for common systems. Command Guard does not use those binaries. The clean install
completed without a local source build on the development system.

## `web-tree-sitter`

- Package: `web-tree-sitter@0.27.0`
- Repository: <https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web>
- License: MIT
- JavaScript SHA-256: `7c49e3c1d87e24e0bb4c2def909d17154dfde281f5f8280225450090bb4b8110`
- Runtime WASM SHA-256: `c03bccdc3b448a32848f5ae327e209c982bbb0840d43eec8bc2d5759544a1ed3`

The review covered `package.json`, `LICENSE`, `README.md`, the JavaScript and CommonJS runtime
files, type declarations, runtime WASM files, source maps, exports, and package scripts.

## Runtime audit

- **Process execution:** These dependencies do not start processes at runtime.
- **Filesystem access:** Command Guard reads the installed Bash grammar WASM file. The parser does
  not read command targets or execute shell expansion.
- **Network access:** None at runtime.
- **Credentials:** None.
- **Native code:** Command Guard uses the WebAssembly parser path only.
- **Telemetry:** None.

`npm audit --omit=dev` reported no runtime dependency vulnerabilities when these packages were
adopted.
