# CHANGELOG

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
