import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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
          // Get specific notification
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
              message: `Get notification ${pathParameters.id}`,
              method,
              service: 'NotificationsService'
            })
          };
        } else {
          // List notifications
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ 
              notifications: [],
              method,
              service: 'NotificationsService',
              query: queryStringParameters
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

