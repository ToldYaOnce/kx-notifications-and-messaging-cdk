import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Messages service handler called:', JSON.stringify(event, null, 2));
  
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
  };

  try {
    const method = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const queryStringParameters = event.queryStringParameters || {};
    const body = event.body ? JSON.parse(event.body) : null;

    // Basic routing based on HTTP method
    switch (method) {
      case 'GET':
        if (pathParameters.id) {
          // Get specific message
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
              message: `Get message ${pathParameters.id}`,
              method,
              service: 'MessagesService'
            })
          };
        } else {
          // List messages
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
              messages: [],
              method,
              service: 'MessagesService',
              query: queryStringParameters
            })
          };
        }

      case 'POST':
        // Create message (including chat messages)
        return await createMessage(body, event, corsHeaders);

      case 'PUT':
      case 'PATCH':
        // Update message
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: `Message ${pathParameters.id} updated`,
            method,
            service: 'MessagesService',
            data: body
          })
        };

      case 'DELETE':
        // Delete message
        return {
          statusCode: 204,
          headers: corsHeaders,
          body: ''
        };

      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Messages service error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        service: 'MessagesService'
      })
    };
  }
};

/**
 * Create a new message (supports both traditional messages and chat messages)
 */
async function createMessage(body: any, event: APIGatewayProxyEvent, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    const messageId = uuidv4();
    const now = new Date().toISOString();
    
    // Extract user info from auth context
    const userId = extractUserIdFromEvent(event);
    const tenantId = extractTenantIdFromEvent(event);
    
    // Determine target key and message type
    let targetKey: string;
    let messageType = body.messageType || 'notification';
    
    switch (body.targetType) {
      case 'user':
        targetKey = `user#${body.userId || userId}`;
        break;
      case 'client':
        targetKey = `client#${body.clientId}`;
        break;
      case 'broadcast':
        targetKey = 'broadcast';
        break;
      case 'channel':
        targetKey = `channel#${body.channelId}`;
        messageType = 'chat'; // Channel messages are always chat
        break;
      default:
        throw new Error('Invalid targetType');
    }
    
    // Create message record
    const message = {
      messageId,
      targetKey,
      dateReceived: now,
      createdAt: now,
      targetType: body.targetType,
      content: body.content,
      title: body.title,
      priority: body.priority || 'medium',
      
      // Chat-specific fields
      messageType,
      channelId: body.channelId,
      senderId: body.senderId || userId,
      replyToMessageId: body.replyToMessageId,
      
      metadata: {
        ...body.metadata,
        tenantId,
        isRealTimeMessage: messageType === 'chat'
      }
    };
    
    // Save to messages table
    await dynamodb.send(new PutCommand({
      TableName: process.env.MESSAGES_TABLE_NAME!,
      Item: message
    }));
    
    // For chat messages, update channel's last activity and last message
    if (messageType === 'chat' && body.channelId) {
      await updateChannelLastActivity(body.channelId, message);
    }
    
    // Publish EventBridge event
    const eventType = messageType === 'chat' ? 'chat.message.sent' : 'message.created';
    await publishMessageEvent(eventType, messageId, userId, {
      targetType: body.targetType,
      messageType,
      channelId: body.channelId,
      tenantId,
      priority: message.priority
    });
    
    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        messageId,
        messageType,
        targetType: body.targetType,
        message: 'Message created successfully'
      })
    };
    
  } catch (error) {
    console.error('Error creating message:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to create message',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

/**
 * Update channel's last activity and last message
 */
async function updateChannelLastActivity(channelId: string, message: any) {
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId },
      UpdateExpression: 'SET lastActivity = :now, lastMessage = :lastMessage',
      ExpressionAttributeValues: {
        ':now': message.createdAt,
        ':lastMessage': {
          content: message.content,
          senderId: message.senderId,
          timestamp: message.createdAt,
          messageId: message.messageId
        }
      }
    }));
  } catch (error) {
    console.error('Error updating channel last activity:', error);
    // Don't throw - message was created successfully, this is just metadata
  }
}

/**
 * Publish EventBridge event for message
 */
async function publishMessageEvent(eventType: string, messageId: string, userId: string, metadata: any = {}) {
  try {
    await eventBridge.send(new PutEventsCommand({
      Entries: [{
        Source: 'kx-notifications-messaging',
        DetailType: eventType,
        Detail: JSON.stringify({
          eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          eventType,
          userId,
          itemId: messageId,
          timestamp: new Date().toISOString(),
          ...metadata
        }),
        EventBusName: process.env.EVENT_BUS_NAME
      }]
    }));
  } catch (error) {
    console.error('Error publishing message event:', error);
    // Don't throw - message was created successfully
  }
}

/**
 * Extract user ID from auth context
 */
function extractUserIdFromEvent(event: APIGatewayProxyEvent): string {
  // Implement based on your auth setup
  return event.requestContext?.authorizer?.userId || 
         event.requestContext?.authorizer?.claims?.sub ||
         'anonymous';
}

/**
 * Extract tenant ID from auth context
 */
function extractTenantIdFromEvent(event: APIGatewayProxyEvent): string {
  // Implement based on your auth setup
  return event.requestContext?.authorizer?.tenantId || 
         event.requestContext?.authorizer?.claims?.tenantId ||
         'default';
}

