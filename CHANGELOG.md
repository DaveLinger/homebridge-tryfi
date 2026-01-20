# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-01-20

### Added
- Initial release of homebridge-tryfi
- Battery Service - Shows battery level and charging status for each collar
- LED Light Control - Turn collar LED on/off
- Lost Dog Mode Switch - Toggle high-frequency GPS tracking mode
- Escape Alert Sensor - Configurable leak or motion sensor that triggers when dog is outside all safe zones AND alone
- Automatic discovery of all TryFi collars on account
- Configurable polling interval (10-300 seconds)
- Support for multiple dogs with separate accessories per collar
- GraphQL API client for TryFi backend
- Homebridge Config UI X integration

### Features
- **Smart Escape Detection**: Only alerts when dog is BOTH outside safe zones AND not with owner
- **Configurable Alert Type**: Choose between critical (leak sensor) or standard (motion sensor) notifications
- **Full Collar Control**: Battery monitoring, LED control, and Lost Dog Mode activation
- **Multi-Dog Support**: Each collar gets its own set of HomeKit accessories
- **Reliable Polling**: Configurable update frequency with automatic retry on failure
