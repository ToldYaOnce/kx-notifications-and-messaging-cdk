import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NotificationMessagingStack } from '../src/stacks/notifications-messaging-stack';

/**
 * Example: Complete Chat Channels Setup
 * 
 * This example shows how to set up the full chat channels functionality
 * including lead management, bot assignment, and real-time messaging.
 */

export class ChatChannelsExampleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the notifications and messaging stack with chat channels
    const messagingStack = new NotificationMessagingStack(this, 'ChatMessaging', {
      resourcePrefix: 'chat-demo',
      
      // EventBridge configuration for real-time events
      eventSubscriptions: [
        {
          name: 'LeadChannelCreated',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            'detail-type': ['channel.created'],
            detail: {
              channelType: ['lead']
            }
          },
          targets: [
            {
              id: 'NotifyEmployees',
              arn: 'arn:aws:lambda:us-east-1:123456789012:function:notify-employees-new-lead'
            }
          ]
        },
        {
          name: 'ChatMessageSent',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            'detail-type': ['chat.message.sent']
          },
          targets: [
            {
              id: 'WebSocketBroadcast',
              arn: 'arn:aws:lambda:us-east-1:123456789012:function:websocket-broadcast'
            }
          ]
        },
        {
          name: 'LeadClaimed',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            'detail-type': ['channel.claimed']
          },
          targets: [
            {
              id: 'UpdateCRM',
              arn: 'arn:aws:lambda:us-east-1:123456789012:function:update-crm-lead-status'
            }
          ]
        }
      ]
    });

    // Output the API endpoints for integration
    new cdk.CfnOutput(this, 'ChatApiEndpoints', {
      value: JSON.stringify({
        messages: messagingStack.messagesApi.url,
        notifications: messagingStack.notificationsApi.url,
        channels: messagingStack.channelsApi.url
      }),
      description: 'Chat API endpoints for frontend integration'
    });

    // Output table names for consumer stack integration
    new cdk.CfnOutput(this, 'ChatTableNames', {
      value: JSON.stringify({
        messages: messagingStack.dynamoTables.messagesTable.tableName,
        notifications: messagingStack.dynamoTables.notificationsTable.tableName,
        channels: messagingStack.dynamoTables.channelsTable.tableName,
        participants: messagingStack.dynamoTables.channelParticipantsTable.tableName
      }),
      description: 'DynamoDB table names for consumer stack'
    });
  }
}

/**
 * Usage Examples:
 */

// 1. Create a new lead channel when visitor starts chat
const createLeadChannelExample = {
  method: 'POST',
  url: '/channels',
  body: {
    channelType: 'lead',
    title: 'New Website Visitor',
    participants: ['lead-visitor-123'], // Lead's ID
    botEmployeeId: 'employee-456', // Random employee for bot personality
    metadata: {
      visitorInfo: {
        page: '/pricing',
        referrer: 'google',
        location: 'New York, NY'
      }
    }
  }
};

// 2. Send a chat message in the channel
const sendChatMessageExample = {
  method: 'POST',
  url: '/messages',
  body: {
    targetType: 'channel',
    channelId: 'channel-789',
    messageType: 'chat',
    content: 'Hello! How can I help you today?',
    senderId: 'bot-employee-456'
  }
};

// 3. Claim a lead (employee takes over from bot)
const claimLeadExample = {
  method: 'POST',
  url: '/channels/channel-789/claim',
  body: {
    // Employee ID will be extracted from auth context
  }
};

// 4. Get channels for an employee (their channels + unclaimed leads)
const getChannelsExample = {
  method: 'GET',
  url: '/channels?limit=50',
  headers: {
    'Authorization': 'Bearer employee-token'
  }
};

// 5. Get chat history for a channel
const getChatHistoryExample = {
  method: 'GET',
  url: '/messages?channelId=channel-789&limit=50&messageType=chat'
};

/**
 * EventBridge Events Generated:
 */

// When lead starts chat:
const leadChannelCreatedEvent = {
  source: 'kx-notifications-messaging',
  'detail-type': 'channel.created',
  detail: {
    eventId: '1234567890-abc123',
    eventType: 'channel.created',
    userId: 'lead-visitor-123',
    itemId: 'channel-789',
    timestamp: '2024-01-15T10:30:00Z',
    channelType: 'lead',
    tenantId: 'tenant-123',
    participantCount: 2,
    leadStatus: 'unclaimed'
  }
};

// When chat message is sent:
const chatMessageSentEvent = {
  source: 'kx-notifications-messaging',
  'detail-type': 'chat.message.sent',
  detail: {
    eventId: '1234567890-def456',
    eventType: 'chat.message.sent',
    userId: 'bot-employee-456',
    itemId: 'message-abc123',
    timestamp: '2024-01-15T10:31:00Z',
    targetType: 'channel',
    messageType: 'chat',
    channelId: 'channel-789',
    tenantId: 'tenant-123',
    priority: 'medium'
  }
};

// When employee claims lead:
const leadClaimedEvent = {
  source: 'kx-notifications-messaging',
  'detail-type': 'channel.claimed',
  detail: {
    eventId: '1234567890-ghi789',
    eventType: 'channel.claimed',
    userId: 'employee-789',
    itemId: 'channel-789',
    timestamp: '2024-01-15T10:35:00Z',
    tenantId: 'tenant-123',
    claimedBy: 'employee-789'
  }
};

/**
 * Database Schema Examples:
 */

// Channel record in channels table:
const channelRecord = {
  channelId: 'channel-789',
  createdAt: '2024-01-15T10:30:00Z',
  channelType: 'lead',
  tenantId: 'tenant-123',
  title: 'New Website Visitor',
  leadStatus: 'claimed',
  claimedBy: 'employee-789',
  botEmployeeId: 'employee-456',
  participants: ['lead-visitor-123', 'bot-employee-456', 'employee-789'],
  lastActivity: '2024-01-15T10:35:00Z',
  lastMessage: {
    content: 'I can help you with that!',
    senderId: 'employee-789',
    timestamp: '2024-01-15T10:35:00Z',
    messageId: 'message-xyz789'
  }
};

// Participant record in channel-participants table:
const participantRecord = {
  userId: 'employee-789',
  channelId: 'channel-789',
  tenantId: 'tenant-123',
  role: 'employee',
  joinedAt: '2024-01-15T10:35:00Z',
  isActive: true
};

// Chat message in messages table:
const chatMessageRecord = {
  messageId: 'message-xyz789',
  targetKey: 'channel#channel-789',
  dateReceived: '2024-01-15T10:35:00Z',
  createdAt: '2024-01-15T10:35:00Z',
  targetType: 'channel',
  content: 'I can help you with that!',
  priority: 'medium',
  messageType: 'chat',
  channelId: 'channel-789',
  senderId: 'employee-789',
  metadata: {
    tenantId: 'tenant-123',
    isRealTimeMessage: true
  }
};

export {
  createLeadChannelExample,
  sendChatMessageExample,
  claimLeadExample,
  getChannelsExample,
  getChatHistoryExample,
  leadChannelCreatedEvent,
  chatMessageSentEvent,
  leadClaimedEvent,
  channelRecord,
  participantRecord,
  chatMessageRecord
};

