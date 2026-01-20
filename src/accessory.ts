import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { TryFiPlatform } from './platform';
import { TryFiPet } from './types';

/**
 * TryFi Collar Accessory
 * Represents a single dog's collar with multiple HomeKit services
 */
export class TryFiCollarAccessory {
  private batteryService: Service;
  private lightService: Service;
  private lostModeSwitch: Service;
  private escapeAlertService: Service;

  constructor(
    private readonly platform: TryFiPlatform,
    private readonly accessory: PlatformAccessory,
    private pet: TryFiPet,
  ) {
    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'TryFi')
      .setCharacteristic(this.platform.Characteristic.Model, pet.breed || 'GPS Collar')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, pet.device.deviceId)
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        pet.device.buildId || '1.0.0',
      );

    // Battery Service
    this.batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

    this.batteryService.setCharacteristic(
      this.platform.Characteristic.Name,
      `${pet.name} Battery`,
    );

    this.batteryService
      .getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService
      .getCharacteristic(this.platform.Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this));

    this.batteryService
      .getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.getLowBatteryStatus.bind(this));

    // LED Light Service
    this.lightService =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb);

    this.lightService.setCharacteristic(
      this.platform.Characteristic.Name,
      `${pet.name} Light`,
    );

    this.lightService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getLightState.bind(this))
      .onSet(this.setLightState.bind(this));

    // Lost Dog Mode Switch
    this.lostModeSwitch =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch);

    this.lostModeSwitch.setCharacteristic(
      this.platform.Characteristic.Name,
      `${pet.name} Lost Mode`,
    );

    this.lostModeSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getLostModeState.bind(this))
      .onSet(this.setLostModeState.bind(this));

    // Escape Alert Service (Leak Sensor or Motion Sensor based on config)
    const escapeAlertType = this.platform.config.escapeAlertType || 'leak';
    
    if (escapeAlertType === 'motion') {
      this.escapeAlertService =
        this.accessory.getService(this.platform.Service.MotionSensor) ||
        this.accessory.addService(this.platform.Service.MotionSensor);

      this.escapeAlertService.setCharacteristic(
        this.platform.Characteristic.Name,
        `${pet.name} Escape Alert`,
      );

      this.escapeAlertService
        .getCharacteristic(this.platform.Characteristic.MotionDetected)
        .onGet(this.getEscapeAlertState.bind(this));
    } else {
      // Default to leak sensor
      this.escapeAlertService =
        this.accessory.getService(this.platform.Service.LeakSensor) ||
        this.accessory.addService(this.platform.Service.LeakSensor);

      this.escapeAlertService.setCharacteristic(
        this.platform.Characteristic.Name,
        `${pet.name} Escape Alert`,
      );

      this.escapeAlertService
        .getCharacteristic(this.platform.Characteristic.LeakDetected)
        .onGet(this.getEscapeAlertState.bind(this));
    }
  }

  /**
   * Update the accessory with fresh pet data
   */
  updatePet(pet: TryFiPet): void {
    this.pet = pet;

    // Update all characteristic values
    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.BatteryLevel,
      this.pet.device.batteryPercent,
    );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.ChargingState,
      this.pet.device.isCharging
        ? this.platform.Characteristic.ChargingState.CHARGING
        : this.platform.Characteristic.ChargingState.NOT_CHARGING,
    );

    this.batteryService.updateCharacteristic(
      this.platform.Characteristic.StatusLowBattery,
      this.pet.device.batteryPercent < 20
        ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
    );

    this.lightService.updateCharacteristic(
      this.platform.Characteristic.On,
      this.pet.device.ledOn,
    );

    this.lostModeSwitch.updateCharacteristic(
      this.platform.Characteristic.On,
      this.pet.device.isLost,
    );

    // Update escape alert
    const isEscaping = this.calculateEscapeAlert();
    const escapeAlertType = this.platform.config.escapeAlertType || 'leak';
    
    if (escapeAlertType === 'motion') {
      this.escapeAlertService.updateCharacteristic(
        this.platform.Characteristic.MotionDetected,
        isEscaping,
      );
    } else {
      this.escapeAlertService.updateCharacteristic(
        this.platform.Characteristic.LeakDetected,
        isEscaping
          ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      );
    }
  }

  /**
   * Calculate if dog is escaping (outside safe zone AND alone)
   */
  private calculateEscapeAlert(): boolean {
    const isInSafeZone = this.pet.currPlaceName !== null;
    const isWithOwner = this.pet.connectedTo !== null;
    const isEscaping = !isInSafeZone && !isWithOwner;

    if (isEscaping) {
      this.platform.log.warn(
        `🚨 ESCAPE ALERT: ${this.pet.name} is outside safe zones and alone!`,
      );
    }

    return isEscaping;
  }

  /**
   * Get battery level (0-100)
   */
  async getBatteryLevel(): Promise<CharacteristicValue> {
    return this.pet.device.batteryPercent;
  }

  /**
   * Get charging state
   */
  async getChargingState(): Promise<CharacteristicValue> {
    return this.pet.device.isCharging
      ? this.platform.Characteristic.ChargingState.CHARGING
      : this.platform.Characteristic.ChargingState.NOT_CHARGING;
  }

  /**
   * Get low battery status
   */
  async getLowBatteryStatus(): Promise<CharacteristicValue> {
    return this.pet.device.batteryPercent < 20
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
  }

  /**
   * Get LED light state
   */
  async getLightState(): Promise<CharacteristicValue> {
    return this.pet.device.ledOn;
  }

  /**
   * Set LED light state
   */
  async setLightState(value: CharacteristicValue): Promise<void> {
    const state = value as boolean;
    try {
      await this.platform.tryfiApi.setLedState(this.pet.petId, state);
      this.pet.device.ledOn = state;
      this.platform.log.info(`Set ${this.pet.name} LED to ${state ? 'ON' : 'OFF'}`);
    } catch (error) {
      this.platform.log.error(`Failed to set LED for ${this.pet.name}:`, error);
      throw new this.platform.homebridgeApi.hap.HapStatusError(
        this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  /**
   * Get Lost Dog Mode state
   */
  async getLostModeState(): Promise<CharacteristicValue> {
    return this.pet.device.isLost;
  }

  /**
   * Set Lost Dog Mode state
   */
  async setLostModeState(value: CharacteristicValue): Promise<void> {
    const isLost = value as boolean;
    try {
      await this.platform.tryfiApi.setLostDogMode(this.pet.petId, isLost);
      this.pet.device.isLost = isLost;
      this.platform.log.info(
        `Set ${this.pet.name} Lost Dog Mode to ${isLost ? 'ON' : 'OFF'}`,
      );
    } catch (error) {
      this.platform.log.error(`Failed to set Lost Dog Mode for ${this.pet.name}:`, error);
      throw new this.platform.homebridgeApi.hap.HapStatusError(
        this.platform.homebridgeApi.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  /**
   * Get Escape Alert state (for both leak sensor and motion sensor)
   */
  async getEscapeAlertState(): Promise<CharacteristicValue> {
    const isEscaping = this.calculateEscapeAlert();
    const escapeAlertType = this.platform.config.escapeAlertType || 'leak';
    
    if (escapeAlertType === 'motion') {
      return isEscaping;
    } else {
      return isEscaping
        ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
        : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
    }
  }
}
