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
  - Configurable hysteresis prevents false alarms from GPS noise

## What's New in v1.2.0 🎉

### 🔥 Escape Alert Hysteresis (GPS Drift Protection)

Prevents false escape alerts from GPS noise at safe zone boundaries:

- **Configurable confirmations** - Requires 2+ consecutive "out of zone" readings (default: 2)
- **Quick re-check system** - Fast verification when potential escape detected (default: 30s)
- **Smart detection** - Filters GPS drift while still detecting real escapes quickly

**Example:** Dog near fence gets temporary GPS blip showing "outside zone"
- **Without hysteresis:** False alarm! 🚨
- **With hysteresis (default):** Waits 30s, re-checks, sees dog is safe, no alert ✅

### 🐕 Ignore Specific Pets

Exclude specific pets from HomeKit monitoring:

```json
"ignoredPets": ["Charlie"]
```

Only creates accessories for pets you want to monitor.

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
When [Dog Name] Escape Alert stops detecting leak
  → Turn off Lost Mode
  → Send notification "[Dog] is home"
```

**Find Dog at Night:**
```
When I say "Find [Dog]"
  → Turn on [Dog Name] LED Light
```

## Troubleshooting

**Problem:** Takes too long to alert when dog escapes

**Solution:** Reduce `escapeCheckInterval`:
```json
"escapeCheckInterval": 10
```

Or reduce confirmations (less GPS protection):
```json
"escapeConfirmations": 1
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
