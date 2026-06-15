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

// Network error codes that indicate a temporary outage (DNS hiccup, dropped
// connection, etc.) rather than a real problem with the request itself.
const TRANSIENT_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNABORTED',
]);

/**
 * True if the error represents a transient outage (DNS failure, dropped
 * connection, or a 502/503/504 from TryFi's load balancer) that's expected
 * to resolve on its own and shouldn't be logged as a hard error.
 */
export function isTransientError(error: any): boolean {
  if (error?.code && TRANSIENT_ERROR_CODES.has(error.code)) {
    return true;
  }
  const status = error?.response?.status;
  return status === 502 || status === 503 || status === 504;
}

/**
 * Produce a short, human-readable description of an error for logging,
 * avoiding the huge circular AxiosError dump that results from logging
 * the error object directly.
 */
export function describeError(error: any): string {
  if (error?.code === 'EAI_AGAIN' || error?.code === 'ENOTFOUND') {
    return `DNS lookup failed (${error.code}: ${error.hostname || 'api.tryfi.com'})`;
  }
  if (error?.response?.status) {
    return `HTTP ${error.response.status}${error.response.statusText ? ` ${error.response.statusText}` : ''}`;
  }
  if (error?.code) {
    return `${error.code}: ${error.message}`;
  }
  return error?.message || String(error);
}

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
            const ONLINE_TYPES = ['ConnectedToUser', 'ConnectedToBase', 'ConnectedToCellular'];
            const isOnline = ONLINE_TYPES.includes(connectionState?.__typename || '');
            const lastSeenDate = connectionState?.date ? new Date(connectionState.date) : null;

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
              isOnline,
              lastSeenDate,
              ...location,
            });
          }
        }
      }

      this.log.debug(`Retrieved ${pets.length} pet(s) from TryFi`);
      return pets;
    } catch (error: any) {
      if (isTransientError(error)) {
        this.log.debug(`Failed to get pets (${describeError(error)})`);
      } else {
        this.log.error(`Failed to get pets: ${describeError(error)}`);
      }
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
    locationUnknown: boolean;
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
        return this.locationFallback(petId);
      }

      const activity = response.data.data?.pet?.ongoingActivity;

      let latitude = 0;
      let longitude = 0;
      let areaName: string | null = null;
      let placeName: string | null = null;
      let placeAddress: string | null = null;

      if (activity) {
        areaName = activity.areaName || null;

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
      }

      const locationData = { latitude, longitude, areaName, placeName, placeAddress };

      // Cache this successful location data
      this.locationCache.set(petId, locationData);

      return { ...locationData, locationUnknown: false };
    } catch (error: any) {
      // Handle different error types for location queries
      if (isTransientError(error)) {
        // Transient network/server errors - expected to resolve on their own
        this.log.debug(`Location query failed for pet ${petId} (${describeError(error)}), using cached/default location`);
      } else {
        // Other errors - log a short message only, not the full error object
        this.log.warn(`Failed to get location for pet ${petId}: ${describeError(error)}`);
      }

      return this.locationFallback(petId);
    }
  }

  /**
   * Fallback location data when a location query fails or returns errors.
   * Returns the last known good location if available (with locationUnknown:
   * false, since that data is still meaningful), or safe zeroed defaults with
   * locationUnknown: true when nothing is cached yet - so callers know not to
   * treat placeName: null as a real "out of zone" reading.
   */
  private locationFallback(petId: string): {
    latitude: number;
    longitude: number;
    areaName: string | null;
    placeName: string | null;
    placeAddress: string | null;
    locationUnknown: boolean;
  } {
    const cached = this.locationCache.get(petId);
    if (cached) {
      this.log.debug(`Using cached location for pet ${petId}`);
      return { ...cached, locationUnknown: false };
    }

    return {
      latitude: 0,
      longitude: 0,
      areaName: null,
      placeName: null,
      placeAddress: null,
      locationUnknown: true,
    };
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
