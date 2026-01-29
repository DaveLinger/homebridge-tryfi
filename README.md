# homebridge-tryfi

Homebridge plugin for TryFi Dog GPS Collars

[![npm version](https://badge.fury.io/js/homebridge-tryfi.svg)](https://badge.fury.io/js/homebridge-tryfi)

## Features

This plugin exposes your TryFi dog collars to HomeKit with the following accessories per dog:

- **Battery Service** - Shows accurate battery level and charging status
  - Real-time battery percentage
  - Accurate charging detection (only when physically on charger)
  - Low battery warnings
- **Lightbulb** - Control the collar's LED light (on/off)
- **Switch** - Toggle Lost Dog Mode (triggers high-frequency GPS updates)
- **Escape Alert** - Smart sensor with GPS drift protection that triggers when your dog is:
  - Outside ALL safe zones, AND
  - Not connected to any owner via Bluetooth
  - **NEW in v1.2.0:** Configurable hysteresis prevents false alarms from GPS noise

## What's New in v1.2.0 🎉

### 🔥 Escape Alert Hysteresis (GPS Drift Protection)

Prevents false escape alerts from GPS noise at safe zone boundaries:

- **Configurable confirmations** - Requires 2+ consecutive "out of zone" readings (default: 2)
- **Quick re-check system** - Fast verification when potential escape detected (default: 30s)
- **Smart detection** - Filters GPS drift while still detecting real escapes quickly

**Example:** Dog near fence gets temporary GPS blip showing "outside zone"
- **Without hysteresis:** False alarm! 🚨
- **With hysteresis (default):** Waits 30s, re-checks, sees dog is safe, no alert ✅

### 🔋 Accurate Charging Detection

Fixed charging status to only show "charging" when collar is physically on charging base:

- **Before:** Always showed "charging" when near base station ❌
- **After:** Only shows "charging" when actively receiving charge ✅
- Uses battery chip current sensing (`batteryAverageCurrentMa`) for accurate detection

### 🐕 Ignore Specific Pets

Exclude specific pets from HomeKit monitoring:

```json
"ignoredPets": ["Charlie"]
```

Only creates accessories for pets you want to monitor.

## Escape Alert Logic

### Basic Logic (Always Required)

The escape alert only triggers when **BOTH** conditions are true:

1. `placeName` is `null` (not in any defined safe zone)
2. `connectedToUser` is `null` (not with an owner)

**Examples:**
- ✅ Dog at home alone → No alert (in safe zone)
- ✅ Dog at dog park alone → No alert (in safe zone)  
- ✅ Dog on a walk with you outside zones → No alert (with owner)
- 🚨 **Dog escaped alone outside zones** → ALERT!

### Hysteresis Protection (v1.2.0+)

Requires multiple consecutive confirmations before alerting:

**Scenario 1: GPS Drift (False Alarm Prevented)**
```
00:00 - Poll: Out of zone (1/2 confirmations)
00:30 - Quick check: Back in zone → Counter reset
Result: No alert ✅
```

**Scenario 2: Real Escape (Fast Detection)**
```
00:00 - Poll: Out of zone (1/2 confirmations)
00:30 - Quick check: Still out (2/2 confirmations)
Result: 🚨 Alert in 30 seconds! (faster than 60s normal polling)
```

**Scenario 3: Boundary Walking (No Spam)**
```
00:00 - Out (1/2) → 00:30 In → Reset
01:00 - Out (1/2) → 01:30 In → Reset
02:00 - Out (1/2) → 02:30 In → Reset
Result: No alerts, dog safe ✅
```

## Installation

### Option 1: Homebridge Config UI X (Recommended)

1. Search for "TryFi" in the Homebridge Config UI X plugin marketplace
2. Click Install
3. Configure with your TryFi credentials

### Option 2: Manual Installation

```bash
npm install -g homebridge-tryfi
```

## Configuration

Add this to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "TryFi",
      "name": "TryFi",
      "username": "your@email.com",
      "password": "yourpassword",
      "pollingInterval": 60,
      "escapeAlertType": "leak",
      "escapeConfirmations": 2,
      "escapeCheckInterval": 30,
      "ignoredPets": []
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Range | Description |
|--------|----------|---------|-------|-------------|
| `platform` | Yes | - | - | Must be `"TryFi"` |
| `name` | Yes | - | - | Platform name (can be anything) |
| `username` | Yes | - | - | Your TryFi email address |
| `password` | Yes | - | - | Your TryFi password |
| `pollingInterval` | No | `60` | 10-300 | Seconds between API polls |
| `escapeAlertType` | No | `"leak"` | leak/motion | Notification urgency level |
| `escapeConfirmations` | No | `2` | 1-5 | Consecutive out-of-zone checks required |
| `escapeCheckInterval` | No | `30` | 10-120 | Seconds between quick re-checks |
| `ignoredPets` | No | `[]` | - | Array of pet names to exclude |

### Escape Alert Types

**Leak Sensor** (default):
- Triggers **critical** HomeKit notifications
- Shows "Leak Detected" when dog escapes
- Red alert badge in Home app
- Best for: Maximum urgency

**Motion Sensor**:
- Triggers **standard** HomeKit notifications  
- Shows "Motion Detected" when dog escapes
- Standard notification
- Best for: Less alarming notifications, still useful for automations

### Escape Confirmation Settings

**escapeConfirmations** - How many consecutive checks required:

| Value | Behavior | Detection Time | Best For |
|-------|----------|----------------|----------|
| `1` | Immediate alert | Instant | Maximum sensitivity, accept GPS noise |
| `2` ✅ | Default | ~30 seconds | **Recommended** - filters drift, fast alerts |
| `3` | Conservative | ~60 seconds | Very GPS-noisy areas |
| `5` | Paranoid | ~120 seconds | Extreme GPS problems |

**escapeCheckInterval** - Re-check speed during potential escape:

| Value | Use Case |
|-------|----------|
| `10` | Very fast response (more API calls) |
| `30` ✅ | **Recommended** - fast + efficient |
| `60` | Slower but fewer API calls |
| `120` | Very conservative |

**Detection Time Calculation:**
- Time to alert = `(escapeConfirmations - 1) × escapeCheckInterval`
- Example: 2 confirmations × 30s = 30 seconds
- Example: 3 confirmations × 30s = 60 seconds

### Configuration Examples

**Default (Recommended):**
```json
{
  "platform": "TryFi",
  "username": "your@email.com",
  "password": "yourpassword",
  "pollingInterval": 60,
  "escapeAlertType": "leak",
  "escapeConfirmations": 2,
  "escapeCheckInterval": 30
}
```

**Maximum Sensitivity (v1.1.3 behavior):**
```json
{
  "platform": "TryFi",
  "username": "your@email.com",
  "password": "yourpassword",
  "escapeConfirmations": 1
}
```

**Conservative (GPS-Noisy Area):**
```json
{
  "platform": "TryFi",
  "username": "your@email.com",
  "password": "yourpassword",
  "escapeConfirmations": 3,
  "escapeCheckInterval": 30
}
```

**Fast Response:**
```json
{
  "platform": "TryFi",
  "username": "your@email.com",
  "password": "yourpassword",
  "escapeConfirmations": 2,
  "escapeCheckInterval": 10
}
```

**Monitor Only One Dog:**
```json
{
  "platform": "TryFi",
  "username": "your@email.com",
  "password": "yourpassword",
  "ignoredPets": ["Charlie", "OtherDog"]
}
```

## Usage

### HomeKit Accessories

Each monitored collar appears in HomeKit with:

**Battery**
- Current charge percentage (0-100%)
- Charging status (Yes/No) - only "Yes" when physically on charger
- Low battery indicator (<20%)

**LED Light**
- Turn collar LED on/off remotely
- Useful for finding your dog in the dark

**Lost Dog Mode**
- Enable high-frequency GPS updates
- Increases location accuracy during search
- Uses more battery

**Escape Alert**
- Leak Sensor (default) or Motion Sensor
- Triggers when dog escapes outside safe zones while alone
- Smart hysteresis prevents false GPS drift alarms

### Automations

Example automations you can create:

**Critical Escape Alert:**
```
When [Dog Name] Escape Alert detects leak
  → Send critical notification "🚨 [Dog] has escaped!"
  → Turn on [Dog Name] Lost Mode
  → Flash all lights red
  → Send location to family members
```

**Low Battery Warning:**
```
When [Dog Name] Battery drops below 20%
  → Send notification "🔋 [Dog]'s collar battery is low"
  → Remind to charge overnight
```

**Auto Lost Mode on Escape:**
```
When [Dog Name] Escape Alert detects leak
  → Turn on [Dog Name] Lost Mode (high-frequency GPS)
```

**Arrival Home:**
```
When [Dog Name] Battery charging status becomes "Yes"
  → Turn off Lost Mode
  → Send notification "[Dog] is home and charging"
```

**Find Dog at Night:**
```
When I say "Find [Dog]"
  → Turn on [Dog Name] LED Light
  → Wait 30 seconds
  → Turn off LED Light
```

## Troubleshooting

### False Escape Alerts

**Problem:** Getting escape alerts when dog is safe near fence

**Solution:** Increase `escapeConfirmations` to 3 or 4:
```json
"escapeConfirmations": 3
```

### Charging Status Always "No"

**Problem:** Collar on charger but shows "Not Charging"

**Possible causes:**
- Collar not properly seated on charging contacts
- Dirty charging contacts (clean with isopropyl alcohol)
- Battery already at 100% (trickle charge current too low to detect)

**Verify:** Battery percentage should be increasing if actually charging

### Missing Pets

**Problem:** Some pets not appearing in HomeKit

**Check:**
1. Pets not in `ignoredPets` array
2. Pets have active TryFi subscription
3. Check Homebridge logs for errors

### Slow Escape Detection

**Problem:** Takes too long to alert when dog escapes

**Solution:** Reduce `escapeCheckInterval`:
```json
"escapeCheckInterval": 10
```

Or reduce confirmations (less GPS protection):
```json
"escapeConfirmations": 1
```

## Technical Details

### API Authentication
- REST login with form data at `/auth/login`
- Session cookies for GraphQL API access
- Automatic re-authentication on 401/403 errors

### Polling Strategy
- Normal polling: User-configured interval (default 60s)
- Quick checks: Faster interval during potential escapes (default 30s)
- Smart error handling for transient API failures

### Charging Detection
- Uses BQ27421 battery management chip data
- `batteryAverageCurrentMa > 0` indicates charging
- Field only present when collar on charging contacts
- Eliminates false "charging" status from base BLE connection

### Escape Detection
- In-memory hysteresis counters per pet
- Resets on plugin restart (safe default)
- Quick check scheduling for fast real escape detection
- State change detection prevents notification spam

### Location Caching
- Caches last known location per pet
- Returns cached location on API timeout
- Prevents false escape alerts from temporary API failures

## Development

### Building

```bash
npm install
npm run build
```

### Linking for Development

```bash
npm link
```

Then restart Homebridge.

### Running Tests

```bash
npm test
```

## Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

**Latest:** v1.2.0
- Escape alert hysteresis (GPS drift protection)
- Accurate charging detection using battery current
- Ignore specific pets feature
- Smart notification handling

## Credits

Based on the excellent [pytryfi](https://github.com/sbabcock23/pytryfi) library and [hass-tryfi](https://github.com/sbabcock23/hass-tryfi) Home Assistant integration.

Thanks to all contributors and users for feedback and testing!

## License

Apache-2.0

## Disclaimer

This is an unofficial plugin and is not affiliated with or endorsed by TryFi.
