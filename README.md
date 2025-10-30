# @toldyaonce/kx-notifications-and-messaging-cdk

## What It Does

A **notification and messaging infrastructure package** that transforms business events into structured notifications and messages with intelligent multi-target delivery.

**Core Purpose:**
- 📥 **Consumes business events** from EventBridge (orders, leads, user actions, etc.)
- 🏗️ **Creates notifications/messages** automatically using configurable templates  
- 📊 **Stores with smart targeting** (user-specific, client-wide, broadcast)
- 📤 **Publishes delivery events** for real-time systems (WebSocket, push, email)
- 🔌 **Provides REST APIs** for CRUD operations

**Perfect for:**
- Multi-tenant applications needing targeted notifications
- Event-driven architectures requiring notification automation
- Systems needing both real-time and persistent messaging
- Applications with complex user/client hierarchies

## How It Works

### Event-Driven Architecture
```mermaid
graph LR
    A[Business Systems] --> B[EventBridge]
    B --> C[This Package]
    C --> D[DynamoDB Storage]
    C --> E[Delivery Events]
    E --> F[Consumer Systems]
    F --> G[Real-time Delivery]
    
    subgraph "This Package"
        C1[Event Consumer]
        C2[Message Creation]
        C3[Fanout Logic]
        C4[REST APIs]
    end
```

### 1. Event Processing
Your business systems publish events:
```typescript
// CRM system publishes
{
  "source": "crm-system",
  "detail-type": "lead.created",
  "detail": { "leadId": "123", "clientId": "acme-corp", "leadName": "John Doe" }
}
```

### 2. Automatic Notification Creation
Package automatically creates notifications using templates:
```typescript
eventSubscriptions: [{
  eventPattern: { source: ['crm-system'], detailType: ['lead.created'] },
  notificationMapping: {
    'lead.created': {
      targetType: 'client',
      clientId: (detail) => detail.clientId,
      title: 'New Lead Created',
      content: (detail) => `Lead ${detail.leadName} needs attention`
    }
  }
}]
```

### 3. Smart Storage & Targeting
- **User notifications**: `targetKey: "user#user123"` - Personal notifications
- **Client notifications**: `targetKey: "client#acme-corp"` - Team-wide notifications
- **Broadcast notifications**: `targetKey: "broadcast"` - System-wide announcements

### 4. Delivery Event Publishing
Package publishes events for downstream delivery systems:
```typescript
{
  "source": "kx-notifications-messaging",
  "detail-type": "client.notification.available",
  "detail": { "userId": "user123", "notificationId": "notif-456", "priority": "high" }
}
```

## Architecture

### Complete System Architecture
```mermaid
graph TB
    subgraph "Business Layer"
        A1[CRM System]
        A2[Order System] 
        A3[User System]
    end
    
    subgraph "Event Layer"
        B[EventBridge]
    end
    
    subgraph "This Package - Infrastructure Layer"
        C1[Internal Event Consumer]
        C2[DynamoDB Tables]
        C3[Fanout Logic]
        C4[REST APIs]
        C5[Stream Processors]
    end
    
    subgraph "Delivery Layer - Consumer Stacks"
        D1[WebSocket Handler]
        D2[Push Notifications]
        D3[Email Handler]
        D4[Slack Integration]
    end
    
    subgraph "Client Layer"
        E1[Web Apps]
        E2[Mobile Apps]
        E3[Desktop Apps]
    end
    
    A1 --> B
    A2 --> B
    A3 --> B
    B --> C1
    C1 --> C2
    C2 --> C5
    C5 --> B
    B --> D1
    B --> D2
    B --> D3
    B --> D4
    D1 --> E1
    D2 --> E2
    D3 --> E1
```

### Data Flow
```mermaid
sequenceDiagram
    participant BS as Business System
    participant EB as EventBridge
    participant PKG as This Package
    participant DB as DynamoDB
    participant CS as Consumer Stack
    participant Client as Client App
    
    BS->>EB: Publish business event
    EB->>PKG: Event received
    PKG->>DB: Create notification/message
    DB->>PKG: Stream event (INSERT)
    PKG->>EB: Publish delivery event
    EB->>CS: Delivery event received
    CS->>Client: Real-time notification
```

### Package Components
- **DynamoDB Tables**: Messages, notifications, and status tracking
- **EventBridge Integration**: Event consumption and publishing
- **Lambda Functions**: Event processing, fanout logic, API handlers
- **API Gateway**: REST endpoints for CRUD operations
- **Stream Processing**: Real-time event emission from data changes

## Integration Guide

### 🚀 Quick Start

```typescript
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

new NotificationMessagingStack(app, 'Notifications', {
  resourcePrefix: 'myapp',
  
  // Auto-create notifications from business events
  eventSubscriptions: [
    {
      name: 'OrderNotifications',
      eventPattern: { 
        source: ['order-system'], 
        detailType: ['order.shipped', 'order.delivered'] 
      },
      notificationMapping: {
        'order.shipped': {
          targetType: 'user',
          userId: (detail) => detail.customerId,
          title: 'Order Shipped',
          content: (detail) => `Order #${detail.orderId} is on its way!`,
          priority: 'medium'
        },
        'order.delivered': {
          targetType: 'user', 
          userId: (detail) => detail.customerId,
          title: 'Order Delivered',
          content: (detail) => `Order #${detail.orderId} has been delivered!`,
          priority: 'high'
        }
      }
    }
  ]
});
```

### 🔌 Integration with Existing API Gateway

> **Important:** This stack includes **three services**: Messages, Notifications, and **Chat Channels**. All three will be attached to your existing API Gateway.

```typescript
// Use your existing API Gateway
const api = new apigateway.RestApi(this, 'MainApi', {
  deployOptions: { stageName: 'prod' }
});

// Add your existing services...
// attachServiceToApiGateway(api, YourService, '/your-endpoints');

// Add notifications, messages & channels to your existing API
new NotificationMessagingStack(this, 'Notifications', {
  resourcePrefix: 'myapp',
  
  apiGatewayConfig: {
    existingMessagesApi: api,           // Use your existing API
    existingNotificationsApi: api,      // Use your existing API
    separateApis: false,                // Both services on same API
    messagesBasePath: '/messages',      // Your preferred path
    notificationsBasePath: '/notifications',
    channelsBasePath: '/channels'       // Channels path (optional, defaults to '/channels')
  },
  
  eventSubscriptions: [
    // ... your event subscriptions
  ]
});

// 🎉 Your API now includes:
// GET/POST/PUT/DELETE /messages
// GET/POST/PUT/DELETE /notifications
// GET/POST/PUT/DELETE /channels
// POST /channels/{channelId}/{action} (join, leave, claim, assign-bot)
```

### 🌐 Consumer Stack Integration (Real-time Delivery)

```typescript
// Consumer stack handles real-time delivery
export class NotificationConsumerStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, notificationStack: NotificationMessagingStack) {
    super(scope, id);
    
    // WebSocket API Gateway for real-time delivery
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'ChatWebSocket', {
      // ... WebSocket configuration
    });
    
    // WebSocket handler for real-time delivery
    const websocketHandler = new lambda.Function(this, 'WebSocketHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
        
        exports.handler = async (event) => {
          const { userId, notificationId, messageId } = event.detail;
          
          // Get user's WebSocket connection
          const connectionId = await getUserConnection(userId);
          
          if (connectionId) {
            const apiGw = new ApiGatewayManagementApiClient({
              endpoint: process.env.WEBSOCKET_ENDPOINT
            });
            
            await apiGw.send(new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: JSON.stringify({
                type: 'notification',
                notificationId,
                messageId,
                timestamp: new Date().toISOString()
              })
            }));
          }
        };
      `),
      environment: {
        WEBSOCKET_ENDPOINT: webSocketApi.apiEndpoint
      }
    });
    
    // Listen to notification events from the package
    new events.Rule(this, 'NotificationRule', {
      eventBus: notificationStack.eventBridge.eventBus,
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: [
          'notification.created',
          'message.created', 
          'client.notification.available',
          'client.message.available'
        ]
      },
      targets: [new targets.LambdaFunction(websocketHandler)]
    });
  }
}
```

### 📱 Multi-Target Notification Examples

```typescript
eventSubscriptions: [
  {
    name: 'UserNotifications',
    eventPattern: { source: ['user-system'], detailType: ['profile.updated'] },
    notificationMapping: {
      'profile.updated': {
        targetType: 'user',                    // Personal notification
        userId: (detail) => detail.userId,
        title: 'Profile Updated',
        content: 'Your profile has been successfully updated'
      }
    }
  },
  {
    name: 'TeamNotifications', 
    eventPattern: { source: ['project-system'], detailType: ['project.completed'] },
    notificationMapping: {
      'project.completed': {
        targetType: 'client',                  // Team-wide notification
        clientId: (detail) => detail.tenantId,
        title: 'Project Completed',
        content: (detail) => `Project ${detail.projectName} has been completed!`,
        priority: 'high'
      }
    }
  },
  {
    name: 'SystemNotifications',
    eventPattern: { source: ['system'], detailType: ['maintenance.scheduled'] },
    notificationMapping: {
      'maintenance.scheduled': {
        targetType: 'broadcast',               // System-wide notification
        title: 'Scheduled Maintenance',
        content: (detail) => `System maintenance scheduled for ${detail.scheduledTime}`,
        priority: 'urgent'
      }
    }
  }
]
```

## 💬 Chat Channels & Lead Management

### Overview

The package includes comprehensive chat channels functionality for lead management and real-time messaging. This enables:

- **Lead Capture**: Automatic channel creation when visitors start chat
- **Bot Assignment**: Random employee bot personalities engage new leads  
- **Lead Claiming**: Employees can claim leads from bots
- **Real-time Chat**: WebSocket delivery via EventBridge integration
- **Multi-tenant Security**: Proper isolation and permissions

### Architecture

```mermaid
graph TB
    subgraph "Lead Flow"
        A1[Website Visitor] --> A2[Starts Chat]
        A2 --> A3[Create Channel API]
        A3 --> A4[Assign Random Bot]
        A4 --> A5[Bot Engages Lead]
    end
    
    subgraph "Employee Flow"  
        B1[Employee Login] --> B2[List Channels API]
        B2 --> B3[See Unclaimed Leads]
        B3 --> B4[Claim Lead API]
        B4 --> B5[Bot Leaves, Employee Takes Over]
    end
    
    subgraph "Real-time Messaging"
        C1[Send Message API] --> C2[Store in DynamoDB]
        C2 --> C3[EventBridge Event]
        C3 --> C4[WebSocket Broadcast]
        C4 --> C5[All Channel Participants]
    end
```

### Database Schema

#### Channels Table
```typescript
interface Channel {
  channelId: string;          // Primary key
  createdAt: string;          // Sort key  
  channelType: 'lead' | 'group' | 'direct';
  tenantId: string;           // Tenant isolation
  title?: string;             // Optional channel name
  
  // Lead-specific fields
  leadStatus?: 'unclaimed' | 'claimed';
  claimedBy?: string;         // Employee who claimed
  botEmployeeId?: string;     // Employee whose bot personality is used
  
  // Metadata
  participants: string[];     // Array of userIds
  lastActivity: string;       // ISO timestamp
  lastMessage?: {
    content: string;
    senderId: string;
    timestamp: string;
    messageId: string;
  };
}
```

#### Channel Participants Table  
```typescript
interface ChannelParticipant {
  userId: string;             // Primary key (employees, bots, leads)
  channelId: string;          // Sort key
  tenantId: string;           // For tenant-based queries
  role: 'employee' | 'bot' | 'lead' | 'admin';
  joinedAt: string;           // ISO timestamp
  leftAt?: string;            // When user left (if applicable)
  isActive: boolean;          // Current participation status
}
```

### Integration Steps

#### 1. 🏗️ Deploy with Chat Channels

```typescript
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

const messagingStack = new NotificationMessagingStack(this, 'Messaging', {
  resourcePrefix: 'myapp',
  
  // EventBridge subscriptions for real-time chat
  eventSubscriptions: [
    {
      name: 'ChatMessageDelivery',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        'detail-type': ['chat.message.sent']
      },
      targets: [{
        id: 'WebSocketBroadcast',
        arn: 'arn:aws:lambda:region:account:function:websocket-handler'
      }]
    },
    {
      name: 'NewLeadAlert', 
      eventPattern: {
        source: ['kx-notifications-messaging'],
        'detail-type': ['channel.created'],
        detail: { channelType: ['lead'], leadStatus: ['unclaimed'] }
      },
      targets: [{
        id: 'NotifyEmployees',
        arn: 'arn:aws:lambda:region:account:function:notify-new-lead'
      }]
    }
  ]
});

// Access the new APIs
const channelsApi = messagingStack.channelsApi;
const channelsTable = messagingStack.dynamoTables.channelsTable;
const participantsTable = messagingStack.dynamoTables.channelParticipantsTable;
```

#### 2. 🤖 Channel Creation Examples

**Create Direct Message Channel:**
```typescript
const createDirectChannel = async (user1Id: string, user1Name: string, user2Id: string, user2Name: string) => {
  const response = await fetch(`${channelsApiUrl}/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({
      channelType: 'direct',
      participants: [
        { userId: user1Id, userName: user1Name },
        { userId: user2Id, userName: user2Name }
      ]
    })
  });
  
  const { channel } = await response.json();
  return channel.channelId;
};
```

**Create Lead Channel (Website Integration):**
```typescript
// When visitor starts chat on your website
const createLeadChannel = async (visitorId: string, visitorName: string, employeeId: string) => {
  const response = await fetch(`${channelsApiUrl}/channels`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${systemToken}` // Service account token
    },
    body: JSON.stringify({
      channelType: 'lead',
      title: 'New Website Visitor',
      participants: [
        { userId: visitorId, userName: visitorName || 'Anonymous Visitor' }
      ],
      botEmployeeId: employeeId,  // Random employee for bot personality
      metadata: {
        visitorInfo: {
          page: window.location.pathname,
          referrer: document.referrer,
          userAgent: navigator.userAgent
        }
      }
    })
  });
  
  const { channel } = await response.json();
  return channel.channelId;
};
```

#### 3. 💬 Send Chat Messages

```typescript
// Send message in channel (works for bots, employees, leads)
const sendChatMessage = async (channelId: string, content: string, senderId: string) => {
  const response = await fetch(`${messagesApiUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({
      targetType: 'channel',
      channelId,
      messageType: 'chat',
      content,
      senderId,
      // Optional: threading
      replyToMessageId: parentMessageId
    })
  });
  
  return await response.json();
};
```

#### 4. 👥 Employee Channel Management

```typescript
// Get channels for employee (their channels + unclaimed leads from tenant)
const getEmployeeChannels = async (employeeToken: string) => {
  const response = await fetch(`${channelsApiUrl}/channels?limit=50`, {
    headers: {
      'Authorization': `Bearer ${employeeToken}`
    }
  });
  
  const { channels } = await response.json();
  
  // Channels are automatically filtered:
  // - Employee's active channels
  // - Unclaimed leads from their tenant (for claiming)
  return channels;
};

// Claim a lead (employee takes over from bot)
const claimLead = async (channelId: string, employeeToken: string) => {
  const response = await fetch(`${channelsApiUrl}/channels/${channelId}/claim`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${employeeToken}`
    }
  });
  
  // Bot automatically stops engaging, employee takes over
  return await response.json();
};
```

#### 5. 📱 WebSocket Consumer Implementation

**Important:** Channel messages are automatically fanned out to individual users. Your consumer doesn't need to query channels - just listen for user-specific events!

##### How Channel Message Fanout Works

```mermaid
graph TB
    A[User A sends message to channel-123] --> B[Message saved with targetKey: channel#channel-123]
    B --> C[DynamoDB Stream triggers FanoutLambda]
    C --> D[FanoutLambda queries channel participants]
    D --> E[Finds: user-A, user-B, user-C]
    E --> F[Creates 3 EventBridge events]
    F --> G1[Event for user-A]
    F --> G2[Event for user-B] 
    F --> G3[Event for user-C]
    G1 --> H[Your WebSocket Consumer]
    G2 --> H
    G3 --> H
    H --> I1[Send to user-A's WebSocket]
    H --> I2[Send to user-B's WebSocket]
    H --> I3[Send to user-C's WebSocket]
```

**Key Insight:** The package automatically converts channel-targeted messages into user-specific events. You just need to listen for `chat.message.available` events filtered by `userId`.

##### Consumer Stack Setup

```typescript
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

export class WebSocketConsumerStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, messagingStack: NotificationMessagingStack) {
    super(scope, id);
    
    // 1. Create WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'ChatWebSocket', {
      routeSelectionExpression: '$request.body.action',
    });
    
    const stage = new apigatewayv2.WebSocketStage(this, 'Production', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });
    
    // 2. Create WebSocket message sender Lambda
    const websocketSenderLambda = new lambda.Function(this, 'WebSocketSender', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('./lambda/websocket-sender'),
      environment: {
        WEBSOCKET_API_ENDPOINT: stage.url,
        CONNECTIONS_TABLE: connectionsTable.tableName,
        MESSAGES_TABLE: messagingStack.dynamoTables.messagesTable.tableName
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    // Grant permissions
    webSocketApi.grantManageConnections(websocketSenderLambda);
    connectionsTable.grantReadWriteData(websocketSenderLambda);
    messagingStack.dynamoTables.messagesTable.grantReadData(websocketSenderLambda);
    
    // 3. Create EventBridge rule to listen for channel messages
    new events.Rule(this, 'ChatMessageRule', {
      eventBus: messagingStack.eventBridge.eventBus,
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['chat.message.available']  // Already fanned out per user!
      },
      targets: [new targets.LambdaFunction(websocketSenderLambda)]
    });
  }
}
```

##### WebSocket Sender Lambda Implementation

```typescript
// lambda/websocket-sender/index.ts
import { EventBridgeEvent } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const apiGateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

interface ChatMessageEvent {
  eventId: string;
  eventType: 'chat.message.available';
  userId: string;          // The user who should receive this message
  channelId: string;       // The channel the message was sent to
  messageId: string;       // The message ID
  targetType: 'channel';
  timestamp: string;
  priority?: string;
  content?: string;        // May be included for optimization
  senderId?: string;       // May be included for optimization
  metadata: {
    fanoutSource: 'channel-targeting';
    originalTargetKey: string;
  };
}

export const handler = async (event: EventBridgeEvent<string, ChatMessageEvent>) => {
  console.log('Received chat message event:', JSON.stringify(event, null, 2));
  
  const { detail } = event;
  const { userId, channelId, messageId, content, senderId } = detail;
  
  try {
    // 1. Get user's WebSocket connectionId
    const connectionResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CONNECTIONS_TABLE!,
      Key: { userId }
    }));
    
    if (!connectionResult.Item?.connectionId) {
      console.log(`No active WebSocket connection for user ${userId}`);
      return; // User not connected, skip (message is still in DB)
    }
    
    const connectionId = connectionResult.Item.connectionId;
    
    // 2. Get full message details (if not in event)
    let messageData;
    if (content) {
      // Content already included (optimization)
      messageData = {
        messageId,
        channelId,
        content,
        senderId,
        timestamp: detail.timestamp
      };
    } else {
      // Fetch from DynamoDB
      const messageResult = await dynamodb.send(new GetCommand({
        TableName: process.env.MESSAGES_TABLE!,
        Key: { messageId }
      }));
      messageData = messageResult.Item;
    }
    
    // 3. Send to WebSocket
    await apiGateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify({
        type: 'chat.message',
        channelId,
        messageId,
        message: messageData.content,
        senderId: messageData.senderId,
        senderName: messageData.metadata?.userName,
        timestamp: messageData.timestamp || messageData.createdAt,
        metadata: messageData.metadata
      }))
    }));
    
    console.log(`✅ Sent message ${messageId} to user ${userId} via connection ${connectionId}`);
    
  } catch (error) {
    if (error instanceof GoneException) {
      // Connection no longer exists - clean up
      console.log(`Connection gone for user ${userId}, cleaning up...`);
      await dynamodb.send(new DeleteCommand({
        TableName: process.env.CONNECTIONS_TABLE!,
        Key: { userId }
      }));
    } else {
      console.error('Error sending message:', error);
      throw error; // Trigger retry
    }
  }
};
```

##### WebSocket Connection Management

You need a DynamoDB table to track active WebSocket connections:

```typescript
// In your consumer stack
const connectionsTable = new dynamodb.Table(this, 'WebSocketConnections', {
  tableName: 'websocket-connections',
  partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl', // Auto-cleanup stale connections
  removalPolicy: cdk.RemovalPolicy.DESTROY
});
```

**Connection Handler (when user connects):**
```typescript
// On WebSocket $connect
export const connectHandler = async (event: any) => {
  const connectionId = event.requestContext.connectionId;
  const userId = getUserIdFromAuth(event); // Extract from JWT/auth context
  
  await dynamodb.send(new PutCommand({
    TableName: process.env.CONNECTIONS_TABLE!,
    Item: {
      userId,
      connectionId,
      connectedAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + 86400 // 24 hours
    }
  }));
  
  return { statusCode: 200 };
};
```

**Disconnect Handler (when user disconnects):**
```typescript
// On WebSocket $disconnect
export const disconnectHandler = async (event: any) => {
  const connectionId = event.requestContext.connectionId;
  
  // Find and delete the connection
  // Option 1: If you store connectionId as secondary index
  await dynamodb.send(new DeleteCommand({
    TableName: process.env.CONNECTIONS_TABLE!,
    Key: { userId: getUserIdFromConnection(connectionId) }
  }));
  
  return { statusCode: 200 };
};
```

##### What You DON'T Need to Do

❌ **Don't query channel participants** - The FanoutLambda already did this  
❌ **Don't broadcast to all connections** - Each event is user-specific  
❌ **Don't filter by channelId** - Filter by userId instead  
❌ **Don't query which channels a user belongs to** - Events already targeted  

##### What You DO Need to Do

✅ **Listen for `chat.message.available` events** from EventBridge  
✅ **Extract `userId` from event** - Each event is for one user  
✅ **Look up WebSocket connectionId** for that userId  
✅ **Send message to that connection** - One user at a time  
✅ **Handle disconnections gracefully** - Clean up stale connections  

##### Testing Your Implementation

1. **Setup:** Two users connect to WebSocket
   ```javascript
   // User A connects
   const wsA = new WebSocket('wss://your-websocket-api.execute-api.region.amazonaws.com/prod');
   
   // User B connects  
   const wsB = new WebSocket('wss://your-websocket-api.execute-api.region.amazonaws.com/prod');
   ```

2. **User A sends message:**
   ```javascript
   await fetch(`${apiUrl}/messages`, {
     method: 'POST',
     headers: { 'Authorization': `Bearer ${tokenA}` },
     body: JSON.stringify({
       targetType: 'channel',
       channelId: 'channel-123',
       content: 'Hello everyone!',
       senderId: 'user-a'
     })
   });
   ```

3. **What happens:**
   - Message saved with `targetKey: "channel#channel-123"`
   - FanoutLambda queries participants: `["user-a", "user-b"]`
   - Two EventBridge events created:
     - `{ userId: "user-a", channelId: "channel-123", messageId: "msg-456" }`
     - `{ userId: "user-b", channelId: "channel-123", messageId: "msg-456" }`
   - Your consumer Lambda triggered twice (once per user)
   - Both WebSockets receive the message

4. **User B receives:**
   ```javascript
   wsB.onmessage = (event) => {
     const data = JSON.parse(event.data);
     // data = {
     //   type: 'chat.message',
     //   channelId: 'channel-123',
     //   messageId: 'msg-456',
     //   message: 'Hello everyone!',
     //   senderId: 'user-a',
     //   timestamp: '2025-10-30T...'
     // }
   };
   ```

##### Complete Working Example

See the full working example in the repository:
- Consumer Stack: `examples/websocket-consumer-stack.ts`
- Lambda Handler: `examples/websocket-sender-lambda.ts`
- Frontend Integration: `examples/websocket-client.ts`

##### Additional Event Types

Listen for other channel events:

```typescript
new events.Rule(this, 'AllChannelEvents', {
  eventBus: messagingStack.eventBridge.eventBus,
  eventPattern: {
    source: ['kx-notifications-messaging'],
    detailType: [
      'chat.message.available',    // Channel messages (fanned out)
      'channel.created',            // New channel created
      'channel.claimed',            // Lead claimed by employee
      'user.joined.channel',        // User joined channel
      'user.left.channel'          // User left channel
    ]
  },
  targets: [new targets.LambdaFunction(websocketSenderLambda)]
});
```

### Chat API Reference

#### Channels API

| Method | Endpoint | Description | Query Parameters | Auth Required |
|--------|----------|-------------|------------------|---------------|
| `GET` | `/channels` | List user's channels + unclaimed leads | `userId`, `tenantId`, `includeAnonymous`, `limit` | Employee Token |
| `POST` | `/channels` | Create new channel | - | System/Employee Token |
| `GET` | `/channels/{id}` | Get channel details | - | Participant Token |
| `PUT` | `/channels/{id}` | Update channel metadata | - | Admin/Owner Token |
| `DELETE` | `/channels/{id}` | Archive channel | - | Admin/Owner Token |
| `POST` | `/channels/{id}/join` | Join channel | - | Employee Token |
| `POST` | `/channels/{id}/leave` | Leave channel | - | Participant Token |
| `POST` | `/channels/{id}/claim` | Claim lead channel | - | Employee Token |
| `POST` | `/channels/{id}/assign-bot` | Assign bot to channel | - | System Token |

**GET /channels Query Parameters:**
- `userId` - Filter channels by participant userId (defaults to authenticated user)
- `tenantId` - Required for tenant isolation (from auth context)
- `includeAnonymous` - Include unclaimed lead channels (default: `true`, set to `false` to exclude)
- `limit` - Max number of channels to return (default: `50`)

**Examples:**
```bash
# Get all channels for authenticated user (includes unclaimed leads)
GET /channels

# Get specific user's channels with unclaimed leads
GET /channels?userId=user-123

# Get only user's channels (exclude unclaimed leads)
GET /channels?userId=user-123&includeAnonymous=false

# Get first 10 channels
GET /channels?limit=10
```

**GET /channels Response (Enriched with Participant Details):**
```json
{
  "success": true,
  "channels": [
    {
      "channelId": "abc-123",
      "channelType": "direct",
      "participants": ["user-1", "user-2"],
      "participantDetails": [
        {
          "userId": "user-1",
          "userName": "John Doe",
          "role": "employee",
          "joinedAt": "2025-10-19T..."
        },
        {
          "userId": "user-2",
          "userName": "Jane Smith",
          "role": "employee",
          "joinedAt": "2025-10-19T..."
        }
      ],
      "lastActivity": "2025-10-19T...",
      "createdAt": "2025-10-19T...",
      "tenantId": "tenant_xyz"
    }
  ],
  "count": 1,
  "queryParams": {
    "userId": "user-1",
    "tenantId": "tenant_xyz",
    "includeAnonymous": true
  }
}
```

**Note:** `participantDetails` array includes active participants with their names, roles, and join times. No need for additional lookups!

**POST /channels - Create Channel:**
```typescript
{
  channelType: 'direct' | 'group' | 'lead',
  title?: string,
  participants: Array<{           // Array of participant objects
    userId: string,
    userName?: string
  }>,
  botEmployeeId?: string,         // For lead channels with bot assignment
  metadata?: {
    createdBy?: string,
    createdAt?: string,
    // ... custom fields
  }
}
```

**Example Request:**
```json
{
  "channelType": "direct",
  "participants": [
    { "userId": "user-123", "userName": "John Doe" },
    { "userId": "user-456", "userName": "Jane Smith" }
  ],
  "metadata": {
    "createdBy": "user-123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "channel": {
    "channelId": "uuid",
    "channelType": "direct",
    "participants": ["user-1", "user-2"],
    "tenantId": "tenant_xyz",
    "createdAt": "2025-10-19T...",
    "lastActivity": "2025-10-19T..."
  },
  "message": "Channel created successfully"
}
```

**POST /channels/{channelId}/join:**
```bash
POST /channels/abc-123/join

# Optional body to include userName
{
  "userName": "John Doe"
}
```

**POST /channels/{channelId}/claim:**
```bash
POST /channels/abc-123/claim

# Optional body to include userName
{
  "userName": "Jane Smith"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lead claimed successfully"
}
```

**POST /channels/{channelId}/assign-bot:**
```bash
POST /channels/abc-123/assign-bot

# Body required
{
  "botEmployeeId": "employee-789",
  "botName": "Support Bot" // Optional display name
}
```

#### Enhanced Messages API

| Method | Endpoint | Description | Query Parameters | Auth Required |
|--------|----------|-------------|------------------|---------------|
| `GET` | `/messages` | List messages | `channelId`, `userId`, `targetType`, `messageType`, `limit` | Employee Token |
| `POST` | `/messages` | Send chat message | - | Employee Token |
| `GET` | `/messages/{id}` | Get specific message | - | Participant Token |
| `PUT` | `/messages/{id}` | Update message | - | Sender Token |
| `DELETE` | `/messages/{id}` | Delete message | - | Sender Token |

**GET /messages Query Parameters:**
- `channelId` - Get all messages for a specific channel (returns messages with `targetKey=channel#{channelId}`)
- `userId` - Get all messages for a specific user (returns messages with `targetKey=user#{userId}`)
- `targetType` - Filter by target type: `user`, `client`, `broadcast`, or `channel`
- `messageType` - Filter by message type: `chat`, `notification`, `text`, `email`
- `limit` - Max messages to return (default: `50`)

**Examples:**
```bash
# Get all chat messages for a channel (sorted by timestamp)
GET /messages?channelId=abc-123&messageType=chat

# Get all messages for a user
GET /messages?userId=user-123

# Get only channel messages
GET /messages?targetType=channel&limit=100
```

**POST /messages - Create Chat Message:**
```typescript
{
  targetType: 'channel',
  channelId: string,
  messageType: 'chat',
  content: string,
  senderId: string,
  title?: string,
  replyToMessageId?: string,  // For threading
  metadata?: {
    userName?: string,
    timestamp?: string
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": {
    "messageId": "uuid",
    "channelId": "abc-123",
    "senderId": "user-123",
    "content": "Hello!",
    "targetKey": "channel#abc-123",
    "dateReceived": "2025-10-19T...",
    "messageType": "chat"
  }
}
```

### EventBridge Events

#### Channel Events
```typescript
// New lead channel created
{
  source: 'kx-notifications-messaging',
  'detail-type': 'channel.created',
  detail: {
    channelId: string,
    channelType: 'lead',
    tenantId: string,
    leadStatus: 'unclaimed',
    botEmployeeId: string,
    participantCount: number
  }
}

// Lead claimed by employee  
{
  source: 'kx-notifications-messaging',
  'detail-type': 'channel.claimed',
  detail: {
    channelId: string,
    tenantId: string,
    claimedBy: string,
    previousStatus: 'unclaimed'
  }
}
```

#### Chat Message Events
```typescript
// Chat message sent
{
  source: 'kx-notifications-messaging', 
  'detail-type': 'chat.message.sent',
  detail: {
    messageId: string,
    channelId: string,
    senderId: string,
    tenantId: string,
    messageType: 'chat',
    timestamp: string
  }
}
```

### Security & Permissions

#### Tenant Isolation
- ✅ **Channels**: Isolated by `tenantId`
- ✅ **Participants**: Tenant-based access control
- ✅ **Messages**: Channel membership required
- ✅ **Lead Visibility**: Employees only see their tenant's unclaimed leads

#### Role-Based Access
- **Employee**: Can claim leads, join channels, send messages
- **Bot**: Can send messages, auto-assigned to leads
- **Lead**: Can send messages in their channel
- **Admin**: Full access to tenant channels

#### Authentication Integration
```typescript
// Extract from your auth context
function extractUserIdFromEvent(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.userId || 
         event.requestContext?.authorizer?.claims?.sub;
}

function extractTenantIdFromEvent(event: APIGatewayProxyEvent): string {
  return event.requestContext?.authorizer?.tenantId || 
         event.requestContext?.authorizer?.claims?.tenantId;
}
```

### Performance Considerations

#### Efficient Querying
- ✅ **User Channels**: Single query on `userId` partition
- ✅ **Unclaimed Leads**: GSI query on `tenantId-leadStatus`
- ✅ **Channel History**: Paginated with `limit` and `before` cursor
- ✅ **Real-time Updates**: EventBridge fanout (no polling)

#### Scaling Patterns
- ✅ **DynamoDB Auto-scaling**: Handles traffic spikes
- ✅ **EventBridge**: Decoupled real-time delivery
- ✅ **Lambda Concurrency**: Automatic scaling for API calls
- ✅ **Connection Pooling**: Efficient database connections

## API Reference

### REST Endpoints

#### Messages API
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/messages` | List messages for user/client | `userId`, `tenantId`, `targetTypes`, `status`, `priority`, `limit` |
| `POST` | `/messages` | Create new message | - |
| `GET` | `/messages/{id}` | Get specific message | - |
| `PUT` | `/messages/{id}` | Update message | - |
| `DELETE` | `/messages/{id}` | Delete message | - |

#### Notifications API  
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/notifications` | List notifications for user/client | `userId`, `tenantId`, `targetTypes`, `status`, `priority`, `limit` |
| `POST` | `/notifications` | Create new notification | - |
| `GET` | `/notifications/{id}` | Get specific notification | - |
| `PUT` | `/notifications/{id}` | Update notification | - |
| `DELETE` | `/notifications/{id}` | Delete notification | - |
| `POST` | `/notifications/mark-read` | Mark multiple as read | - |
| `GET` | `/notifications/unread-count` | Get unread count | `userId`, `tenantId` |

### Event Types Published

| Event Type | Description | Detail Fields |
|------------|-------------|---------------|
| `notification.created` | New notification available | `userId`, `notificationId`, `priority`, `targetType` |
| `message.created` | New message available | `userId`, `messageId`, `targetType`, `priority` |
| `notification.read` | Notification marked as read | `userId`, `notificationId` |
| `message.read` | Message marked as read | `userId`, `messageId` |
| `client.notification.available` | Client notification ready for delivery | `userId`, `clientId`, `notificationId` |
| `client.message.available` | Client message ready for delivery | `userId`, `clientId`, `messageId` |
| `broadcast.notification.available` | Broadcast notification ready | `userId`, `notificationId` |
| `broadcast.message.available` | Broadcast message ready | `userId`, `messageId` |

### API Usage Examples

#### Create Personal Message
```bash
curl -X POST https://api.example.com/messages \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetType": "user",
    "content": "Your order has been shipped!",
    "title": "Order Update",
    "priority": "medium",
    "metadata": {
      "orderId": "12345",
      "trackingNumber": "1Z999AA1234567890"
    }
  }'
```

#### Create Team-Wide Message
```bash
curl -X POST https://api.example.com/messages \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetType": "client",
    "clientId": "client-123",
    "content": "Team meeting in 5 minutes!",
    "title": "Meeting Reminder",
    "priority": "high"
  }'
```

#### Query Notifications
```bash
# Get notifications for specific user and tenant
curl "https://api.example.com/notifications?userId=user123&tenantId=client456&limit=25" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get only unread notifications
curl "https://api.example.com/notifications?userId=user123&status=unread" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Configuration Options

### Event Subscriptions
```typescript
interface EventSubscription {
  name: string;
  eventPattern: {
    source: string[];
    detailType: string[];
  };
  notificationMapping?: {
    [eventType: string]: NotificationTemplate;
  };
  messageMapping?: {
    [eventType: string]: MessageTemplate;
  };
}

interface NotificationTemplate {
  targetType: 'user' | 'client' | 'broadcast';
  userId?: string | ((detail: any) => string);
  clientId?: string | ((detail: any) => string);
  title: string | ((detail: any) => string);
  content: string | ((detail: any) => string);
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  
  // Rich UI metadata
  icon?: string | ((detail: any) => string);
  category?: string | ((detail: any) => string);
  actionUrl?: string | ((detail: any) => string);
  tags?: string[] | ((detail: any) => string[]);
  displayDuration?: number | ((detail: any) => number);
  sound?: string | ((detail: any) => string);
  metadata?: Record<string, any> | ((detail: any) => Record<string, any>);
  
  // Advanced targeting
  targetUserIds?: string[] | ((detail: any) => string[]); // For client notifications
  targetClientIds?: string[] | ((detail: any) => string[]); // For broadcast notifications
}
```

### API Gateway Configuration
```typescript
interface ApiGatewayConfig {
  existingMessagesApi?: apigateway.RestApi;
  existingNotificationsApi?: apigateway.RestApi;
  existingChannelsApi?: apigateway.RestApi;  // If separate from messages API
  separateApis?: boolean;                    // Default: true
  messagesBasePath?: string;                 // Default: '/messages'
  notificationsBasePath?: string;            // Default: '/notifications'
  channelsBasePath?: string;                 // Default: '/channels'
}
```

**Important Notes:**
- **Channels API:** By default, channels are attached to the same API as messages (`existingMessagesApi`)
- If you want channels on a separate API, provide `existingChannelsApi`
- If using `separateApis: false`, all three services (messages, notifications, channels) will be on the same API Gateway

### Stack Configuration
```typescript
interface NotificationMessagingStackProps {
  resourcePrefix?: string;                   // Default: 'kx-notifications'
  eventSubscriptions?: EventSubscription[];
  eventBridgeRules?: EventBridgeRuleConfig[];
  eventBridgeBusName?: string;
  existingEventBus?: events.EventBus;
  enableFullTextSearch?: boolean;            // Default: true
  ttlAttributeName?: string;                 // Default: 'expiresAt'
  apiGatewayConfig?: ApiGatewayConfig;
  
  // Performance tuning
  internalEventConsumerProps?: {
    enableProvisionedConcurrency?: boolean;
    provisionedConcurrency?: number;
  };
  
  // Infrastructure
  vpcConfig?: {
    vpcId?: string;
    subnetIds?: string[];
    securityGroupIds?: string[];
  };
  lambdaEnvironment?: Record<string, string>;
}
```

## Advanced Examples

### Dynamic Content with Rich Metadata
```typescript
notificationMapping: {
  'order.shipped': {
    targetType: 'user',
    userId: (detail) => detail.customerId,
    title: (detail) => `Order #${detail.orderId} Update`,
    content: (detail) => `Your ${detail.productName} has shipped! Estimated delivery: ${detail.estimatedDelivery}`,
    priority: 'medium',
    
    // Rich UI metadata
    icon: '📦',
    category: 'orders',
    actionUrl: (detail) => `/orders/${detail.orderId}/track`,
    tags: ['shipping', 'order'],
    displayDuration: 0, // Don't auto-dismiss
    sound: 'notification-success',
    
    metadata: (detail) => ({
      orderId: detail.orderId,
      trackingNumber: detail.trackingNumber,
      trackingUrl: `https://track.com/${detail.trackingNumber}`,
      estimatedDelivery: detail.estimatedDelivery,
      carrier: detail.carrier
    })
  }
}
```

### Conditional Targeting
```typescript
notificationMapping: {
  'incident.created': {
    targetType: 'client',
    clientId: (detail) => detail.affectedClientId,
    
    // Only notify specific users based on severity
    targetUserIds: (detail) => {
      if (detail.severity === 'critical') {
        return [...detail.oncallEngineers, ...detail.managers];
      } else if (detail.severity === 'high') {
        return detail.oncallEngineers;
      }
      return detail.teamMembers;
    },
    
    title: (detail) => `${detail.severity.toUpperCase()} Incident`,
    content: (detail) => `${detail.title} - Immediate attention required`,
    priority: (detail) => detail.severity === 'critical' ? 'urgent' : 'high'
  }
}
```

## Troubleshooting

### Common Issues

#### "Function not found" during deployment
**Problem**: API Gateway tries to reference Lambda functions before they're created.
**Solution**: The package handles this automatically with proper CDK dependencies. If you encounter this, ensure you're using the latest version.

#### Empty results from notifications API
**Problem**: Query parameters not properly formatted.
**Solution**: Ensure `userId` and `tenantId` are provided as query parameters:
```bash
# ✅ Correct
curl "/notifications?userId=user123&tenantId=client456"

# ❌ Incorrect  
curl "/notifications" -d '{"userId":"user123"}'
```

#### Events not triggering notifications
**Problem**: Event pattern doesn't match incoming events.
**Solution**: Check event pattern matching:
```typescript
// Make sure your event pattern matches exactly
eventPattern: {
  source: ['your-actual-source'],        // Must match event.source
  detailType: ['your-actual-detail-type'] // Must match event['detail-type']
}
```

### Debug Mode
Enable detailed logging:
```typescript
new NotificationMessagingStack(this, 'Notifications', {
  lambdaEnvironment: {
    LOG_LEVEL: 'DEBUG'
  }
});
```

## Performance Considerations

### Cold Start Optimization
The package includes several cold start optimizations:
- Pre-initialized AWS SDK clients
- Cached event subscriptions
- Provisioned concurrency options
- Optimized bundling

### Scaling
- DynamoDB tables use on-demand billing by default
- Lambda functions have reserved concurrency to prevent cold starts
- EventBridge handles high-volume event processing automatically

### Cost Optimization
- TTL enabled for automatic cleanup of old records
- Sparse indexing for efficient queries
- Pay-per-request DynamoDB billing
- Minimal Lambda execution time

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

- 📖 [Documentation](https://github.com/your-org/kx-notifications-and-messaging-cdk)
- 🐛 [Issues](https://github.com/your-org/kx-notifications-and-messaging-cdk/issues)
- 💬 [Discussions](https://github.com/your-org/kx-notifications-and-messaging-cdk/discussions)

---

## Changelog

### v1.1.21 - Latest
- **📋 NEW**: POST /channels now only accepts object array format for participants
- **✅ SIMPLIFIED**: Format: `[{ userId: "x", userName: "Name" }]` (no index pairing needed)
- **🔧 BREAKING**: Removed legacy string array + participantNames object format
- **📝 DOCS**: Updated README with cleaner participant format and examples

**Migration from v1.1.20:**
```typescript
// ❌ OLD (v1.1.20)
{
  participants: ["user-1", "user-2"],
  participantNames: {
    "user-1": "John",
    "user-2": "Jane"
  }
}

// ✅ NEW (v1.1.21+)
{
  participants: [
    { userId: "user-1", userName: "John" },
    { userId: "user-2", userName: "Jane" }
  ]
}
```

### v1.1.20 (Deprecated - Use v1.1.21+)
- **📋 NEW**: GET /channels now returns `participantDetails` array with userId, userName, role, and joinedAt
- **📋 NEW**: POST /channels accepted both object array and legacy string array formats
- **📋 NEW**: POST /channels/{id}/join accepts optional `userName` in body
- **📋 NEW**: POST /channels/{id}/claim accepts optional `userName` in body
- **📋 NEW**: POST /channels/{id}/assign-bot accepts optional `botName` in body
- **✅ IMPROVED**: No need for separate lookups - participant names included in channel response
- **✅ IMPROVED**: Participant names stored in `metadata.userName` field in participants table

### v1.1.19
- **📋 NEW**: Added `userId` query parameter to GET /channels (defaults to authenticated user)
- **📋 NEW**: Added `includeAnonymous` query parameter to GET /channels (defaults to `true`)
- **✅ IMPROVED**: Single API call now returns both user's channels AND unclaimed lead channels
- **✅ IMPROVED**: Can exclude anonymous/unclaimed leads with `?includeAnonymous=false`

### v1.1.18
- **🚨 CRITICAL FIX**: Internal event consumer now handles `targetType: 'channel'` for chat messages
- **🔧 FIXED**: Added channel case to `buildTargetKey` function (was throwing "Unknown target type: channel")
- **🔧 FIXED**: Chat messages now properly store `channelId`, `senderId`, and `messageType: 'chat'`
- **✅ VERIFIED**: EventBridge → chat message storage now works end-to-end

### v1.1.17
- **🔧 FIXED**: Added `channelId` and `senderId` fields to `MessageTemplate` interface
- **✅ VERIFIED**: Chat message subscriptions now work correctly with TypeScript

### v1.1.15
- **🚨 CRITICAL FIX**: Channels Lambda now has EventBridge PutEvents permission
- **🔧 FIXED**: Resolved `AccessDeniedException` when creating channels or performing channel actions
- **✅ VERIFIED**: Channel event publishing (channel.created, lead.created, etc.) now works correctly

### v1.1.14
- **📋 NEW**: Full support for chat channels API on existing API Gateway
- **🔧 FIXED**: Channels now properly attach to consumer-provided API Gateway
- **🔧 FIXED**: Channel creation now respects `body.participants` without adding duplicates or 'anonymous' users
- **🚨 CRITICAL FIX**: Resolved DynamoDB ValidationException - "The provided key element does not match the schema"
- **🔧 FIXED**: Added `channelCreatedAt` field to participants table for efficient channel lookups
- **📋 NEW**: Added `channelId-index` GSI to channels table for querying by channelId alone
- **🔧 FIXED**: All channel operations (join, claim, assign-bot) now properly store and use `channelCreatedAt`
- **✅ BACKWARD COMPATIBLE**: `listChannels` now handles legacy participant records without `channelCreatedAt` field
- **📋 NEW**: Added `existingChannelsApi` and `channelsBasePath` configuration options
- **📝 DOCS**: Updated README with complete channels API Gateway integration documentation
- **✅ VERIFIED**: Channels API routes (`/channels`, `/channels/{channelId}`, `/channels/{channelId}/{action}`) properly deployed
- **✅ VERIFIED**: POST /channels with explicit participants array works correctly
- **✅ VERIFIED**: All DynamoDB operations now use correct composite keys (channelId + createdAt)
- **✅ VERIFIED**: Works with existing data - falls back to GSI query for legacy records

### v1.1.11
- **🚨 CRITICAL FIX**: Fixed notifications API returning empty results when querying by `tenantId`
- **🔧 FIXED**: Implemented proper multi-target DynamoDB queries for user, client, and broadcast notifications
- **✅ VERIFIED**: `GET /notifications?tenantId=X` now returns client-targeted and broadcast notifications
- **📋 NEW**: Support for combined queries: `?tenantId=X&userId=Y` returns all relevant notifications

### v1.1.10
- **🚨 CRITICAL FIX**: Lambda deployment ordering issue resolved ("Function not found" during deployment)
- **🔧 FIXED**: Added explicit CDK dependencies to ensure Lambda functions created before API Gateway methods
- **✅ VERIFIED**: Deployment now works in correct order: Lambda functions first, then API Gateway integration

### v1.1.9
- **🚨 CRITICAL FIX**: Lambda physical name validation error resolved (cross-environment fashion error)
- **🔧 FIXED**: Added explicit `functionName` properties using `resourcePrefix` for deterministic naming
- **✅ VERIFIED**: Cross-environment deployments now work without naming conflicts

### v1.1.8
- **🔧 FIXED**: API Gateway integration bug when using `separateApis: false`
- **📋 NEW**: Enhanced error handling and validation
- **⚡ IMPROVED**: Better cold start performance with optimized bundling

### v1.1.7
- **📋 NEW**: Added support for rich UI metadata (icons, categories, action URLs, tags, sounds)
- **📋 NEW**: Advanced targeting options (targetUserIds, targetClientIds)
- **⚡ IMPROVED**: Enhanced fanout logic with better error handling

### v1.1.6
- **📋 NEW**: Blackbox event processing - automatic notification/message creation from EventBridge events
- **📋 NEW**: Event subscriptions with configurable templates
- **📋 NEW**: Multi-target support (user, client, broadcast)

### v1.1.5
- **🔧 FIXED**: API Gateway construct naming conflicts when using same API for both services
- **📋 NEW**: Support for existing API Gateway integration
- **⚡ IMPROVED**: Better separation of concerns between messages and notifications services

### v1.1.0 - v1.1.4
- Initial releases with basic functionality
- DynamoDB tables and REST APIs
- EventBridge integration
- Various bug fixes and improvements

