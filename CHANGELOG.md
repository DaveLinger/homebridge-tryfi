# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-01-29

### Added
- **Escape Alert Hysteresis (Debouncing)**: Prevents false escape alerts from GPS drift
  - New `escapeConfirmations` config option (default: 2)
  - Requires multiple consecutive "out of zone" readings before triggering alert
  - Prevents false alarms from GPS noise at safe zone boundaries
  - Quick re-check system for faster real escape detection
  - New `escapeCheckInterval` config option (default: 30s)
  - When potential escape detected, re-checks faster than normal polling
  - Set `escapeConfirmations` to 1 for immediate alerts (v1.1.3 behavior)

### Fixed
- **Charging State Always True**: Fixed battery charging state detection
  - Was using `ConnectedToBase` which means "BLE connected to base" not "charging"
  - Now correctly uses `bq27421Info.batteryAverageCurrentMa` from battery chip
  - Positive current (>0 mA) = charging, zero/negative = not charging
  - Accurately shows charging only when collar is physically on charging contacts

### Changed
- Escape alerts now only update HomeKit when state actually changes (prevents notification spam)
- Improved logging: clear emoji indicators for escape events (🚨 escaped, ✅ back safe)
- More detailed debug logging for escape detection process

### Technical Details
- In-memory escape counters per pet (resets on plugin restart)
- Quick check scheduling system for accelerated re-verification
- Proper cleanup of pending checks on shutdown
- Escape logic still requires both conditions: out of zone AND not with owner
- Charging detection uses battery management chip current reading (bq27421Info.batteryAverageCurrentMa)

## [1.1.3] - 2026-01-29

### Fixed
- **CRITICAL: False Escape Alerts on Timeouts**: Fixed bug causing false escape alerts when location queries timeout
  - Location data is now cached per pet
  - On timeout/error, cached data is returned instead of nulls
  - Prevents false "dog escaped" alerts when TryFi API is slow
  - First successful location query is cached and reused during subsequent failures
  - This was a serious bug - timeouts would set placeName=null, triggering false escape alerts

### Technical Details
- Added `locationCache` Map to store last known good location per pet
- Location queries that fail now return cached data (if available) instead of null values
- Cache is updated only on successful location queries
- Debug logging shows when cached data is being used

## [1.1.2] - 2026-01-29

### Fixed
- **Location Timeout Handling**: Eliminated stack traces for location query timeouts
  - Timeout errors now logged at debug level instead of warnings
  - Transient errors (502/503/504) on location queries logged at debug level
  - Plugin continues working with cached/default location data when API is slow
  - Cleaner logs during temporary API slowdowns

### Changed
- Location query errors now use smart categorization (timeout vs server error vs other)
- Debug-level logging for expected transient failures

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
