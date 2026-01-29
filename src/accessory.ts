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
  
  // Track last escape state to avoid redundant HomeKit updates
  private lastEscapeState?: boolean;

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
    
    if (escapeAlertType === 'leak') {
      this.escapeAlertService = this.accessory.getService(this.platform.Service.LeakSensor) ||
        this.accessory.addService(this.platform.Service.LeakSensor);
      this.escapeAlertService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} Escape Alert`);
    } else {
      this.escapeAlertService = this.accessory.getService(this.platform.Service.MotionSensor) ||
        this.accessory.addService(this.platform.Service.MotionSensor);
      this.escapeAlertService.setCharacteristic(this.platform.Characteristic.Name, `${pet.name} Escape Alert`);
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
      
      this.lastEscapeState = isEscaped;
      
      // Log state changes
      if (isEscaped) {
        this.platform.log.warn(`🚨 ${this.pet.name} has ESCAPED!`);
      } else if (this.lastEscapeState === true) {
        // Only log "back safe" if was previously escaped
        this.platform.log.info(`✅ ${this.pet.name} is back in safe zone`);
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
