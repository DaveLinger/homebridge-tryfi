import { PlatformConfig } from 'homebridge';

/**
 * TryFi Platform Configuration
 */
export interface TryFiPlatformConfig extends PlatformConfig {
  username: string;
  password: string;
  pollingInterval?: number; // seconds, default 60
  escapeAlertType?: 'leak' | 'motion'; // default 'leak'
}

/**
 * TryFi Session Information
 */
export interface TryFiSession {
  userId: string;
  token: string;
}

/**
 * TryFi Pet/Dog Data
 */
export interface TryFiPet {
  petId: string;
  name: string;
  breed: string;
  photoLink?: string;
  device: TryFiDevice;
  currLatitude: number;
  currLongitude: number;
  currPlaceName: string | null; // null when NOT in any safe zone
  currPlaceAddress: string | null;
  areaName: string | null;
  connectedTo: string | null; // null when alone, owner name when with someone
  lastUpdated?: string;
}

/**
 * TryFi Collar Device Data
 */
export interface TryFiDevice {
  deviceId: string;
  batteryPercent: number;
  isCharging: boolean;
  ledOn: boolean;
  isLost: boolean; // Lost Dog Mode status
  buildId?: string;
}

/**
 * GraphQL Response Wrapper
 */
export interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

/**
 * Login Mutation Response
 */
export interface LoginResponse {
  login: {
    userId: string;
    token: string;
  };
}

/**
 * Pets Query Response
 */
export interface PetsResponse {
  user: {
    households: Array<{
      pets: TryFiPet[];
    }>;
  };
}
