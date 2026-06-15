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
  offlineAlertMinutes?: number; // minutes offline before alerting, disabled if unset
  offlineAlertType?: 'leak' | 'motion'; // default 'motion'; blank/omitted disables offline alert
  apiUnreachableAlertMinutes?: number; // minutes of consecutive poll failures before raising StatusFault, default 5
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
  isOnline: boolean; // false when collar is not connected to phone, base, or cellular
  lastSeenDate: Date | null; // when the collar was last in any connected state
  latitude: number;
  longitude: number;
  areaName: string | null;
  placeName: string | null; // Safe zone name, null when not in safe zone
  placeAddress: string | null;
  // True when the location query failed and there's no cached location to fall
  // back on - placeName/areaName etc. are meaningless defaults, not real data.
  locationUnknown: boolean;
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
