import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('🚀 Messages service handler called:', JSON.stringify(event, null, 2));
  console.log('📊 Environment check:', {
    MESSAGES_TABLE_NAME: process.env.MESSAGES_TABLE_NAME,
    AWS_REGION: process.env.AWS_REGION,
    EVENTBRIDGE_NAME: process.env.EVENTBRIDGE_NAME
  });
  
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
  };

  try {
    console.log('✅ Entered try block');
    const method = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const queryStringParameters = event.queryStringParameters || {};
    console.log('📝 Parsed parameters:', { method, pathParameters, queryStringParameters });
    const body = event.body ? JSON.parse(event.body) : null;

    // Basic routing based on HTTP method
    console.log('🔀 Routing based on method:', method);
    switch (method) {
      case 'GET':
        console.log('📥 GET request - checking pathParameters.id:', pathParameters.id);
        if (pathParameters.id) {
          // Get specific message
          console.log('🎯 Calling getMessage for id:', pathParameters.id);
          return await getMessage(pathParameters.id, corsHeaders);
        } else {
          // List messages
          console.log('📋 Calling listMessages with queryParams:', queryStringParameters);
          return await listMessages(queryStringParameters, corsHeaders);
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
    console.error('❌ Messages service FATAL error:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    console.error('❌ Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        service: 'MessagesService',
        message: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error
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
 * List messages with optional filtering
 */
async function listMessages(queryParams: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    console.log('🔍 listMessages ENTERED with queryParams:', JSON.stringify(queryParams, null, 2));
    const { channelId, userId, tenantId, limit = '50' } = queryParams;
    
    console.log('📦 listMessages extracted params:', { channelId, userId, tenantId, limit });
    console.log('🗄️  Table name from env:', process.env.MESSAGES_TABLE_NAME);
    
    // If channelId is provided, query by targetKey (primary key)
    if (channelId) {
      console.log('🎯 Querying by channelId - targetKey:', `channel#${channelId}`);
      const messagesResult = await dynamodb.send(new QueryCommand({
        TableName: process.env.MESSAGES_TABLE_NAME!,
        KeyConditionExpression: 'targetKey = :targetKey',
        ExpressionAttributeValues: {
          ':targetKey': `channel#${channelId}`
        },
        ScanIndexForward: false, // Newest first
        Limit: parseInt(limit)
      }));
      console.log('✅ DynamoDB query completed. Items count:', messagesResult.Items?.length || 0);
      
      const messages = (messagesResult.Items || []).map(msg => ({
        messageId: msg.messageId,
        channelId: msg.channelId,
        senderId: msg.senderId,
        content: msg.content,
        createdAt: msg.createdAt,
        dateReceived: msg.dateReceived,
        messageType: msg.messageType,
        targetKey: msg.targetKey,
        metadata: msg.metadata
      }));
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          messages: messages.reverse(), // Oldest to newest for display
          messageCount: messages.length,
          query: queryParams
        })
      };
    }
    
    // If userId is provided, query by user targetKey (primary key)
    if (userId) {
      const messagesResult = await dynamodb.send(new QueryCommand({
        TableName: process.env.MESSAGES_TABLE_NAME!,
        KeyConditionExpression: 'targetKey = :targetKey',
        ExpressionAttributeValues: {
          ':targetKey': `user#${userId}`
        },
        ScanIndexForward: false,
        Limit: parseInt(limit)
      }));
      
      const messages = (messagesResult.Items || []).map(msg => ({
        messageId: msg.messageId,
        content: msg.content,
        title: msg.title,
        createdAt: msg.createdAt,
        dateReceived: msg.dateReceived,
        targetKey: msg.targetKey,
        metadata: msg.metadata
      }));
      
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          messages: messages.reverse(),
          messageCount: messages.length,
          query: queryParams
        })
      };
    }
    
    // No specific filter - return empty or error
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Missing required parameter',
        message: 'Either channelId or userId must be provided',
        query: queryParams
      })
    };
    
  } catch (error) {
    console.error('❌ Error listing messages:', error);
    console.error('❌ Error type:', error instanceof Error ? error.constructor.name : typeof error);
    console.error('❌ Error message:', error instanceof Error ? error.message : String(error));
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to list messages',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        queryParams
      })
    };
  }
}

/**
 * Get a specific message by ID
 */
async function getMessage(messageId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  try {
    // Use the messageId-index GSI to query by messageId
    const result = await dynamodb.send(new QueryCommand({
      TableName: process.env.MESSAGES_TABLE_NAME!,
      IndexName: 'messageId-index',
      KeyConditionExpression: 'messageId = :messageId',
      ExpressionAttributeValues: {
        ':messageId': messageId
      },
      Limit: 1
    }));
    
    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Message not found',
          messageId
        })
      };
    }
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: result.Items[0]
      })
    };
    
  } catch (error) {
    console.error('Error getting message:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to get message',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
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

