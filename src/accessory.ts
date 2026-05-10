import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { TryFiPlatform } from './platform';
import { TryFiPet } from './types';

/**
 * TryFi Collar Accessory
 * Represents a single dog collar with multiple HomeKit services
 */
export class TryFiCollarAccessory {
  private escapeAlertService: Service;
  private batteryService: Service;
  private lightbulbService: Service;
  private lostDogSwitchService: Service;
  private offlineAlertService?: Service;

  private lastEscapeState?: boolean;
  private lastOfflineAlertState?: boolean;

  constructor(
    private readonly platform: TryFiPlatform,
    private readonly accessory: PlatformAccessory,
    private pet: TryFiPet,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'TryFi')
      .setCharacteristic(this.platform.Characteristic.Model, 'GPS Dog Collar')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, pet.moduleId)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '1.0.0');

    // Get or create services
    const escapeAlertType = this.platform.config.escapeAlertType || 'leak';
    const offlineAlertType = this.platform.config.offlineAlertType || 'motion';
    const offlineAlertMinutes = this.platform.config.offlineAlertMinutes;

    // Escape alert service — uses 'escape' subtype so it can coexist with the offline
    // alert service even when both are configured to the same sensor type (HAP requires
    // unique subtypes when an accessory has multiple services with the same UUID).
    // Note: this is a one-time breaking change for users upgrading from v1.2.x — any
    // automations using the escape alert will need to be re-added after upgrading.
    // Migration: remove any legacy no-subtype service from v1.2.x.
    if (escapeAlertType === 'leak') {
      this.escapeAlertService =
        this.accessory.getServiceById(this.platform.Service.LeakSensor, 'escape') ||
        this.accessory.addService(this.platform.Service.LeakSensor, `${pet.name} Escape Alert`, 'escape');
      const legacyEscape = this.accessory.services.find(s => s.UUID === this.platform.Service.LeakSensor.UUID && !s.subtype);
      if (legacyEscape) this.accessory.removeService(legacyEscape);
      const staleEscapeMotion = this.accessory.getServiceById(this.platform.Service.MotionSensor, 'escape');
      if (staleEscapeMotion) this.accessory.removeService(staleEscapeMotion);
    } else {
      this.escapeAlertService =
        this.accessory.getServiceById(this.platform.Service.MotionSensor, 'escape') ||
        this.accessory.addService(this.platform.Service.MotionSensor, `${pet.name} Escape Alert`, 'escape');
      const legacyEscape = this.accessory.services.find(s => s.UUID === this.platform.Service.MotionSensor.UUID && !s.subtype);
      if (legacyEscape) this.accessory.removeService(legacyEscape);
      const staleEscapeLeak = this.accessory.getServiceById(this.platform.Service.LeakSensor, 'escape');
      if (staleEscapeLeak) this.accessory.removeService(staleEscapeLeak);
    }
    this.escapeAlertService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} Escape Alert`);
    this.escapeAlertService.setCharacteristic(this.platform.Characteristic.ConfiguredName, `${pet.name} Escape Alert`);

    // Offline alert service — optional, uses 'offline' subtype
    if (offlineAlertMinutes) {
      if (offlineAlertType === 'leak') {
        this.offlineAlertService =
          this.accessory.getServiceById(this.platform.Service.LeakSensor, 'offline') ||
          this.accessory.addService(this.platform.Service.LeakSensor, `${pet.name} Collar Offline`, 'offline');
        const staleOfflineMotion = this.accessory.getServiceById(this.platform.Service.MotionSensor, 'offline');
        if (staleOfflineMotion) {
          this.accessory.removeService(staleOfflineMotion);
        }
      } else {
        this.offlineAlertService =
          this.accessory.getServiceById(this.platform.Service.MotionSensor, 'offline') ||
          this.accessory.addService(this.platform.Service.MotionSensor, `${pet.name} Collar Offline`, 'offline');
        const staleOfflineLeak = this.accessory.getServiceById(this.platform.Service.LeakSensor, 'offline');
        if (staleOfflineLeak) {
          this.accessory.removeService(staleOfflineLeak);
        }
      }
      this.offlineAlertService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} Collar Offline`);
      this.offlineAlertService.setCharacteristic(this.platform.Characteristic.ConfiguredName, `${pet.name} Collar Offline`);
    } else {
      // offlineAlertMinutes not set — remove any lingering offline services from a previous config
      const staleOfflineLeak = this.accessory.getServiceById(this.platform.Service.LeakSensor, 'offline');
      if (staleOfflineLeak) {
        this.accessory.removeService(staleOfflineLeak);
      }
      const staleOfflineMotion = this.accessory.getServiceById(this.platform.Service.MotionSensor, 'offline');
      if (staleOfflineMotion) {
        this.accessory.removeService(staleOfflineMotion);
      }
    }

    this.batteryService = this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);
    this.batteryService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} Battery`);

    this.lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightbulbService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} LED Light`);

    this.lostDogSwitchService = this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);
    this.lostDogSwitchService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} Lost Dog Mode`);

    // Set up characteristic handlers
    this.setupCharacteristics();

    // Initial update
    this.updateCharacteristics();
  }

  private setupCharacteristics() {
    // LED Light handlers
    this.lightbulbService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleLightGet.bind(this))
      .onSet(this.handleLightSet.bind(this));

    // Lost Dog Mode handlers
    this.lostDogSwitchService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleLostModeGet.bind(this))
      .onSet(this.handleLostModeSet.bind(this));
  }

  /**
   * Update all characteristics from latest pet data
   */
  updateCharacteristics() {
    const escapeAlertType = this.platform.config.escapeAlertType || 'leak';
    
    // Escape Alert: Triggered when NOT in safe zone AND NOT with owner
    const isEscaped = (this.pet.placeName === null) && (this.pet.connectedToUser === null);
    
    // Only update HomeKit if escape state changed (prevents redundant notifications)
    if (this.lastEscapeState !== isEscaped) {
      if (escapeAlertType === 'leak') {
        this.escapeAlertService.updateCharacteristic(
          this.platform.Characteristic.LeakDetected,
          isEscaped 
            ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
            : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
        );
      } else {
        this.escapeAlertService.updateCharacteristic(
          this.platform.Characteristic.MotionDetected,
          isEscaped,
        );
      }
      
      const wasEscaped = this.lastEscapeState;
      this.lastEscapeState = isEscaped;

      if (isEscaped) {
        this.platform.log.warn(`🚨 ${this.pet.name} has ESCAPED!`);
      } else if (wasEscaped) {
        this.platform.log.info(`✅ ${this.pet.name} is back in safe zone`);
      }
    }

    // Offline Alert
    if (this.offlineAlertService && this.platform.config.offlineAlertMinutes) {
      const offlineAlertType = this.platform.config.offlineAlertType || 'motion';
      let isOfflineAlert = false;

      if (!this.pet.isOnline && this.pet.lastSeenDate) {
        const minutesOffline = (Date.now() - this.pet.lastSeenDate.getTime()) / 60000;
        isOfflineAlert = minutesOffline >= this.platform.config.offlineAlertMinutes;
      }

      if (this.lastOfflineAlertState !== isOfflineAlert) {
        if (offlineAlertType === 'leak') {
          this.offlineAlertService.updateCharacteristic(
            this.platform.Characteristic.LeakDetected,
            isOfflineAlert
              ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
              : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
          );
        } else {
          this.offlineAlertService.updateCharacteristic(
            this.platform.Characteristic.MotionDetected,
            isOfflineAlert,
          );
        }

        const wasOfflineAlert = this.lastOfflineAlertState;
        this.lastOfflineAlertState = isOfflineAlert;

        if (isOfflineAlert) {
          const minutes = this.pet.lastSeenDate
            ? Math.round((Date.now() - this.pet.lastSeenDate.getTime()) / 60000)
            : this.platform.config.offlineAlertMinutes;
          this.platform.log.warn(`${this.pet.name} collar has been offline for ${minutes} minute(s)`);
        } else if (wasOfflineAlert) {
          this.platform.log.info(`${this.pet.name} collar is back online`);
        }
      }
    }

    // Battery Service
    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.BatteryLevel,
      this.pet.batteryPercent,
    );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.ChargingState,
      this.pet.isCharging
        ? this.platform.Characteristic.ChargingState.CHARGING
        : this.platform.Characteristic.ChargingState.NOT_CHARGING,
    );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.StatusLowBattery,
      this.pet.batteryPercent < 20
        ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );

    // LED Light
    this.lightbulbService.updateCharacteristic(
      this.platform.Characteristic.On,
      this.pet.ledEnabled,
    );

    // Lost Dog Mode
    this.lostDogSwitchService.updateCharacteristic(
      this.platform.Characteristic.On,
      this.pet.mode === 'LOST_DOG',
    );

    this.platform.log.debug(`Updated ${this.pet.name}: Battery ${this.pet.batteryPercent}%, ` +
      `LED ${this.pet.ledEnabled ? 'On' : 'Off'}, Mode ${this.pet.mode}, ` +
      `Escaped: ${isEscaped}, Place: ${this.pet.placeName}, With: ${this.pet.connectedToUser}`);
  }

  /**
   * Update pet data and refresh characteristics
   */
  updatePetData(pet: TryFiPet) {
    this.pet = pet;
    this.updateCharacteristics();
  }

  // LED Light Handlers
  async handleLightGet(): Promise<CharacteristicValue> {
    return this.pet.ledEnabled;
  }

  async handleLightSet(value: CharacteristicValue) {
    const ledEnabled = value as boolean;
    try {
      await this.platform.api.setLedState(this.pet.moduleId, ledEnabled);
      this.pet.ledEnabled = ledEnabled;
      this.platform.log.info(`Set ${this.pet.name} LED to ${ledEnabled ? 'On' : 'Off'}`);
    } catch (error) {
      this.platform.log.error(`Failed to set LED for ${this.pet.name}:`, error);
      throw new this.platform.homebridgeApi.hap.HapStatusError(this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // Lost Dog Mode Handlers
  async handleLostModeGet(): Promise<CharacteristicValue> {
    return this.pet.mode === 'LOST_DOG';
  }

  async handleLostModeSet(value: CharacteristicValue) {
    const isLost = value as boolean;
    try {
      await this.platform.api.setLostDogMode(this.pet.moduleId, isLost);
      this.pet.mode = isLost ? 'LOST_DOG' : 'NORMAL';
      this.platform.log.info(`Set ${this.pet.name} Lost Dog Mode to ${isLost ? 'On' : 'Off'}`);
    } catch (error) {
      this.platform.log.error(`Failed to set Lost Dog Mode for ${this.pet.name}:`, error);
      throw new this.platform.homebridgeApi.hap.HapStatusError(this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
