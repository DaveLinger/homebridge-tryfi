import axios, { AxiosInstance } from 'axios';
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
  private session: TryFiSession | null = null;

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
    });
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
            const isCharging = deviceInfo.isCharging || false;

            // Get location data for this pet
            const location = await this.getPetLocation(pet.id);

            // Determine connection status
            const connectionState = pet.device.lastConnectionState;
            const isCharging2 = connectionState?.__typename === 'ConnectedToBase';
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
              isCharging: isCharging || isCharging2,
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

      return { latitude, longitude, areaName, placeName, placeAddress };
    } catch (error) {
      this.log.warn(`Failed to get location for pet ${petId}:`, error);
      return {
        latitude: 0,
        longitude: 0,
        areaName: null,
        placeName: null,
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
