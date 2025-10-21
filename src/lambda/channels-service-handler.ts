import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { v4 as uuidv4 } from 'uuid';
import { Channel, ChannelParticipant } from '../types';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Channels service handler called:', JSON.stringify(event, null, 2));
  
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

    // Extract user info from auth context (you'll need to implement this based on your auth)
    const userId = extractUserIdFromEvent(event);
    const tenantId = extractTenantIdFromEvent(event);
    const isAdmin = extractIsAdminFromEvent(event);

    switch (method) {
      case 'GET':
        if (pathParameters.channelId) {
          // Get specific channel
          return await getChannel(pathParameters.channelId, userId, tenantId, isAdmin, corsHeaders);
        } else {
          // List channels for user
          return await listChannels(userId, tenantId, isAdmin, queryStringParameters, corsHeaders);
        }

      case 'POST':
        if (pathParameters.channelId && pathParameters.action) {
          // Channel actions (join, leave, claim, etc.)
          return await handleChannelAction(pathParameters.channelId, pathParameters.action, userId, tenantId, body, corsHeaders);
        } else {
          // Create new channel
          return await createChannel(body, userId, tenantId, corsHeaders);
        }

      case 'PUT':
      case 'PATCH':
        // Update channel
        if (!pathParameters.channelId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'channelId is required' })
          };
        }
        return await updateChannel(pathParameters.channelId, body, userId, tenantId, isAdmin, corsHeaders);

      case 'DELETE':
        // Delete/archive channel
        if (!pathParameters.channelId) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'channelId is required' })
          };
        }
        return await deleteChannel(pathParameters.channelId, userId, tenantId, isAdmin, corsHeaders);

      default:
        return {
          statusCode: 405,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Channels service error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        service: 'ChannelsService'
      })
    };
  }
};

/**
 * Create a new channel
 */
async function createChannel(body: any, userId: string, tenantId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const channelId = uuidv4();
  const now = new Date().toISOString();
  
  // Parse participants - expects array of objects: [{ userId: "x", userName: "Name" }]
  let participantsData: Array<{ userId: string; userName?: string }> = body.participants || [{ userId, userName: undefined }];
  
  // Ensure authenticated user is in participants (unless 'anonymous')
  if (userId !== 'anonymous' && !participantsData.some(p => p.userId === userId)) {
    participantsData = [{ userId, userName: undefined }, ...participantsData];
  }
  
  // Remove 'anonymous' participants
  participantsData = participantsData.filter(p => p.userId !== 'anonymous');
  
  const channel: Channel = {
    channelId,
    createdAt: now,
    channelType: body.channelType || 'group',
    tenantId,
    title: body.title,
    participants: participantsData.map(p => p.userId),
    lastActivity: now,
    leadStatus: body.channelType === 'lead' ? 'unclaimed' : undefined,
    botEmployeeId: body.botEmployeeId,
    metadata: body.metadata || {}
  };

  // Save channel
  await dynamodb.send(new PutCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    Item: channel
  }));

  // Add participants with names
  const participantItems = participantsData.map(participantData => ({
    userId: participantData.userId,
    channelId,
    channelCreatedAt: now, // Store channel's createdAt for efficient lookups
    tenantId,
    role: participantData.userId === userId ? 'employee' : (body.channelType === 'lead' && participantData.userId !== userId ? 'lead' : 'employee'),
    joinedAt: now,
    isActive: true,
    metadata: {
      userName: participantData.userName || participantData.userId // Store participant name or fall back to userId
    }
  }));

  if (participantItems.length > 0) {
    const batchItems = participantItems.map(item => ({
      PutRequest: { Item: item }
    }));

    await dynamodb.send(new BatchWriteCommand({
      RequestItems: {
        [process.env.CHANNEL_PARTICIPANTS_TABLE_NAME!]: batchItems
      }
    }));
  }

  // Publish EventBridge event
  await publishChannelEvent('channel.created', channelId, userId, {
    channelType: channel.channelType,
    tenantId,
    participantCount: channel.participants.length,
    leadStatus: channel.leadStatus
  });

  // If it's a lead channel, notify all tenant employees about new unclaimed lead
  if (channel.channelType === 'lead' && channel.leadStatus === 'unclaimed') {
    await publishChannelEvent('lead.created', channelId, userId, {
      tenantId,
      channelId,
      leadStatus: 'unclaimed',
      botEmployeeId: channel.botEmployeeId
    });
  }

  return {
    statusCode: 201,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      channel,
      message: 'Channel created successfully'
    })
  };
}

/**
 * List channels for a user
 */
async function listChannels(userId: string, tenantId: string, isAdmin: boolean, queryParams: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const channels: Channel[] = [];
  
  // Support userId from query parameter (for flexibility)
  const targetUserId = queryParams.userId || userId;
  
  // Support includeAnonymous flag (defaults to true for backward compatibility)
  const includeAnonymous = queryParams.includeAnonymous !== 'false'; // Only false if explicitly set to 'false'
  
  if (isAdmin) {
    // Admins can see all tenant channels
    const result = await dynamodb.send(new QueryCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      IndexName: 'tenantId-lastActivity-index',
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId
      },
      ScanIndexForward: false, // Most recent first
      Limit: parseInt(queryParams.limit || '50')
    }));
    
    channels.push(...(result.Items as Channel[] || []));
  } else {
    // Regular users see their channels + optionally unclaimed leads from their tenant
    
    // 1. Get user's channels
    const userChannelsResult = await dynamodb.send(new QueryCommand({
      TableName: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME!,
      KeyConditionExpression: 'userId = :userId',
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':userId': targetUserId,
        ':isActive': true
      }
    }));

    // Get channel details for user's channels
    if (userChannelsResult.Items && userChannelsResult.Items.length > 0) {
      for (const participant of userChannelsResult.Items) {
        let channel;
        
        // Try to use stored channelCreatedAt if available (new records)
        if (participant.channelCreatedAt) {
          const channelResult = await dynamodb.send(new GetCommand({
            TableName: process.env.CHANNELS_TABLE_NAME!,
            Key: {
              channelId: participant.channelId,
              createdAt: participant.channelCreatedAt
            }
          }));
          channel = channelResult.Item;
        } else {
          // Fallback for legacy records: use channelId-index GSI
          const channelQueryResult = await dynamodb.send(new QueryCommand({
            TableName: process.env.CHANNELS_TABLE_NAME!,
            IndexName: 'channelId-index',
            KeyConditionExpression: 'channelId = :channelId',
            ExpressionAttributeValues: {
              ':channelId': participant.channelId
            },
            Limit: 1
          }));
          channel = channelQueryResult.Items?.[0];
        }
        
        if (channel) {
          channels.push(channel as Channel);
        }
      }
    }

    // 2. Get unclaimed leads from tenant (if includeAnonymous is true)
    if (includeAnonymous) {
      const unclaimedLeadsResult = await dynamodb.send(new QueryCommand({
        TableName: process.env.CHANNELS_TABLE_NAME!,
        IndexName: 'tenantId-leadStatus-index',
        KeyConditionExpression: 'tenantId = :tenantId AND leadStatus = :leadStatus',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':leadStatus': 'unclaimed'
        },
        ScanIndexForward: false // Most recent first
      }));

      if (unclaimedLeadsResult.Items) {
        channels.push(...(unclaimedLeadsResult.Items as Channel[]));
      }
    }
  }

  // Sort by last activity (most recent first)
  channels.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  // Enrich channels with participant details
  const enrichedChannels = await Promise.all(channels.map(async (channel) => {
    // Get participant details for this channel
    const participantsResult = await dynamodb.send(new QueryCommand({
      TableName: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME!,
      IndexName: 'channelId-userId-index',
      KeyConditionExpression: 'channelId = :channelId',
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: {
        ':channelId': channel.channelId,
        ':isActive': true
      }
    }));

    const participantDetails = participantsResult.Items?.map((p: any) => ({
      userId: p.userId,
      role: p.role,
      joinedAt: p.joinedAt,
      userName: p.metadata?.userName || p.userId // Fall back to userId if no userName
    })) || [];

    return {
      ...channel,
      participantDetails // Add enriched participant info
    };
  }));

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      channels: enrichedChannels,
      count: enrichedChannels.length,
      isAdmin,
      queryParams: {
        userId: targetUserId,
        tenantId,
        includeAnonymous
      }
    })
  };
}

/**
 * Handle channel actions (join, leave, claim, etc.)
 */
async function handleChannelAction(channelId: string, action: string, userId: string, tenantId: string, body: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  switch (action) {
    case 'join':
      return await joinChannel(channelId, userId, tenantId, body, corsHeaders);
    case 'leave':
      return await leaveChannel(channelId, userId, corsHeaders);
    case 'claim':
      return await claimLead(channelId, userId, tenantId, body, corsHeaders);
    case 'assign-bot':
      return await assignBot(channelId, body.botEmployeeId, userId, tenantId, body, corsHeaders);
    default:
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid action' })
      };
  }
}

/**
 * Join a channel
 */
async function joinChannel(channelId: string, userId: string, tenantId: string, body: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const now = new Date().toISOString();
  
  // First, get the channel to retrieve its createdAt timestamp
  // We need to query using GSI since we don't have createdAt yet
  const channelQueryResult = await dynamodb.send(new QueryCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    IndexName: 'channelId-index', // Assumes GSI exists on channelId
    KeyConditionExpression: 'channelId = :channelId',
    ExpressionAttributeValues: {
      ':channelId': channelId
    },
    Limit: 1
  }));
  
  if (!channelQueryResult.Items || channelQueryResult.Items.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Channel not found' })
    };
  }
  
  const channel = channelQueryResult.Items[0];
  
  // Add user to participants
  await dynamodb.send(new PutCommand({
    TableName: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME!,
    Item: {
      userId,
      channelId,
      channelCreatedAt: channel.createdAt, // Store channel's createdAt
      tenantId,
      role: 'employee',
      joinedAt: now,
      isActive: true,
      metadata: {
        userName: body?.userName || userId // Store participant name if provided
      }
    }
  }));

  // Update channel participants list and last activity
  await dynamodb.send(new UpdateCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    Key: { channelId, createdAt: channel.createdAt },
    UpdateExpression: 'SET lastActivity = :now',
    ExpressionAttributeValues: {
      ':now': now
    }
  }));

  // Publish event
  await publishChannelEvent('user.joined.channel', channelId, userId, { tenantId });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Joined channel successfully'
    })
  };
}

/**
 * Claim a lead (remove bot, add employee)
 */
async function claimLead(channelId: string, userId: string, tenantId: string, body: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const now = new Date().toISOString();

  // First, get the channel to retrieve its createdAt timestamp
  const channelQueryResult = await dynamodb.send(new QueryCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    IndexName: 'channelId-index',
    KeyConditionExpression: 'channelId = :channelId',
    ExpressionAttributeValues: {
      ':channelId': channelId
    },
    Limit: 1
  }));
  
  if (!channelQueryResult.Items || channelQueryResult.Items.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Channel not found' })
    };
  }
  
  const channel = channelQueryResult.Items[0];

  // Update channel to claimed status
  await dynamodb.send(new UpdateCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    Key: { channelId, createdAt: channel.createdAt },
    UpdateExpression: 'SET leadStatus = :claimed, claimedBy = :userId, lastActivity = :now',
    ExpressionAttributeValues: {
      ':claimed': 'claimed',
      ':userId': userId,
      ':now': now
    }
  }));

  // Add employee to channel if not already there
  await dynamodb.send(new PutCommand({
    TableName: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME!,
    Item: {
      userId,
      channelId,
      channelCreatedAt: channel.createdAt, // Store channel's createdAt
      tenantId,
      role: 'employee',
      joinedAt: now,
      isActive: true,
      metadata: {
        userName: body?.userName || userId // Store participant name if provided
      }
    },
    ConditionExpression: 'attribute_not_exists(userId)'
  }));

  // Publish event
  await publishChannelEvent('channel.claimed', channelId, userId, { 
    tenantId,
    claimedBy: userId
  });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Lead claimed successfully'
    })
  };
}

/**
 * Assign bot to channel
 */
async function assignBot(channelId: string, botEmployeeId: string, userId: string, tenantId: string, body: any, corsHeaders: any): Promise<APIGatewayProxyResult> {
  const now = new Date().toISOString();
  const botUserId = `bot-${botEmployeeId}`;

  // First, get the channel to retrieve its createdAt timestamp
  const channelQueryResult = await dynamodb.send(new QueryCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    IndexName: 'channelId-index',
    KeyConditionExpression: 'channelId = :channelId',
    ExpressionAttributeValues: {
      ':channelId': channelId
    },
    Limit: 1
  }));
  
  if (!channelQueryResult.Items || channelQueryResult.Items.length === 0) {
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Channel not found' })
    };
  }
  
  const channel = channelQueryResult.Items[0];

  // Update channel with bot assignment
  await dynamodb.send(new UpdateCommand({
    TableName: process.env.CHANNELS_TABLE_NAME!,
    Key: { channelId, createdAt: channel.createdAt },
    UpdateExpression: 'SET botEmployeeId = :botEmployeeId, lastActivity = :now',
    ExpressionAttributeValues: {
      ':botEmployeeId': botEmployeeId,
      ':now': now
    }
  }));

  // Add bot to participants
  await dynamodb.send(new PutCommand({
    TableName: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME!,
    Item: {
      userId: botUserId,
      channelId,
      channelCreatedAt: channel.createdAt, // Store channel's createdAt
      tenantId,
      role: 'bot',
      joinedAt: now,
      isActive: true,
      metadata: { 
        employeeId: botEmployeeId,
        userName: body?.botName || `Bot-${botEmployeeId}` // Store bot display name
      }
    }
  }));

  // Publish event
  await publishChannelEvent('lead.assigned.bot', channelId, userId, {
    tenantId,
    botEmployeeId,
    botUserId
  });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Bot assigned successfully',
      botUserId
    })
  };
}

/**
 * Publish EventBridge event
 */
async function publishChannelEvent(eventType: string, channelId: string, userId: string, metadata: any = {}) {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'kx-notifications-messaging',
      DetailType: eventType,
      Detail: JSON.stringify({
        eventId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        eventType,
        userId,
        itemId: channelId,
        timestamp: new Date().toISOString(),
        ...metadata
      }),
      EventBusName: process.env.EVENT_BUS_NAME
    }]
  }));
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

/**
 * Extract admin status from auth context
 */
function extractIsAdminFromEvent(event: APIGatewayProxyEvent): boolean {
  // Implement based on your auth setup
  const roles = event.requestContext?.authorizer?.roles || 
                event.requestContext?.authorizer?.claims?.roles || 
                [];
  return Array.isArray(roles) ? roles.includes('admin') : false;
}

/**
 * Get specific channel (with permission check)
 */
async function getChannel(channelId: string, userId: string, tenantId: string, isAdmin: boolean, corsHeaders: any): Promise<APIGatewayProxyResult> {
  // Implementation for getting a specific channel
  // Include permission checks based on user role and channel membership
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Get channel - implement based on your needs'
    })
  };
}

/**
 * Update channel
 */
async function updateChannel(channelId: string, body: any, userId: string, tenantId: string, isAdmin: boolean, corsHeaders: any): Promise<APIGatewayProxyResult> {
  // Implementation for updating channel
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Update channel - implement based on your needs'
    })
  };
}

/**
 * Delete/archive channel
 */
async function deleteChannel(channelId: string, userId: string, tenantId: string, isAdmin: boolean, corsHeaders: any): Promise<APIGatewayProxyResult> {
  // Implementation for deleting/archiving channel
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Delete channel - implement based on your needs'
    })
  };
}

/**
 * Leave channel
 */
async function leaveChannel(channelId: string, userId: string, corsHeaders: any): Promise<APIGatewayProxyResult> {
  // Implementation for leaving channel
  
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      message: 'Leave channel - implement based on your needs'
    })
  };
}
