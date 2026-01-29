import { PlatformConfig } from 'homebridge';

/**
 * TryFi Platform Configuration
 */
export interface TryFiPlatformConfig extends PlatformConfig {
  username: string;
  password: string;
  pollingInterval?: number; // seconds, default 60
  escapeAlertType?: 'leak' | 'motion'; // default 'leak'
  ignoredPets?: string[]; // pet names to ignore (case-insensitive)
  escapeConfirmations?: number; // consecutive out-of-zone readings required, default 2
  escapeCheckInterval?: number; // seconds between quick checks, default 30
}

/**
 * TryFi Session Information
 */
export interface TryFiSession {
  userId: string;
  sessionId: string;
}

/**
 * TryFi Pet Data (processed from API response)
 */
export interface TryFiPet {
  petId: string;
  name: string;
  breed: string;
  moduleId: string;
  batteryPercent: number;
  isCharging: boolean;
  ledEnabled: boolean;
  mode: string; // 'NORMAL' or 'LOST_DOG'
  connectedToUser: string | null; // firstName of user, null if not connected
  latitude: number;
  longitude: number;
  areaName: string | null;
  placeName: string | null; // Safe zone name, null when not in safe zone
  placeAddress: string | null;
}

/**
 * GraphQL Response Wrapper
 */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

/**
 * CurrentUser Query Response - matches pytryfi structure
 */
export interface CurrentUserResponse {
  currentUser: {
    __typename: string;
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    userHouseholds: Array<{
      __typename: string;
      household: {
        __typename: string;
        pets: Array<{
          __typename: string;
          id: string;
          name: string;
          homeCityState?: string;
          gender?: string;
          breed?: {
            __typename: string;
            id: string;
            name: string;
          };
          device?: {
            __typename: string;
            id: string;
            moduleId: string;
            info: any; // JSON object with batteryPercent, isCharging, etc.
            operationParams?: {
              __typename: string;
              mode: string;
              ledEnabled: boolean;
              ledOffAt?: string;
            };
            lastConnectionState?: {
              __typename: string;
              date: string;
            } | {
              __typename: 'ConnectedToUser';
              date: string;
              user: {
                __typename: string;
                id: string;
                firstName: string;
                lastName: string;
              };
            } | {
              __typename: 'ConnectedToBase';
              date: string;
              chargingBase: {
                __typename: string;
                id: string;
              };
            } | {
              __typename: 'ConnectedToCellular';
              date: string;
              signalStrengthPercent: number;
            };
          };
        }>;
      };
    }>;
  };
}
