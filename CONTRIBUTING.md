# Contributing to YouSage

Bug reports, documentation fixes, and pull requests are welcome. Before starting a large change, open an issue so the maintainer can discuss the scope with you. The [product brief](docs/product-brief.md) and [interface design](docs/design.md) describe how the app is intended to work.

## Report a bug or request a feature

Search [GitHub Issues](https://github.com/yabswannalearn/yousage/issues) first. For a bug, include the YouSage version or commit, Windows version, affected subscription if relevant, steps to reproduce, and what you expected to happen. For a feature request, describe the workflow you want to improve.

Use demo data or privacy mode in screenshots. Remove credentials, account identifiers, usage exports, and conversation titles before attaching logs or files. Report vulnerabilities privately through the [security policy](SECURITY.md).

## Set up and run checks

Follow [Build from source](README.md#build-from-source) for the Windows development environment. Run the checks relevant to your change from the repository root.

```powershell
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

For UI changes, install Chromium with `npx playwright install chromium`, start `npm run dev` in a separate terminal, and run `npm run test:ui`. The [Windows CI workflow](.github/workflows/ci.yml) lists the full set of browser walkthroughs. The [development notes](docs/development.md) explain which checks need the native Windows app.

## Open a pull request

Keep the change focused. Describe the problem, how the change addresses it, and which checks you ran. Link any related issue and include a demo-data screenshot for visible UI changes.
