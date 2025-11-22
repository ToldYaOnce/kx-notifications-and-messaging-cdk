# POST /api/channels/find - API Documentation

## Purpose
Find existing channels that have **exactly** the specified set of participants. This prevents creating duplicate channels when users start a new group chat with the same participants.

## Endpoint
```
POST /api/channels/find
```

## Authentication
❌ **No Authorization header required** (to avoid CORS issues)

## Request

### Headers
```
Content-Type: application/json
```

### Body Structure
```typescript
{
  userIds: string[];  // Array of user IDs to match (order doesn't matter)
}
```

### Example Request
```javascript
const response = await fetch('https://your-api.com/api/channels/find', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    userIds: ['user-123', 'user-456', 'user-789']
  })
});
```

## Response

### Success Response (200 OK)

#### When Channels Found
```json
{
  "success": true,
  "channels": [
    {
      "channelId": "ch-abc-123",
      "participants": ["user-123", "user-456", "user-789"],
      "participantHash": "user-123|user-456|user-789",
      "channelType": "group",
      "tenantId": "tenant_xyz",
      "createdAt": "2025-11-03T10:30:00.000Z",
      "lastActivity": "2025-11-03T12:45:00.000Z",
      "isActive": true,
      "title": "Group Chat",
      "metadata": {}
    }
  ],
  "participantHash": "user-123|user-456|user-789",
  "matchCount": 1
}
```

#### When No Channels Found
```json
{
  "success": true,
  "channels": [],
  "participantHash": "user-123|user-456|user-789",
  "matchCount": 0
}
```

### Error Responses

#### 400 Bad Request - Missing userIds
```json
{
  "error": "Invalid request",
  "message": "userIds array is required and must not be empty"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Failed to find channels",
  "details": "Error message details"
}
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request was successful |
| `channels` | Array | Array of matching channels (empty if none found) |
| `participantHash` | string | Computed hash of sorted participant IDs |
| `matchCount` | number | Number of matching channels found |

### Channel Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `channelId` | string | Unique channel identifier |
| `participants` | string[] | Array of participant user IDs |
| `participantHash` | string | Deterministic hash for matching |
| `channelType` | string | Type: 'group', 'direct', or 'lead' |
| `tenantId` | string | Tenant isolation ID |
| `createdAt` | string | ISO timestamp when channel was created |
| `lastActivity` | string | ISO timestamp of last message/activity |
| `isActive` | boolean | Whether channel is active (not archived) |
| `title` | string? | Optional channel name |
| `metadata` | object? | Optional metadata |

## Usage Pattern: Get or Create Channel

### TypeScript Example
```typescript
interface FindChannelRequest {
  userIds: string[];
}

interface FindChannelResponse {
  success: boolean;
  channels: Channel[];
  participantHash: string;
  matchCount: number;
}

interface Channel {
  channelId: string;
  participants: string[];
  participantHash: string;
  channelType: 'group' | 'direct' | 'lead';
  tenantId: string;
  createdAt: string;
  lastActivity: string;
  isActive: boolean;
  title?: string;
  metadata?: Record<string, any>;
}

async function getOrCreateChannel(participantIds: string[]): Promise<Channel> {
  // 1. Try to find existing channel
  const findResponse = await fetch('/api/channels/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds: participantIds })
  });
  
  if (!findResponse.ok) {
    throw new Error(`Failed to find channels: ${findResponse.status}`);
  }
  
  const findData: FindChannelResponse = await findResponse.json();
  
  // 2. If found, return existing channel
  if (findData.channels && findData.channels.length > 0) {
    console.log('✅ Using existing channel:', findData.channels[0].channelId);
    return findData.channels[0];
  }
  
  // 3. Otherwise, create new channel
  console.log('✨ Creating new channel for participants:', participantIds);
  const createResponse = await fetch('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participants: participantIds.map(id => ({ 
        userId: id,
        userName: undefined // Optional: provide names if available
      })),
      channelType: 'group',
      title: 'New Group Chat' // Optional
    })
  });
  
  if (!createResponse.ok) {
    throw new Error(`Failed to create channel: ${createResponse.status}`);
  }
  
  const createData = await createResponse.json();
  console.log('✅ Created new channel:', createData.channel.channelId);
  return createData.channel;
}
```

### React Hook Example
```typescript
import { useState } from 'react';

function useChannelFinder() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const getOrCreateChannel = async (participantIds: string[]) => {
    setLoading(true);
    setError(null);
    
    try {
      // Find existing
      const findRes = await fetch('/api/channels/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: participantIds })
      });
      
      const findData = await findRes.json();
      
      if (findData.channels?.length > 0) {
        return findData.channels[0]; // Use existing
      }
      
      // Create new
      const createRes = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants: participantIds.map(id => ({ userId: id })),
          channelType: 'group'
        })
      });
      
      const createData = await createRes.json();
      return createData.channel;
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  return { getOrCreateChannel, loading, error };
}

// Usage in component:
function ChatList() {
  const { getOrCreateChannel } = useChannelFinder();
  
  const handleStartChat = async (selectedUsers: string[]) => {
    const channel = await getOrCreateChannel(selectedUsers);
    // Navigate to channel or open chat UI
    console.log('Channel ready:', channel.channelId);
  };
  
  return (/* your UI */);
}
```

## Important Notes

### Participant Matching
- ✅ **Order doesn't matter**: `['user1', 'user2']` = `['user2', 'user1']`
- ✅ **Exact match only**: Must have ALL and ONLY these participants
- ✅ **Automatic sorting**: System sorts IDs alphabetically before matching
- ✅ **Active channels only**: Archived channels are not returned

### When to Use
- ✅ Before creating a new group chat
- ✅ When "Continue conversation" feature is needed
- ✅ To prevent duplicate channels in UI

### When NOT to Use
- ❌ Finding channels for a single user (use `GET /api/channels?userId=...`)
- ❌ Searching by channel name (not supported yet)
- ❌ Finding channels with "at least these participants" (only exact match)

## Testing

### cURL Example
```bash
curl -X POST https://your-api.com/api/channels/find \
  -H "Content-Type: application/json" \
  -d '{
    "userIds": ["user-123", "user-456", "user-789"]
  }'
```

### Postman Example
```
Method: POST
URL: https://your-api.com/api/channels/find
Headers:
  Content-Type: application/json
Body (raw JSON):
{
  "userIds": ["user-123", "user-456", "user-789"]
}
```

## Error Handling Best Practices

```typescript
async function findChannelSafely(userIds: string[]): Promise<Channel | null> {
  try {
    // Validate input
    if (!userIds || userIds.length === 0) {
      console.error('❌ userIds array is required');
      return null;
    }
    
    // Remove duplicates
    const uniqueUserIds = [...new Set(userIds)];
    
    const response = await fetch('/api/channels/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: uniqueUserIds })
    });
    
    if (!response.ok) {
      console.error('❌ Find channels failed:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    // Return first match or null
    return data.channels?.[0] || null;
    
  } catch (error) {
    console.error('❌ Exception finding channels:', error);
    return null;
  }
}
```

## Performance Notes

- **O(1) Lookup**: Uses DynamoDB GSI for fast queries
- **No Pagination**: Returns up to 10 matches (usually 0 or 1)
- **Minimal Payload**: Only returns channel metadata, not messages
- **Tenant Filtered**: Automatically filters by authenticated user's tenant

## Migration Notes

If you have existing channels without `participantHash`:
1. They won't be found by this endpoint
2. New channels created after v1.1.45+ will have the hash
3. Existing channels will get the hash when participants join/leave
4. Consider running a migration script to backfill hashes if needed

---

**Package Version:** v1.1.46+  
**Last Updated:** November 3, 2025









