# CHANGELOG

## [2.1.5] - 2026-07-14

### Fixed

- Return the shared processed promise from `call()` without `async` wrapping so concurrent joiners receive the same Promise instance.
- Do not route `onSuccess` exceptions through `onError`; success-callback failures reject the promise.
- Preserve the original request error when `onError` itself throws.
- Reject invalid `method` and `url` arguments with clear `TypeError` messages.

### Changed

- Include `config.params` in the de-duplication key via deterministic serialisation so different query subsets do not share an in-flight response.
- Store in-flight entries under a SHA-256 hash of the stable identity while exposing full `identity` (plus `original` / `processed`) on each `ActiveRequest` value for inspection.
- Expanded README with detailed usage guidance, de-duplication semantics, and patterns for effective integration.
- Documented baseURL versus de-duplication keys, interceptor join behaviour, SSR isolation, FAQ, and comparison with query libraries.
- Declared Axios as a peer dependency (`axios >= 1`) instead of a direct runtime dependency; kept Axios in devDependencies for tests.
- Upgraded Axios to ^1.18.1 and Vitest tooling to ^4.1.10.
- Removed unused `braces` development dependency.
- Declared `engines.node` as `>=18`.
- Added a GitHub Actions CI workflow for install, audit, test, and build on `main`/`develop` pushes and pull requests.
- Hardened the publish workflow: skip npm publish when the version already exists, and publish with provenance when releasing.
- Expanded RequestManager tests for documented de-duplication and callback behaviour.
- Documented intentional HTTP-phase de-duplication, null/undefined payload coercion, and mid-flight `activeRequests.clear()` risks.

### Documentation

- Corrected outdated singleton documentation; isolated `RequestManager` instances are supported.
- Backfilled changelog entries for 2.0.1 through 2.1.4 from release history.

## [2.1.4] - 2026-07-14

### Changed

- Upgraded transitive form-data and vite dependencies to resolve Dependabot security alerts.
- Refreshed package-lock.json so npm ci succeeds with npm 11 peer resolution on GitHub Actions.

## [2.1.3] - 2026-05-12

### Changed

- Upgraded Axios to ^1.16.0 to resolve npm audit security alerts.
- Refreshed package-lock.json for npm 11 compatibility in GitHub Actions.
- Added a tag-based GitHub Actions workflow for npm trusted publishing.

## [2.1.2] - 2026-04-15

### Changed

- Upgraded package dependencies.

## [2.1.1] - 2026-03-04

### Changed

- Updated README with the latest RequestManager usage guidance.

## [2.1.0] - 2026-03-04

### Added

- Exported both the RequestManager class and the default request-manager instance.
- Added comprehensive Vitest coverage for RequestManager behaviour.
- Restored static RequestManager.call compatibility.

### Changed

- Scoped request de-duplication by Axios client instance.
- Improved RequestManager generic typing and callback handling.
- Improved package exports and build configuration.
- Added a prebuild cleanup step for dist.
- Updated dependencies, including security-related dependency updates.

## [2.0.3] - 2025-08-06

### Changed

- Updated dependencies to address security findings.

## [2.0.2] - 2024-11-25

### Changed

- Updated dependencies.

## [2.0.1] - 2024-08-27

### Changed

- Updated dependencies.

## [2.0.0] - 2024-03-26

### Changed

- Converted the codebase to TypeScript to enhance type safety and developer experience.
- Introduced the generation of both CommonJS (CJS) and ECMAScript Module (ESM) distributables to ensure backward compatibility and modern module support.

### Breaking Changes

- Due to the shift to TypeScript, the import statements for the `RequestManager` might need to be updated in dependent projects. Ensure to check and update your imports and type annotations where necessary.

## [1.0.0] - 2024-03-11

### Added

- Initial release of the `request-manager` library.
- Core functionality for managing and regulating HTTP requests to prevent duplicate calls to the same URL and method.
