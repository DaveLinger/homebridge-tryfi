import axios, { AxiosInstance } from 'axios';
import { Logger } from 'homebridge';
import {
  TryFiSession,
  TryFiPet,
  GraphQLResponse,
  LoginResponse,
  PetsResponse,
} from './types';

/**
 * TryFi GraphQL API Client
 */
export class TryFiAPI {
  private readonly apiUrl = 'https://graph.tryfi.com/graphql';
  private readonly client: AxiosInstance;
  private session: TryFiSession | null = null;

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly log: Logger,
  ) {
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Login to TryFi and obtain session token
   */
  async login(): Promise<void> {
    const query = `
      mutation Login($email: String!, $password: String!) {
        login(email: $email, password: $password) {
          userId
          token
        }
      }
    `;

    try {
      const response = await this.client.post<GraphQLResponse<LoginResponse>>('', {
        query,
        variables: {
          email: this.username,
          password: this.password,
        },
      });

      if (response.data.errors) {
        throw new Error(`Login failed: ${response.data.errors[0].message}`);
      }

      if (!response.data.data?.login) {
        throw new Error('Login failed: No session data returned');
      }

      this.session = {
        userId: response.data.data.login.userId,
        token: response.data.data.login.token,
      };

      this.log.info('Successfully authenticated with TryFi');
    } catch (error) {
      this.log.error('Failed to login to TryFi:', error);
      throw error;
    }
  }

  /**
   * Get all pets for the authenticated user
   */
  async getPets(): Promise<TryFiPet[]> {
    await this.ensureAuthenticated();

    const query = `
      query GetPets($userId: ID!) {
        user(userId: $userId) {
          households {
            pets {
              petId
              name
              breed
              photoLink
              device {
                deviceId
                batteryPercent
                isCharging
                ledOn
                isLost
                buildId
              }
              currLatitude
              currLongitude
              currPlaceName
              currPlaceAddress
              areaName
              connectedTo
              lastUpdated
            }
          }
        }
      }
    `;

    try {
      const response = await this.client.post<GraphQLResponse<PetsResponse>>(
        '',
        {
          query,
          variables: {
            userId: this.session!.userId,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.session!.token}`,
          },
        },
      );

      if (response.data.errors) {
        throw new Error(`Failed to get pets: ${response.data.errors[0].message}`);
      }

      if (!response.data.data?.user?.households) {
        return [];
      }

      // Flatten pets from all households
      const pets: TryFiPet[] = [];
      for (const household of response.data.data.user.households) {
        pets.push(...household.pets);
      }

      this.log.debug(`Retrieved ${pets.length} pet(s) from TryFi`);
      return pets;
    } catch (error) {
      this.log.error('Failed to get pets:', error);
      throw error;
    }
  }

  /**
   * Set LED light on/off
   */
  async setLedState(petId: string, state: boolean): Promise<void> {
    await this.ensureAuthenticated();

    const mutation = `
      mutation SetLed($petId: ID!, $state: Boolean!) {
        setLedState(petId: $petId, on: $state) {
          success
        }
      }
    `;

    try {
      const response = await this.client.post(
        '',
        {
          query: mutation,
          variables: {
            petId,
            state,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.session!.token}`,
          },
        },
      );

      if (response.data.errors) {
        throw new Error(`Failed to set LED: ${response.data.errors[0].message}`);
      }

      this.log.debug(`Set LED ${state ? 'on' : 'off'} for pet ${petId}`);
    } catch (error) {
      this.log.error('Failed to set LED state:', error);
      throw error;
    }
  }

  /**
   * Set Lost Dog Mode
   */
  async setLostDogMode(petId: string, isLost: boolean): Promise<void> {
    await this.ensureAuthenticated();

    const mutation = `
      mutation SetLostMode($petId: ID!, $isLost: Boolean!) {
        setLostDogMode(petId: $petId, isLost: $isLost) {
          success
        }
      }
    `;

    try {
      const response = await this.client.post(
        '',
        {
          query: mutation,
          variables: {
            petId,
            isLost,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.session!.token}`,
          },
        },
      );

      if (response.data.errors) {
        throw new Error(`Failed to set lost mode: ${response.data.errors[0].message}`);
      }

      this.log.info(`Set Lost Dog Mode ${isLost ? 'ON' : 'OFF'} for pet ${petId}`);
    } catch (error) {
      this.log.error('Failed to set lost dog mode:', error);
      throw error;
    }
  }

  /**
   * Ensure we have a valid session, login if needed
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.session) {
      await this.login();
    }
  }
}
