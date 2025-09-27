import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Notifications service handler called:', JSON.stringify(event, null, 2));
  
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
          // Get specific notification by ID
          const notification = await getNotificationById(pathParameters.id);
          if (!notification) {
            return {
              statusCode: 404,
              headers: corsHeaders,
              body: JSON.stringify({ 
                error: 'Notification not found',
                notificationId: pathParameters.id
              })
            };
          }
          
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
              notification,
              method,
              service: 'NotificationsService'
            })
          };
        } else {
          // List notifications - query for user, client (tenant), and broadcast notifications
          const notifications = await getNotifications(queryStringParameters);
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
              notifications,
              method,
              service: 'NotificationsService',
              query: queryStringParameters,
              count: notifications.length
            })
          };
        }

      case 'POST':
        // Create notification
        return {
          statusCode: 201,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Notification created',
            method,
            service: 'NotificationsService',
            data: body
          })
        };

      case 'PUT':
      case 'PATCH':
        // Update notification
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: `Notification ${pathParameters.id} updated`,
            method,
            service: 'NotificationsService',
            data: body
          })
        };

      case 'DELETE':
        // Delete notification
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
    console.error('Notifications service error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: 'Internal server error',
        service: 'NotificationsService'
      })
    };
  }
};

/**
 * Get a specific notification by ID
 * Note: This requires scanning since we don't know the targetKey
 */
async function getNotificationById(notificationId: string): Promise<any | null> {
  try {
    console.log(`🔍 Looking for notification ID: ${notificationId}`);
    
    // We need to scan since we don't know the targetKey
    // In a production system, you might want to add a GSI on notificationId
    const scanParams = {
      TableName: process.env.NOTIFICATIONS_TABLE_NAME!,
      FilterExpression: 'notificationId = :notificationId',
      ExpressionAttributeValues: {
        ':notificationId': notificationId
      },
      Limit: 1
    };
    
    const result = await dynamodb.send(new ScanCommand(scanParams));
    
    if (result.Items && result.Items.length > 0) {
      console.log(`✅ Found notification: ${notificationId}`);
      return result.Items[0];
    }
    
    console.log(`📭 Notification not found: ${notificationId}`);
    return null;
    
  } catch (error) {
    console.error(`❌ Error getting notification ${notificationId}:`, error);
    throw error;
  }
}

/**
 * Get notifications for a user - includes user-targeted, client-targeted, and broadcast notifications
 */
async function getNotifications(queryParams: { [key: string]: string | undefined }): Promise<any[]> {
  try {
    const { userId, tenantId, limit = '50', lastEvaluatedKey } = queryParams;
    
    console.log('🔍 Querying notifications with params:', { userId, tenantId, limit });
    
    const allNotifications: any[] = [];
    const queryLimit = Math.min(parseInt(limit), 100); // Cap at 100 for performance
    
    // Build target keys to query
    const targetKeys: string[] = [];
    
    // 1. User-targeted notifications (if userId provided)
    if (userId) {
      targetKeys.push(`user#${userId}`);
    }
    
    // 2. Client-targeted notifications (if tenantId provided) 
    if (tenantId) {
      targetKeys.push(`client#${tenantId}`);
    }
    
    // 3. Always include broadcast notifications
    targetKeys.push('broadcast');
    
    console.log('🎯 Querying target keys:', targetKeys);
    
    // Query each target key
    for (const targetKey of targetKeys) {
      try {
        const queryParams = {
          TableName: process.env.NOTIFICATIONS_TABLE_NAME!,
          KeyConditionExpression: 'targetKey = :targetKey',
          ExpressionAttributeValues: {
            ':targetKey': targetKey
          },
          ScanIndexForward: false, // Most recent first
          Limit: queryLimit
        };
        
        // Add pagination if provided
        if (lastEvaluatedKey && targetKeys.length === 1) {
          // Only use pagination for single target queries to avoid complexity
          (queryParams as any).ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
        }
        
        console.log(`📋 Querying ${targetKey}...`);
        const result = await dynamodb.send(new QueryCommand(queryParams));
        
        if (result.Items && result.Items.length > 0) {
          console.log(`✅ Found ${result.Items.length} notifications for ${targetKey}`);
          allNotifications.push(...result.Items);
        } else {
          console.log(`📭 No notifications found for ${targetKey}`);
        }
        
      } catch (queryError) {
        console.error(`❌ Error querying ${targetKey}:`, queryError);
        // Continue with other target keys even if one fails
      }
    }
    
    // Sort by dateReceived (most recent first) and limit results
    const sortedNotifications = allNotifications
      .sort((a, b) => new Date(b.dateReceived).getTime() - new Date(a.dateReceived).getTime())
      .slice(0, queryLimit);
    
    console.log(`🎉 Returning ${sortedNotifications.length} total notifications`);
    return sortedNotifications;
    
  } catch (error) {
    console.error('❌ Error in getNotifications:', error);
    throw error;
  }
}

