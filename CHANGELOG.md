# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] - 2026-01-21

### Fixed
- **Smart Error Handling**: Improved handling of transient API errors
  - 502/503/504 errors now logged as warnings instead of errors
  - Automatic re-authentication on 401/403 errors with immediate retry
  - Cleaner log output for common transient failures
  - Plugin continues polling even if TryFi API is temporarily unavailable
  
### Changed
- Error messages are now more descriptive and actionable
- Reduced log spam during temporary API outages

## [1.1.0] - 2026-01-21

### Added
- **Ignored Pets**: New `ignoredPets` configuration option to exclude specific pets from HomeKit
  - Add pet names to the ignore list in config
  - Case-insensitive matching
  - Ignored pets won't create HomeKit accessories
  - Polling skips ignored pets to reduce API calls
  - Example: Add `"Charlie"` to `ignoredPets` array to exclude Charlie

### Configuration Example
```json
{
  "platform": "TryFi",
  "username": "your@email.com",
  "password": "your_password",
  "pollingInterval": 60,
  "escapeAlertType": "leak",
  "ignoredPets": ["Charlie", "Max"]
}
```

## [1.0.0] - 2026-01-21

### Added
- Initial release
- TryFi GPS collar integration with HomeKit
- Escape alert sensor (leak or motion sensor)
- Battery monitoring with low battery warnings
- LED light control
- Lost Dog Mode switch
- Automatic polling for updates
- Session-based authentication with cookie persistence

### Features
- Per-dog HomeKit accessories
- Safe zone detection (escape alerts when outside safe zones AND not with owner)
- Configurable polling interval (30-300 seconds)
- Configurable escape alert type (leak sensor for critical alerts, motion sensor for standard)
