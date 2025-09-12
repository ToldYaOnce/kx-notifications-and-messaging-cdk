/**
 * EventBridge consumer examples for @toldyaonce/kx-notifications-and-messaging-cdk
 * 
 * This example shows different patterns for consuming events from the
 * notifications and messaging EventBridge bus.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { EventBridgeConstruct } from '@toldyaonce/kx-notifications-and-messaging-cdk';

export class EventBridgeConsumersStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import the EventBridge bus from the notifications stack
    const eventBusArn = cdk.Fn.importValue('NotificationMessagingStack-EventBridgeArn');
    const eventBus = events.EventBus.fromEventBusArn(this, 'ImportedEventBus', eventBusArn);

    // Consumer 1: Real-time WebSocket notifications
    const websocketNotifier = new lambda.Function(this, 'WebSocketNotifier', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
        
        exports.handler = async (event) => {
          console.log('WebSocket notification event:', JSON.stringify(event, null, 2));
          
          const { eventType, userId, itemId } = event.detail;
          
          // Get WebSocket connection ID for user (from DynamoDB or cache)
          const connectionId = await getUserConnectionId(userId);
          
          if (connectionId) {
            const apiGw = new ApiGatewayManagementApiClient({
              endpoint: process.env.WEBSOCKET_API_ENDPOINT
            });
            
            const message = {
              type: eventType,
              data: {
                itemId,
                timestamp: event.detail.timestamp,
                priority: event.detail.priority
              }
            };
            
            try {
              await apiGw.send(new PostToConnectionCommand({
                ConnectionId: connectionId,
                Data: JSON.stringify(message)
              }));
              
              console.log(\`Sent WebSocket message to user \${userId}\`);
            } catch (error) {
              console.error('Failed to send WebSocket message:', error);
            }
          }
          
          return { statusCode: 200 };
        };
        
        async function getUserConnectionId(userId) {
          // Implementation to get WebSocket connection ID
          // This would typically query DynamoDB or Redis
          return 'mock-connection-id';
        }
      `),
      environment: {
        WEBSOCKET_API_ENDPOINT: 'wss://your-websocket-api.execute-api.region.amazonaws.com/prod',
      },
    });

    // Consumer 2: Email notification service
    const emailService = new lambda.Function(this, 'EmailService', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
        const ses = new SESClient({ region: process.env.AWS_REGION });
        
        exports.handler = async (event) => {
          console.log('Email service event:', JSON.stringify(event, null, 2));
          
          const { eventType, userId, itemId } = event.detail;
          
          // Only process creation events
          if (!eventType.endsWith('.created')) {
            return { statusCode: 200, body: 'Event ignored' };
          }
          
          // Get user email from user service
          const userEmail = await getUserEmail(userId);
          
          if (userEmail) {
            const emailContent = generateEmailContent(eventType, event.detail);
            
            try {
              await ses.send(new SendEmailCommand({
                Source: process.env.FROM_EMAIL,
                Destination: { ToAddresses: [userEmail] },
                Message: {
                  Subject: { Data: emailContent.subject },
                  Body: {
                    Html: { Data: emailContent.html },
                    Text: { Data: emailContent.text }
                  }
                }
              }));
              
              console.log(\`Email sent to \${userEmail} for event \${eventType}\`);
            } catch (error) {
              console.error('Failed to send email:', error);
            }
          }
          
          return { statusCode: 200 };
        };
        
        async function getUserEmail(userId) {
          // Implementation to get user email
          return 'user@example.com';
        }
        
        function generateEmailContent(eventType, detail) {
          const isNotification = eventType.startsWith('notification.');
          const type = isNotification ? 'notification' : 'message';
          
          return {
            subject: \`New \${type} received\`,
            html: \`<h1>You have a new \${type}!</h1><p>Check your account for details.</p>\`,
            text: \`You have a new \${type}! Check your account for details.\`
          };
        }
      `),
      environment: {
        FROM_EMAIL: 'notifications@yourapp.com',
      },
    });

    // Consumer 3: Analytics and metrics
    const analyticsProcessor = new lambda.Function(this, 'AnalyticsProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
        const cloudwatch = new CloudWatchClient({ region: process.env.AWS_REGION });
        
        exports.handler = async (event) => {
          console.log('Analytics event:', JSON.stringify(event, null, 2));
          
          const { eventType, userId, itemId, timestamp } = event.detail;
          
          // Extract metrics
          const [entityType, action] = eventType.split('.');
          
          // Send custom metrics to CloudWatch
          const metrics = [
            {
              MetricName: 'EventCount',
              Value: 1,
              Unit: 'Count',
              Dimensions: [
                { Name: 'EventType', Value: eventType },
                { Name: 'EntityType', Value: entityType },
                { Name: 'Action', Value: action }
              ]
            }
          ];
          
          // Add priority metric if available
          if (event.detail.priority) {
            metrics.push({
              MetricName: 'PriorityEventCount',
              Value: 1,
              Unit: 'Count',
              Dimensions: [
                { Name: 'Priority', Value: event.detail.priority },
                { Name: 'EventType', Value: eventType }
              ]
            });
          }
          
          try {
            await cloudwatch.send(new PutMetricDataCommand({
              Namespace: 'NotificationMessaging/Events',
              MetricData: metrics
            }));
            
            console.log('Metrics sent to CloudWatch');
          } catch (error) {
            console.error('Failed to send metrics:', error);
          }
          
          return { statusCode: 200 };
        };
      `),
    });

    // Consumer 4: Audit logging
    const auditLogger = new lambda.Function(this, 'AuditLogger', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
        const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });
        
        exports.handler = async (event) => {
          console.log('Audit logging event:', JSON.stringify(event, null, 2));
          
          const auditRecord = {
            auditId: { S: \`audit-\${Date.now()}-\${Math.random().toString(36).substr(2, 9)}\` },
            eventType: { S: event.detail.eventType },
            userId: { S: event.detail.userId },
            itemId: { S: event.detail.itemId },
            timestamp: { S: event.detail.timestamp },
            eventData: { S: JSON.stringify(event.detail) },
            ttl: { N: Math.floor((Date.now() + (90 * 24 * 60 * 60 * 1000)) / 1000).toString() } // 90 days TTL
          };
          
          try {
            await dynamodb.send(new PutItemCommand({
              TableName: process.env.AUDIT_TABLE_NAME,
              Item: auditRecord
            }));
            
            console.log('Audit record created');
          } catch (error) {
            console.error('Failed to create audit record:', error);
          }
          
          return { statusCode: 200 };
        };
      `),
      environment: {
        AUDIT_TABLE_NAME: 'notification-audit-logs',
      },
    });

    // Create EventBridge rules for different consumer patterns

    // Rule 1: Real-time notifications (all creation events)
    new events.Rule(this, 'RealtimeNotificationsRule', {
      eventBus,
      ruleName: 'realtime-notifications',
      description: 'Route creation events to WebSocket notifier',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['notification.created', 'message.created'],
      },
      targets: [new targets.LambdaFunction(websocketNotifier)],
    });

    // Rule 2: Email notifications (high priority only)
    new events.Rule(this, 'EmailNotificationsRule', {
      eventBus,
      ruleName: 'email-notifications',
      description: 'Send emails for high priority notifications',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['notification.created'],
        detail: {
          priority: ['high', 'urgent']
        }
      },
      targets: [new targets.LambdaFunction(emailService)],
    });

    // Rule 3: Analytics (all events)
    new events.Rule(this, 'AnalyticsRule', {
      eventBus,
      ruleName: 'analytics-all-events',
      description: 'Process all events for analytics',
      eventPattern: {
        source: ['kx-notifications-messaging'],
      },
      targets: [new targets.LambdaFunction(analyticsProcessor)],
    });

    // Rule 4: Audit logging (all events)
    new events.Rule(this, 'AuditLoggingRule', {
      eventBus,
      ruleName: 'audit-logging',
      description: 'Log all events for audit purposes',
      eventPattern: {
        source: ['kx-notifications-messaging'],
      },
      targets: [new targets.LambdaFunction(auditLogger)],
    });

    // Rule 5: Using the EventBridge discovery helper
    const discoveryPattern = EventBridgeConstruct.createEventPattern({
      entityTypes: ['notification'],
      eventTypes: ['created', 'read'],
      userIds: ['premium-user-1', 'premium-user-2']
    });

    new events.Rule(this, 'PremiumUserRule', {
      eventBus,
      ruleName: 'premium-user-notifications',
      description: 'Special handling for premium users',
      eventPattern: discoveryPattern,
      targets: [
        new targets.LambdaFunction(websocketNotifier),
        new targets.LambdaFunction(emailService),
      ],
    });

    // Rule 6: SQS integration for batch processing
    const batchProcessingQueue = new sqs.Queue(this, 'BatchProcessingQueue', {
      queueName: 'notification-batch-processing',
      visibilityTimeout: cdk.Duration.minutes(5),
    });

    new events.Rule(this, 'BatchProcessingRule', {
      eventBus,
      ruleName: 'batch-processing',
      description: 'Queue events for batch processing',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['message.created'],
      },
      targets: [new targets.SqsQueue(batchProcessingQueue)],
    });

    // Rule 7: SNS fan-out pattern
    const fanoutTopic = new sns.Topic(this, 'NotificationFanout', {
      topicName: 'notification-fanout',
    });

    new events.Rule(this, 'FanoutRule', {
      eventBus,
      ruleName: 'notification-fanout',
      description: 'Fan out urgent notifications to multiple subscribers',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['notification.created'],
        detail: {
          priority: ['urgent']
        }
      },
      targets: [new targets.SnsTopic(fanoutTopic)],
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketNotifierArn', {
      value: websocketNotifier.functionArn,
      description: 'WebSocket notifier Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'EmailServiceArn', {
      value: emailService.functionArn,
      description: 'Email service Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'AnalyticsProcessorArn', {
      value: analyticsProcessor.functionArn,
      description: 'Analytics processor Lambda function ARN',
    });

    new cdk.CfnOutput(this, 'BatchProcessingQueueUrl', {
      value: batchProcessingQueue.queueUrl,
      description: 'Batch processing SQS queue URL',
    });

    new cdk.CfnOutput(this, 'FanoutTopicArn', {
      value: fanoutTopic.topicArn,
      description: 'Notification fanout SNS topic ARN',
    });
  }
}

// Deploy the stack
const app = new cdk.App();
new EventBridgeConsumersStack(app, 'EventBridgeConsumersStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
