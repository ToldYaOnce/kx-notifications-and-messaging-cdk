import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface FanoutLambdaProps {
  /**
   * Messages table for querying client/broadcast messages
   */
  messagesTable: dynamodb.Table;
  
  /**
   * Notifications table for querying client/broadcast notifications
   */
  notificationsTable: dynamodb.Table;
  
  /**
   * Message status table for creating user interaction records
   */
  messageStatusTable: dynamodb.Table;
  
  /**
   * Channel participants table for querying channel members
   */
  channelParticipantsTable: dynamodb.Table;
  
  /**
   * Resource prefix for naming
   */
  resourcePrefix?: string;
  
  /**
   * Lambda environment variables
   */
  environment?: Record<string, string>;
}

export class FanoutLambda extends Construct {
  public readonly fanoutFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: FanoutLambdaProps) {
    super(scope, id);

    const {
      messagesTable,
      notificationsTable,
      messageStatusTable,
      channelParticipantsTable,
      resourcePrefix = 'kx-notifications',
      environment = {}
    } = props;

    // Create the fan-out Lambda function
    this.fanoutFunction = new lambda.Function(this, 'FanoutFunction', {
      functionName: `${resourcePrefix}-fanout-processor`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { DynamoDBClient, QueryCommand, PutItemCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  console.log('Fanout processor event:', JSON.stringify(event, null, 2));
  
  const results = [];
  
  for (const record of event.Records) {
    if (record.eventName === 'INSERT') {
      const item = record.dynamodb.NewImage;
      const targetKey = item.targetKey?.S;
      const messageId = item.messageId?.S || item.notificationId?.S;
      const tableName = record.eventSourceARN.split('/')[1];
      const isMessage = tableName.includes('messages');
      
      console.log(\`Processing \${record.eventName} for targetKey: \${targetKey}, messageId: \${messageId}\`);
      
      if (targetKey && messageId) {
        if (targetKey.startsWith('client#')) {
          // Client-targeted message/notification - fan out to all client users
          const clientId = targetKey.replace('client#', '');
          const result = await fanoutToClientUsers(clientId, messageId, item, isMessage);
          results.push(result);
        } else if (targetKey === 'broadcast') {
          // Broadcast message/notification - fan out to all users
          const result = await fanoutToAllUsers(messageId, item, isMessage);
          results.push(result);
        } else if (targetKey.startsWith('channel#')) {
          // Channel-targeted message - fan out to all channel participants
          const channelId = targetKey.replace('channel#', '');
          const result = await fanoutToChannelParticipants(channelId, messageId, item, isMessage);
          results.push(result);
        }
        // User-targeted messages don't need fanout - they're already targeted
      }
    }
  }
  
  return {
    statusCode: 200,
    processedRecords: event.Records.length,
    fanoutResults: results
  };
};

async function fanoutToClientUsers(clientId, messageId, messageItem, isMessage) {
  console.log(\`Fanning out to client \${clientId} users\`);
  
  try {
    // Get all users for this client (this would typically come from your user service)
    // For now, we'll simulate this - in production, you'd query your user table or service
    const clientUsers = await getClientUsers(clientId);
    
    if (clientUsers.length === 0) {
      console.log(\`No users found for client \${clientId}\`);
      return { clientId, userCount: 0, success: true };
    }
    
    // Create EventBridge events for each user (lazy evaluation - no status records created yet)
    const events = clientUsers.map(userId => ({
      Source: 'kx-notifications-messaging',
      DetailType: isMessage ? 'client.message.available' : 'client.notification.available',
      Detail: JSON.stringify({
        eventId: \`\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
        eventType: isMessage ? 'client.message.available' : 'client.notification.available',
        userId,
        clientId,
        messageId,
        targetType: 'client',
        timestamp: new Date().toISOString(),
        priority: messageItem.priority?.S,
        title: messageItem.title?.S,
        metadata: {
          fanoutSource: 'client-targeting',
          originalTargetKey: \`client#\${clientId}\`
        }
      }),
      EventBusName: process.env.EVENT_BUS_NAME
    }));
    
    // Publish events in batches (EventBridge supports up to 10 events per request)
    const batchSize = 10;
    const publishPromises = [];
    
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      publishPromises.push(
        eventBridge.send(new PutEventsCommand({ Entries: batch }))
      );
    }
    
    await Promise.all(publishPromises);
    
    console.log(\`Published \${events.length} availability events for client \${clientId}\`);
    
    return {
      clientId,
      userCount: clientUsers.length,
      eventsPublished: events.length,
      success: true
    };
    
  } catch (error) {
    console.error(\`Failed to fanout to client \${clientId}:\`, error);
    return {
      clientId,
      error: error.message,
      success: false
    };
  }
}

async function fanoutToAllUsers(messageId, messageItem, isMessage) {
  console.log('Fanning out to all users (broadcast)');
  
  try {
    // Get all users across all clients (this would typically come from your user service)
    // For now, we'll simulate this - in production, you'd query your user table or service
    const allUsers = await getAllUsers();
    
    if (allUsers.length === 0) {
      console.log('No users found for broadcast');
      return { userCount: 0, success: true };
    }
    
    // Create EventBridge events for each user (lazy evaluation)
    const events = allUsers.map(({ userId, clientId }) => ({
      Source: 'kx-notifications-messaging',
      DetailType: isMessage ? 'broadcast.message.available' : 'broadcast.notification.available',
      Detail: JSON.stringify({
        eventId: \`\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
        eventType: isMessage ? 'broadcast.message.available' : 'broadcast.notification.available',
        userId,
        clientId,
        messageId,
        targetType: 'broadcast',
        timestamp: new Date().toISOString(),
        priority: messageItem.priority?.S,
        title: messageItem.title?.S,
        metadata: {
          fanoutSource: 'broadcast-targeting',
          originalTargetKey: 'broadcast'
        }
      }),
      EventBusName: process.env.EVENT_BUS_NAME
    }));
    
    // Publish events in batches
    const batchSize = 10;
    const publishPromises = [];
    
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      publishPromises.push(
        eventBridge.send(new PutEventsCommand({ Entries: batch }))
      );
    }
    
    await Promise.all(publishPromises);
    
    console.log(\`Published \${events.length} availability events for broadcast\`);
    
    return {
      userCount: allUsers.length,
      eventsPublished: events.length,
      success: true
    };
    
  } catch (error) {
    console.error('Failed to fanout broadcast:', error);
    return {
      error: error.message,
      success: false
    };
  }
}

async function fanoutToChannelParticipants(channelId, messageId, messageItem, isMessage) {
  console.log(\`Fanning out to channel \${channelId} participants\`);
  
  try {
    // Query channel participants using GSI
    const participantsResult = await dynamodb.send(new QueryCommand({
      TableName: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME,
      IndexName: 'channelId-userId-index',
      KeyConditionExpression: 'channelId = :channelId',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':channelId': { S: channelId },
        ':active': { BOOL: true }
      }
    }));
    
    if (!participantsResult.Items || participantsResult.Items.length === 0) {
      console.log(\`No active participants found for channel \${channelId}\`);
      return { channelId, participantCount: 0, success: true };
    }
    
    const participants = participantsResult.Items.map(item => item.userId.S);
    
    console.log(\`Found \${participants.length} active participants in channel \${channelId}\`);
    
    // Create EventBridge events for each participant
    const events = participants.map(userId => ({
      Source: 'kx-notifications-messaging',
      DetailType: isMessage ? 'chat.message.available' : 'channel.notification.available',
      Detail: JSON.stringify({
        eventId: \`\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
        eventType: isMessage ? 'chat.message.available' : 'channel.notification.available',
        userId,
        channelId,
        messageId,
        targetType: 'channel',
        timestamp: new Date().toISOString(),
        priority: messageItem.priority?.S,
        content: messageItem.content?.S,
        senderId: messageItem.senderId?.S,
        metadata: {
          fanoutSource: 'channel-targeting',
          originalTargetKey: \`channel#\${channelId}\`
        }
      }),
      EventBusName: process.env.EVENT_BUS_NAME
    }));
    
    // Publish events in batches (EventBridge supports up to 10 events per request)
    const batchSize = 10;
    const publishPromises = [];
    
    for (let i = 0; i < events.length; i += batchSize) {
      const batch = events.slice(i, i + batchSize);
      publishPromises.push(
        eventBridge.send(new PutEventsCommand({ Entries: batch }))
      );
    }
    
    await Promise.all(publishPromises);
    
    console.log(\`Published \${events.length} availability events for channel \${channelId}\`);
    
    return {
      channelId,
      participantCount: participants.length,
      eventsPublished: events.length,
      success: true
    };
    
  } catch (error) {
    console.error(\`Failed to fanout to channel \${channelId}:\`, error);
    return {
      channelId,
      error: error.message,
      success: false
    };
  }
}

async function getClientUsers(clientId) {
  // TODO: Replace with actual user service query
  // This would typically query your user table or call a user service API
  
  // Simulated response - in production, this would be:
  // const response = await userService.getUsersByClient(clientId);
  // return response.users.map(user => user.userId);
  
  // For demo purposes, return mock users
  const mockUsers = [
    \`user-\${clientId}-1\`,
    \`user-\${clientId}-2\`,
    \`user-\${clientId}-3\`
  ];
  
  console.log(\`Mock: Found \${mockUsers.length} users for client \${clientId}\`);
  return mockUsers;
}

async function getAllUsers() {
  // TODO: Replace with actual user service query
  // This would typically query your user table or call a user service API
  
  // Simulated response - in production, this would be:
  // const response = await userService.getAllUsers();
  // return response.users.map(user => ({ userId: user.userId, clientId: user.clientId }));
  
  // For demo purposes, return mock users across multiple clients
  const mockUsers = [
    { userId: 'user-client1-1', clientId: 'client1' },
    { userId: 'user-client1-2', clientId: 'client1' },
    { userId: 'user-client2-1', clientId: 'client2' },
    { userId: 'user-client2-2', clientId: 'client2' },
    { userId: 'user-client3-1', clientId: 'client3' }
  ];
  
  console.log(\`Mock: Found \${mockUsers.length} total users for broadcast\`);
  return mockUsers;
}
      `),
      environment: {
        MESSAGES_TABLE_NAME: messagesTable.tableName,
        NOTIFICATIONS_TABLE_NAME: notificationsTable.tableName,
        MESSAGE_STATUS_TABLE_NAME: messageStatusTable.tableName,
        CHANNEL_PARTICIPANTS_TABLE_NAME: channelParticipantsTable.tableName,
        EVENT_BUS_NAME: environment.EVENT_BUS_NAME || 'default',
        ...environment
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
    });

    // Grant permissions to read from source tables
    messagesTable.grantReadData(this.fanoutFunction);
    notificationsTable.grantReadData(this.fanoutFunction);
    channelParticipantsTable.grantReadData(this.fanoutFunction);
    
    // Grant permissions to write to status table (for future use)
    messageStatusTable.grantWriteData(this.fanoutFunction);

    // Grant permissions to publish to EventBridge
    this.fanoutFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: ['*'], // EventBridge ARN will be provided via environment
    }));

    // Add DynamoDB stream event sources
    this.fanoutFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(messagesTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        retryAttempts: 3
      })
    );

    this.fanoutFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(notificationsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        retryAttempts: 3
      })
    );

    // CloudFormation output
    new cdk.CfnOutput(this, 'FanoutFunctionArn', {
      value: this.fanoutFunction.functionArn,
      description: 'Fanout processor Lambda function ARN',
      exportName: `${cdk.Stack.of(this).stackName}-FanoutFunctionArn`,
    });

    // Tags
    cdk.Tags.of(this.fanoutFunction).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this.fanoutFunction).add('FunctionType', 'FanoutProcessor');
  }
}
