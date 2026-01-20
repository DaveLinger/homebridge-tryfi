# homebridge-tryfi

Homebridge plugin for TryFi Dog GPS Collars

[![npm version](https://badge.fury.io/js/homebridge-tryfi.svg)](https://badge.fury.io/js/homebridge-tryfi)

## Features

This plugin exposes your TryFi dog collars to HomeKit with the following accessories per dog:

- **Battery Service** - Shows battery level and charging status
- **Lightbulb** - Control the collar's LED light (on/off)
- **Switch** - Toggle Lost Dog Mode (triggers high-frequency GPS updates)
- **Escape Alert** - Configurable sensor (Leak or Motion) that triggers when your dog is:
  - Outside ALL safe zones, AND
  - Not connected to any owner via Bluetooth

### Escape Alert Logic

The escape alert only triggers when BOTH conditions are true:
1. `currPlaceName` is `null` (not in any defined safe zone)
2. `connectedTo` is `null` (not with an owner)

This means:
- ✅ Dog at home alone → No alert (in safe zone)
- ✅ Dog at dog park alone → No alert (in safe zone)  
- ✅ Dog on a walk with you → No alert (with owner)
- 🚨 **Dog escaped alone** → ALERT! (outside zones + alone)

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
      "escapeAlertType": "leak"
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | - | Must be `"TryFi"` |
| `name` | Yes | - | Platform name (can be anything) |
| `username` | Yes | - | Your TryFi email address |
| `password` | Yes | - | Your TryFi password |
| `pollingInterval` | No | `60` | Seconds between API polls (10-300) |
| `escapeAlertType` | No | `"leak"` | `"leak"` for critical alerts, `"motion"` for standard alerts |

### Escape Alert Types

**Leak Sensor** (default):
- Triggers **critical** HomeKit notifications
- Shows "Leak Detected" when dog escapes
- Best for: Maximum urgency

**Motion Sensor**:
- Triggers **standard** HomeKit notifications  
- Shows "Motion Detected" when dog escapes
- Best for: Less alarming notifications, still useful for automations

## Usage

### Automations

Example automations you can create:

**Critical Escape Alert:**
```
When [Dog Name] Escape Alert detects leak
  → Send notification "🚨 [Dog] has escaped!"
  → Turn on [Dog Name] Lost Mode
  → Flash living room lights
```

**Low Battery Warning:**
```
When [Dog Name] Battery drops below 20%
  → Send notification "🔋 [Dog]'s collar battery is low"
```

**Auto Lost Mode on Escape:**
```
When [Dog Name] Escape Alert detects leak
  → Turn on [Dog Name] Lost Mode
```

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

## Credits

Based on the excellent [pytryfi](https://github.com/sbabcock23/pytryfi) library and [hass-tryfi](https://github.com/sbabcock23/hass-tryfi) Home Assistant integration.

## License

Apache-2.0

## Disclaimer

This is an unofficial plugin and is not affiliated with or endorsed by TryFi.
