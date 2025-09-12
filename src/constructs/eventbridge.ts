import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as pipes from 'aws-cdk-lib/aws-pipes';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { EventBridgeRuleConfig } from '../types';

export interface EventBridgeConstructProps {
  /**
   * Custom EventBridge bus name
   */
  eventBridgeBusName?: string;
  
  /**
   * EventBridge rules to create
   */
  eventBridgeRules?: EventBridgeRuleConfig[];
  
  /**
   * DynamoDB tables to integrate with EventBridge
   */
  messagesTable: dynamodb.Table;
  notificationsTable: dynamodb.Table;
  
  /**
   * Resource prefix for naming
   */
  resourcePrefix?: string;
}

export class EventBridgeConstruct extends Construct {
  public readonly eventBus: events.EventBus;
  public readonly eventBridgeArn: string;
  public readonly eventBridgeName: string;
  public readonly rules: events.Rule[] = [];

  constructor(scope: Construct, id: string, props: EventBridgeConstructProps) {
    super(scope, id);

    const {
      eventBridgeBusName,
      eventBridgeRules = [],
      messagesTable,
      notificationsTable,
      resourcePrefix = 'kx-notifications'
    } = props;

    // Create custom EventBridge bus
    this.eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: eventBridgeBusName || `${resourcePrefix}-events-bus`,
      description: 'EventBridge bus for notifications and messaging events',
    });

    this.eventBridgeArn = this.eventBus.eventBusArn;
    this.eventBridgeName = this.eventBus.eventBusName;

    // Create Lambda function for DynamoDB stream processing
    const streamProcessorFunction = new lambda.Function(this, 'StreamProcessor', {
      functionName: `${resourcePrefix}-stream-processor`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  console.log('Processing DynamoDB stream event:', JSON.stringify(event, null, 2));
  
  const events = [];
  
  for (const record of event.Records) {
    if (record.eventName === 'INSERT' || record.eventName === 'MODIFY' || record.eventName === 'REMOVE') {
      const tableName = record.eventSourceARN.split('/')[1];
      const isMessage = tableName.includes('messages');
      const isNotification = tableName.includes('notifications');
      
      if (!isMessage && !isNotification) continue;
      
      const dynamoRecord = record.dynamodb;
      const userId = dynamoRecord.Keys?.userId?.S;
      const dateReceived = dynamoRecord.Keys?.dateReceived?.S;
      const itemId = isMessage 
        ? dynamoRecord.NewImage?.messageId?.S || dynamoRecord.OldImage?.messageId?.S
        : dynamoRecord.NewImage?.notificationId?.S || dynamoRecord.OldImage?.notificationId?.S;
      
      let eventType;
      if (record.eventName === 'INSERT') {
        eventType = isMessage ? 'message.created' : 'notification.created';
      } else if (record.eventName === 'MODIFY') {
        const oldStatus = dynamoRecord.OldImage?.status?.S;
        const newStatus = dynamoRecord.NewImage?.status?.S;
        if (oldStatus === 'unread' && newStatus === 'read') {
          eventType = isMessage ? 'message.read' : 'notification.read';
        } else {
          eventType = isMessage ? 'message.updated' : 'notification.updated';
        }
      } else if (record.eventName === 'REMOVE') {
        eventType = isMessage ? 'message.deleted' : 'notification.deleted';
      }
      
      if (eventType && userId && itemId) {
        events.push({
          Source: 'kx-notifications-messaging',
          DetailType: eventType,
          Detail: JSON.stringify({
            eventId: \`\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\`,
            eventType,
            userId,
            itemId,
            dateReceived,
            timestamp: new Date().toISOString(),
            tableName: isMessage ? 'messages' : 'notifications',
            changeType: record.eventName,
            metadata: {
              region: process.env.AWS_REGION,
              source: 'dynamodb-stream'
            }
          }),
          EventBusName: process.env.EVENT_BUS_NAME
        });
      }
    }
  }
  
  if (events.length > 0) {
    try {
      const command = new PutEventsCommand({ Entries: events });
      const result = await eventBridge.send(command);
      console.log('Published events to EventBridge:', result);
    } catch (error) {
      console.error('Failed to publish events:', error);
      throw error;
    }
  }
  
  return { processedRecords: event.Records.length, publishedEvents: events.length };
};
      `),
      environment: {
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
    });

    // Grant permissions to publish to EventBridge
    this.eventBus.grantPutEventsTo(streamProcessorFunction);

    // Add DynamoDB stream event sources
    streamProcessorFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(messagesTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        retryAttempts: 3,
      })
    );

    streamProcessorFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(notificationsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        retryAttempts: 3,
      })
    );

    // Create EventBridge rules from configuration
    eventBridgeRules.forEach((ruleConfig, index) => {
      const rule = new events.Rule(this, `Rule${index}`, {
        eventBus: this.eventBus,
        ruleName: ruleConfig.ruleName,
        description: ruleConfig.description || `Rule for ${ruleConfig.ruleName}`,
        eventPattern: ruleConfig.eventPattern,
        targets: ruleConfig.targets,
      });

      this.rules.push(rule);
    });

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'EventBridgeArn', {
      value: this.eventBridgeArn,
      description: 'EventBridge custom bus ARN',
      exportName: `${cdk.Stack.of(this).stackName}-EventBridgeArn`,
    });

    new cdk.CfnOutput(this, 'EventBridgeName', {
      value: this.eventBridgeName,
      description: 'EventBridge custom bus name',
      exportName: `${cdk.Stack.of(this).stackName}-EventBridgeName`,
    });

    new cdk.CfnOutput(this, 'StreamProcessorFunctionArn', {
      value: streamProcessorFunction.functionArn,
      description: 'DynamoDB stream processor Lambda function ARN',
      exportName: `${cdk.Stack.of(this).stackName}-StreamProcessorFunctionArn`,
    });

    // Tags
    cdk.Tags.of(this.eventBus).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(streamProcessorFunction).add('Component', 'NotificationsMessaging');
  }

  /**
   * Helper method to create EventBridge discovery for consumers
   */
  public static createEventPattern(options: {
    entityTypes?: string[];
    eventTypes?: string[];
    userIds?: string[];
  }): any {
    const { entityTypes = [], eventTypes = [], userIds = [] } = options;
    
    const pattern: any = {
      source: ['kx-notifications-messaging'],
    };

    if (entityTypes.length > 0 || eventTypes.length > 0) {
      const detailTypes: string[] = [];
      
      if (entityTypes.length === 0) {
        // If no entity types specified, use all
        entityTypes.push('message', 'notification');
      }
      
      if (eventTypes.length === 0) {
        // If no event types specified, use all
        eventTypes.push('created', 'read', 'updated', 'deleted');
      }
      
      entityTypes.forEach(entity => {
        eventTypes.forEach(event => {
          detailTypes.push(`${entity}.${event}`);
        });
      });
      
      pattern.detailType = detailTypes;
    }

    if (userIds.length > 0) {
      pattern.detail = {
        userId: userIds,
      };
    }

    return pattern;
  }
}
