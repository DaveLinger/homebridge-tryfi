import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Logger } from 'homebridge';
import {
  TryFiSession,
  TryFiPet,
  GraphQLResponse,
  CurrentUserResponse,
} from './types';

/**
 * TryFi API Client - matches pytryfi implementation exactly
 */
export class TryFiAPI {
  private readonly apiUrl = 'https://api.tryfi.com';
  private readonly client: AxiosInstance;
  private readonly jar: CookieJar;
  private session: TryFiSession | null = null;
  
  // Cache last known good location data to avoid false escape alerts on timeouts
  private locationCache: Map<string, {
    latitude: number;
    longitude: number;
    areaName: string | null;
    placeName: string | null;
    placeAddress: string | null;
  }> = new Map();

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {
    // Create cookie jar to persist cookies like Python requests.Session()
    this.jar = new CookieJar();
    
    // Wrap axios with cookie jar support
    this.client = wrapper(axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
      jar: this.jar,
      withCredentials: true,
    }));
  }

  /**
   * Login using REST API (matches pytryfi)
   */
  async login(): Promise<void> {
    try {
      const formData = new URLSearchParams();
      formData.append('email', this.username);
      formData.append('password', this.password);

      const response = await this.client.post('/auth/login', formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (response.data.error) {
        throw new Error(`Login failed: ${response.data.error.message}`);
      }

      if (!response.data.userId || !response.data.sessionId) {
        throw new Error('Login failed: No session data returned');
      }

      this.session = {
        userId: response.data.userId,
        sessionId: response.data.sessionId,
      };

      // Set JSON header for subsequent GraphQL requests (matches pytryfi.setHeaders())
      this.client.defaults.headers.common['Content-Type'] = 'application/json';

      this.log.info('Successfully authenticated with TryFi');
    } catch (error) {
      this.log.error('Failed to login to TryFi:', error);
      throw error;
    }
  }

  /**
   * Get all pets using EXACT pytryfi query structure
   */
  async getPets(): Promise<TryFiPet[]> {
    await this.ensureAuthenticated();

    // This matches pytryfi's QUERY_CURRENT_USER_FULL_DETAIL + fragments
    const query = `
      query {
        currentUser {
          __typename
          id
          email
          firstName
          lastName
          userHouseholds {
            __typename
            household {
              __typename
              pets {
                __typename
                id
                name
                homeCityState
                gender
                breed {
                  __typename
                  id
                  name
                }
                device {
                  __typename
                  id
                  moduleId
                  info
                  operationParams {
                    __typename
                    mode
                    ledEnabled
                    ledOffAt
                  }
                  lastConnectionState {
                    __typename
                    date
                    ... on ConnectedToUser {
                      user {
                        __typename
                        id
                        firstName
                        lastName
                      }
                    }
                    ... on ConnectedToBase {
                      chargingBase {
                        __typename
                        id
                      }
                    }
                    ... on ConnectedToCellular {
                      signalStrengthPercent
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.client.post<GraphQLResponse<CurrentUserResponse>>(
        '/graphql',
        { query },
      );

      if (response.data.errors) {
        throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
      }

      if (!response.data.data?.currentUser?.userHouseholds) {
        return [];
      }

      // Flatten pets from all households
      const pets: TryFiPet[] = [];
      for (const userHousehold of response.data.data.currentUser.userHouseholds) {
        if (userHousehold.household?.pets) {
          for (const pet of userHousehold.household.pets) {
            if (!pet.device) {
              this.log.warn(`Pet ${pet.name} has no device, skipping`);
              continue;
            }

            // Parse device info JSON object
            const deviceInfo = pet.device.info || {};
            const batteryPercent = parseInt(deviceInfo.batteryPercent) || 0;
            
            // Detect charging from battery chip data
            // batteryAverageCurrentMa > 0 means current flowing INTO battery (charging)
            // batteryAverageCurrentMa < 0 means current flowing OUT (discharging)
            // bq27421Info is null when collar is not on charger
            const bq27421Info = deviceInfo.bq27421Info;
            const isCharging = (bq27421Info?.batteryAverageCurrentMa ?? 0) > 0;

            // Get location data for this pet
            const location = await this.getPetLocation(pet.id);

            // Determine connection status
            const connectionState = pet.device.lastConnectionState;
            const connectedToUser = 
              connectionState?.__typename === 'ConnectedToUser'
                ? (connectionState as any).user?.firstName || null
                : null;

            pets.push({
              petId: pet.id,
              name: pet.name,
              breed: pet.breed?.name || 'Unknown',
              moduleId: pet.device.moduleId,
              batteryPercent,
              isCharging,
              ledEnabled: pet.device.operationParams?.ledEnabled || false,
              mode: pet.device.operationParams?.mode || 'NORMAL',
              connectedToUser,
              ...location,
            });
          }
        }
      }

      this.log.debug(`Retrieved ${pets.length} pet(s) from TryFi`);
      return pets;
    } catch (error) {
      this.log.error('Failed to get pets:', error);
      throw error;
    }
  }

  /**
   * Get pet location - matches pytryfi's getCurrentPetLocation
   * Returns cached data on timeout/error to prevent false escape alerts
   */
  private async getPetLocation(petId: string): Promise<{
    latitude: number;
    longitude: number;
    areaName: string | null;
    placeName: string | null;
    placeAddress: string | null;
  }> {
    const query = `
      query {
        pet(id: "${petId}") {
          ongoingActivity {
            __typename
            start
            areaName
            ... on OngoingWalk {
              positions {
                __typename
                date
                position {
                  __typename
                  latitude
                  longitude
                }
              }
            }
            ... on OngoingRest {
              position {
                __typename
                latitude
                longitude
              }
              place {
                __typename
                id
                name
                address
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.client.post<GraphQLResponse<any>>(
        '/graphql',
        { query },
      );

      if (response.data.errors) {
        this.log.warn(`Failed to get location for pet ${petId}:`, response.data.errors[0].message);
        return {
          latitude: 0,
          longitude: 0,
          areaName: null,
          placeName: null,
          placeAddress: null,
        };
      }

      const activity = response.data.data?.pet?.ongoingActivity;
      if (!activity) {
        return {
          latitude: 0,
          longitude: 0,
          areaName: null,
          placeName: null,
          placeAddress: null,
        };
      }

      const areaName = activity.areaName || null;
      let latitude = 0;
      let longitude = 0;
      let placeName = null;
      let placeAddress = null;

      if (activity.__typename === 'OngoingRest') {
        latitude = activity.position?.latitude || 0;
        longitude = activity.position?.longitude || 0;
        placeName = activity.place?.name || null;
        placeAddress = activity.place?.address || null;
      } else if (activity.__typename === 'OngoingWalk' && activity.positions?.length > 0) {
        const lastPosition = activity.positions[activity.positions.length - 1];
        latitude = lastPosition.position?.latitude || 0;
        longitude = lastPosition.position?.longitude || 0;
      }

      const locationData = { latitude, longitude, areaName, placeName, placeAddress };
      
      // Cache this successful location data
      this.locationCache.set(petId, locationData);
      
      return locationData;
    } catch (error: any) {
      // Handle different error types for location queries
      if (error.code === 'ECONNABORTED') {
        // Timeout errors - common when TryFi API is slow
        this.log.debug(`Location query timed out for pet ${petId}, using cached/default location`);
      } else if (error.response?.status) {
        const status = error.response.status;
        // Transient server errors
        if (status === 502 || status === 503 || status === 504) {
          this.log.debug(`Location API temporarily unavailable for pet ${petId} (${status})`);
        } else {
          this.log.warn(`Failed to get location for pet ${petId} (HTTP ${status})`);
        }
      } else {
        // Other errors - log message only, not full error object
        this.log.warn(`Failed to get location for pet ${petId}: ${error.message || 'Unknown error'}`);
      }
      
      // Return cached data if available, otherwise return safe defaults
      // IMPORTANT: Using cached placeName prevents false escape alerts on timeouts
      const cached = this.locationCache.get(petId);
      if (cached) {
        this.log.debug(`Using cached location for pet ${petId}`);
        return cached;
      }
      
      // No cache available - return defaults (first time seeing this pet)
      return {
        latitude: 0,
        longitude: 0,
        areaName: null,
        placeName: null,  // null is safe here - no previous data to rely on
        placeAddress: null,
      };
    }
  }

  /**
   * Set LED on/off - matches pytryfi's turnOnOffLed
   */
  async setLedState(moduleId: string, ledEnabled: boolean): Promise<void> {
    await this.ensureAuthenticated();

    const mutation = `
      mutation UpdateDeviceOperationParams($input: UpdateDeviceOperationParamsInput!) {
        updateDeviceOperationParams(input: $input) {
          __typename
          id
          moduleId
          operationParams {
            __typename
            mode
            ledEnabled
            ledOffAt
          }
        }
      }
    `;

    try {
      const response = await this.client.post('/graphql', {
        query: mutation,
        variables: {
          input: {
            moduleId,
            ledEnabled,
          },
        },
      });

      if (response.data.errors) {
        throw new Error(`Failed to set LED: ${response.data.errors[0].message}`);
      }

      this.log.debug(`Set LED ${ledEnabled ? 'on' : 'off'} for module ${moduleId}`);
    } catch (error) {
      this.log.error('Failed to set LED state:', error);
      throw error;
    }
  }

  /**
   * Set Lost Dog Mode - matches pytryfi's setLostDogMode
   */
  async setLostDogMode(moduleId: string, isLost: boolean): Promise<void> {
    await this.ensureAuthenticated();

    const mode = isLost ? 'LOST_DOG' : 'NORMAL';

    const mutation = `
      mutation UpdateDeviceOperationParams($input: UpdateDeviceOperationParamsInput!) {
        updateDeviceOperationParams(input: $input) {
          __typename
          id
          moduleId
          operationParams {
            __typename
            mode
            ledEnabled
            ledOffAt
          }
        }
      }
    `;

    try {
      const response = await this.client.post('/graphql', {
        query: mutation,
        variables: {
          input: {
            moduleId,
            mode,
          },
        },
      });

      if (response.data.errors) {
        throw new Error(`Failed to set lost mode: ${response.data.errors[0].message}`);
      }

      this.log.info(`Set Lost Dog Mode ${isLost ? 'ON' : 'OFF'} for module ${moduleId}`);
    } catch (error) {
      this.log.error('Failed to set lost dog mode:', error);
      throw error;
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.session) {
      await this.login();
    }
  }
}
