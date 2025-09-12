import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

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
        // Create message
        return {
          statusCode: 201,
          headers: corsHeaders,
          body: JSON.stringify({ 
            message: 'Message created',
            method,
            service: 'MessagesService',
            data: body
          })
        };

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

