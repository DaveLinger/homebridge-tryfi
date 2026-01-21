import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { TryFiAPI } from './api';
import { TryFiCollarAccessory } from './accessory';
import { TryFiPlatformConfig } from './types';

/**
 * TryFi Platform Plugin
 */
export class TryFiPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly collarAccessories: Map<string, TryFiCollarAccessory> = new Map();

  public readonly tryfiApi: TryFiAPI;
  public readonly api: TryFiAPI; // Alias for accessory use
  private pollingInterval?: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    public readonly config: TryFiPlatformConfig,
    public readonly homebridgeApi: API,
  ) {
    this.Service = this.homebridgeApi.hap.Service;
    this.Characteristic = this.homebridgeApi.hap.Characteristic;

    // Validate config
    if (!config.username || !config.password) {
      this.log.error('TryFi username and password are required in config');
      throw new Error('Missing required config');
    }

    // Create API client
    this.tryfiApi = new TryFiAPI(config.username, config.password, log);
    this.api = this.tryfiApi; // Alias for accessory use

    this.log.debug('Finished initializing platform:', config.name);

    // When this event is fired it means Homebridge has restored all cached accessories
    this.homebridgeApi.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Discover TryFi collars and create accessories
   */
  async discoverDevices() {
    try {
      // Login and get pets
      await this.tryfiApi.login();
      const allPets = await this.tryfiApi.getPets();

      // Filter out ignored pets (case-insensitive)
      const ignoredPets = (this.config.ignoredPets || []).map(name => name.toLowerCase());
      const pets = allPets.filter(pet => !ignoredPets.includes(pet.name.toLowerCase()));

      if (ignoredPets.length > 0) {
        const ignoredCount = allPets.length - pets.length;
        if (ignoredCount > 0) {
          this.log.info(`Ignoring ${ignoredCount} pet(s) based on configuration`);
        }
      }

      this.log.info(`Discovered ${pets.length} TryFi collar(s)`);

      // Track discovered pet IDs
      const discoveredPetIds = new Set<string>();

      for (const pet of pets) {
        discoveredPetIds.add(pet.petId);

        // Generate unique ID for this accessory
        const uuid = this.homebridgeApi.hap.uuid.generate(pet.petId);

        // Check if accessory already exists
        const existingAccessory = this.accessories.find(
          (accessory) => accessory.UUID === uuid,
        );

        if (existingAccessory) {
          // Restore existing accessory
          this.log.info('Restoring existing accessory from cache:', pet.name);
          existingAccessory.context.pet = pet;

          // Create collar accessory handler
          const collarAccessory = new TryFiCollarAccessory(
            this,
            existingAccessory,
            pet,
          );
          this.collarAccessories.set(pet.petId, collarAccessory);

          // Update reachability
          this.homebridgeApi.updatePlatformAccessories([existingAccessory]);
        } else {
          // Create new accessory
          this.log.info('Adding new accessory:', pet.name);

          const accessory = new this.homebridgeApi.platformAccessory(pet.name, uuid);
          accessory.context.pet = pet;

          // Create collar accessory handler
          const collarAccessory = new TryFiCollarAccessory(this, accessory, pet);
          this.collarAccessories.set(pet.petId, collarAccessory);

          // Register new accessory
          this.homebridgeApi.registerPlatformAccessories('homebridge-tryfi', 'TryFi', [
            accessory,
          ]);
          this.accessories.push(accessory);
        }
      }

      // Remove accessories for pets that no longer exist
      const accessoriesToRemove = this.accessories.filter(
        (accessory) => !discoveredPetIds.has(accessory.context.pet?.petId),
      );

      if (accessoriesToRemove.length > 0) {
        this.log.info(
          `Removing ${accessoriesToRemove.length} accessory(ies) for deleted pets`,
        );
        this.homebridgeApi.unregisterPlatformAccessories(
          'homebridge-tryfi',
          'TryFi',
          accessoriesToRemove,
        );

        // Remove from our tracking
        for (const accessory of accessoriesToRemove) {
          const index = this.accessories.indexOf(accessory);
          if (index > -1) {
            this.accessories.splice(index, 1);
          }
          this.collarAccessories.delete(accessory.context.pet?.petId);
        }
      }

      // Start polling for updates
      this.startPolling();
    } catch (error) {
      this.log.error('Failed to discover TryFi devices:', error);
    }
  }

  /**
   * Start polling TryFi API for updates
   */
  private startPolling() {
    const pollingInterval = (this.config.pollingInterval || 60) * 1000;
    this.log.info(`Starting polling every ${pollingInterval / 1000} seconds`);

    // Clear any existing interval
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Poll immediately, then at intervals
    this.pollDevices();
    this.pollingInterval = setInterval(() => {
      this.pollDevices();
    }, pollingInterval);
  }

  /**
   * Poll TryFi API for device updates
   */
  private async pollDevices() {
    try {
      const allPets = await this.tryfiApi.getPets();

      // Filter out ignored pets (case-insensitive)
      const ignoredPets = (this.config.ignoredPets || []).map(name => name.toLowerCase());
      const pets = allPets.filter(pet => !ignoredPets.includes(pet.name.toLowerCase()));

      for (const pet of pets) {
        const accessory = this.collarAccessories.get(pet.petId);
        if (accessory) {
          accessory.updatePetData(pet);
        }
      }

      this.log.debug(`Updated ${pets.length} collar(s)`);
    } catch (error) {
      this.log.error('Failed to poll TryFi API:', error);
    }
  }

  /**
   * Stop polling when platform is shutting down
   */
  shutdown() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
  }
}
