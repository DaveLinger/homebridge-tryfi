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
import { TryFiPlatformConfig, TryFiPet } from './types';

/**
 * TryFi Platform Plugin
 */
export class TryFiPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly config: TryFiPlatformConfig;
  public readonly accessories: PlatformAccessory[] = [];
  public readonly collarAccessories: Map<string, TryFiCollarAccessory> = new Map();

  public readonly tryfiApi: TryFiAPI;
  public readonly api: TryFiAPI; // Alias for accessory use
  private pollingInterval?: NodeJS.Timeout;
  
  // Escape alert hysteresis tracking (in-memory only, resets on restart)
  private escapeCounters: Map<string, number> = new Map();
  private quickCheckTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly homebridgeApi: API,
  ) {
    this.Service = this.homebridgeApi.hap.Service;
    this.Characteristic = this.homebridgeApi.hap.Characteristic;

    // Cast config to our platform config type
    this.config = config as TryFiPlatformConfig;

    // Validate config
    if (!this.config.username || !this.config.password) {
      this.log.error('TryFi username and password are required in config');
      throw new Error('Missing required config');
    }

    // Create API client
    this.tryfiApi = new TryFiAPI(this.config.username, this.config.password, log);
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
    } catch (error: any) {
      // Handle different error types during discovery
      if (error.response?.status) {
        const status = error.response.status;
        
        // Transient server errors - warn and start polling anyway (will retry)
        if (status === 502 || status === 503 || status === 504) {
          this.log.warn(`TryFi API temporarily unavailable (${status}) during startup`);
          this.log.warn('Will continue to retry during polling');
          this.startPolling(); // Start polling anyway, will retry
          return;
        }
        
        // Authentication errors
        if (status === 401 || status === 403) {
          this.log.error('Authentication failed - please check your username and password');
          return;
        }
        
        this.log.error(`Failed to discover TryFi devices (HTTP ${status}):`, error.message);
      } else {
        this.log.error('Failed to discover TryFi devices:', error.message || error);
      }
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
          
          // Handle escape alert hysteresis
          this.handleEscapeDetection(pet);
        }
      }

      this.log.debug(`Updated ${pets.length} collar(s)`);
    } catch (error: any) {
      // Handle different error types appropriately
      if (error.response?.status) {
        const status = error.response.status;
        
        // Transient server errors (502, 503, 504) - just warn and retry next interval
        if (status === 502 || status === 503 || status === 504) {
          this.log.warn(`TryFi API temporarily unavailable (${status}), will retry on next poll`);
          return;
        }
        
        // Authentication errors (401, 403) - try to re-authenticate
        if (status === 401 || status === 403) {
          this.log.warn('Authentication expired, attempting to re-login...');
          try {
            await this.tryfiApi.login();
            this.log.info('Successfully re-authenticated with TryFi');
            // Try polling again immediately after re-auth
            const allPets = await this.tryfiApi.getPets();
            const ignoredPets = (this.config.ignoredPets || []).map(name => name.toLowerCase());
            const pets = allPets.filter(pet => !ignoredPets.includes(pet.name.toLowerCase()));
            for (const pet of pets) {
              const accessory = this.collarAccessories.get(pet.petId);
              if (accessory) {
                accessory.updatePetData(pet);
                this.handleEscapeDetection(pet);
              }
            }
            this.log.debug(`Updated ${pets.length} collar(s) after re-auth`);
          } catch (reAuthError) {
            this.log.error('Failed to re-authenticate with TryFi:', reAuthError);
          }
          return;
        }
        
        // Other HTTP errors
        this.log.error(`TryFi API error (${status}):`, error.message);
      } else {
        // Network errors, timeouts, etc.
        this.log.error('Failed to poll TryFi API:', error.message || error);
      }
    }
  }

  /**
   * Handle escape detection with hysteresis (debouncing)
   * Prevents false alarms from GPS drift by requiring multiple consecutive detections
   */
  private handleEscapeDetection(pet: TryFiPet) {
    // Check if pet is escaped (out of zone AND not with anyone)
    const isEscaped = (pet.placeName === null && pet.connectedToUser === null);
    
    const currentCount = this.escapeCounters.get(pet.petId) || 0;
    const confirmationsRequired = this.config.escapeConfirmations || 2;
    
    if (isEscaped) {
      // Potential escape detected - increment counter
      const newCount = currentCount + 1;
      this.escapeCounters.set(pet.petId, newCount);
      
      this.log.debug(
        `${pet.name} out of zone (${newCount}/${confirmationsRequired} confirmations)`,
      );
      
      if (newCount >= confirmationsRequired) {
        // Threshold reached - escape confirmed
        // Accessory will handle the actual alert state update
        this.log.info(`${pet.name} escape confirmed after ${newCount} check(s)`);
      } else {
        // Not confirmed yet - schedule quick re-check
        this.scheduleQuickCheck(pet.petId, pet.name);
      }
    } else {
      // Pet is safe (in zone OR with someone) - reset counter
      const hadCount = currentCount > 0;
      this.escapeCounters.set(pet.petId, 0);
      this.cancelQuickCheck(pet.petId);
      
      if (hadCount) {
        this.log.debug(`${pet.name} back in safe state, reset escape counter`);
      }
    }
  }

  /**
   * Schedule a quick check for a specific pet
   * Used during escape detection to re-verify faster than normal polling
   */
  private scheduleQuickCheck(petId: string, petName: string) {
    // Don't schedule if already scheduled
    if (this.quickCheckTimeouts.has(petId)) {
      return;
    }
    
    const interval = (this.config.escapeCheckInterval || 30) * 1000;
    
    this.log.debug(`Scheduling quick check for ${petName} in ${interval / 1000}s`);
    
    const timeout = setTimeout(async () => {
      this.log.debug(`Running quick check for ${petName}`);
      
      // Remove from timeouts map
      this.quickCheckTimeouts.delete(petId);
      
      // Poll just this one pet
      try {
        const allPets = await this.tryfiApi.getPets();
        const pet = allPets.find(p => p.petId === petId);
        
        if (pet) {
          const accessory = this.collarAccessories.get(petId);
          if (accessory) {
            accessory.updatePetData(pet);
            
            // Handle escape detection (may schedule another quick check)
            this.handleEscapeDetection(pet);
          }
        }
      } catch (error: any) {
        this.log.warn(`Quick check failed for ${petName}:`, error.message || error);
        // Counter will remain, next normal poll will try again
      }
    }, interval);
    
    this.quickCheckTimeouts.set(petId, timeout);
  }

  /**
   * Cancel any pending quick check for a pet
   */
  private cancelQuickCheck(petId: string) {
    const timeout = this.quickCheckTimeouts.get(petId);
    if (timeout) {
      clearTimeout(timeout);
      this.quickCheckTimeouts.delete(petId);
    }
  }

  /**
   * Stop polling when platform is shutting down
   */
  shutdown() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    // Cancel all pending quick checks
    for (const timeout of this.quickCheckTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.quickCheckTimeouts.clear();
  }
}
