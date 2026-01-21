# V3 Changes - Copied EXACT pytryfi Implementation

## Why V3 Was Needed
Previous versions guessed at the GraphQL API structure. This version copies pytryfi's implementation exactly.

## Critical Changes from V2

### 1. REST Login (CORRECT)
- Endpoint: `POST /auth/login`
- Content-Type: `application/x-www-form-urlencoded`
- Body: `email=xxx&password=yyy` (form data, NOT JSON)
- Returns: `userId` and `sessionId`
- Auth: Session cookies managed by axios

### 2. GraphQL Query Structure (COPIED FROM PYTRYFI)
**Query:** Uses `currentUser` (no parameters) with exact fragment structure:
```graphql
query {
  currentUser {
    userHouseholds {
      household {
        pets {
          id
          name
          breed { name }
          device {
            id
            moduleId
            info  # JSON object with batteryPercent, isCharging
            operationParams {
              mode       # "NORMAL" or "LOST_DOG"
              ledEnabled
              ledOffAt
            }
            lastConnectionState {
              # Union type: ConnectedToUser, ConnectedToBase, ConnectedToCellular
            }
          }
        }
      }
    }
  }
}
```

### 3. Separate Location Query (MATCHES PYTRYFI)
```graphql
query {
  pet(id: "petId") {
    ongoingActivity {
      areaName
      ... on OngoingRest {
        position { latitude longitude }
        place { name address }  # Safe zone, null when not in zone
      }
      ... on OngoingWalk {
        positions { position { latitude longitude } }
      }
    }
  }
}
```

### 4. Mutations (EXACT PYTRYFI STRUCTURE)
```graphql
mutation UpdateDeviceOperationParams($input: UpdateDeviceOperationParamsInput!) {
  updateDeviceOperationParams(input: $input) {
    id
    moduleId
    operationParams { mode ledEnabled ledOffAt }
  }
}
```

Variables for LED:
```json
{ "input": { "moduleId": "xxx", "ledEnabled": true } }
```

Variables for Lost Dog Mode:
```json
{ "input": { "moduleId": "xxx", "mode": "LOST_DOG" } }
```

## Key Field Mappings
- `device.info.batteryPercent` → battery level (parsed from JSON)
- `device.info.isCharging` → charging status
- `device.operationParams.ledEnabled` → LED on/off
- `device.operationParams.mode` → "NORMAL" or "LOST_DOG"
- `ongoingActivity.place.name` → safe zone name (null when not in zone)
- `lastConnectionState.__typename === "ConnectedToUser"` → with owner
- `lastConnectionState.__typename === "ConnectedToBase"` → charging

## Escape Alert Logic
```
isEscaped = (placeName === null) && (connectedToUser === null)
```
Dog is "escaped" when:
- NOT in any safe zone (place.name is null)
- AND NOT with owner (not ConnectedToUser)

## No More Guessing
This version uses ONLY what pytryfi uses. No assumptions.
