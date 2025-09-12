/**
 * Advanced configuration example for @toldyaonce/kx-notifications-and-messaging-cdk
 * 
 * This example demonstrates all available configuration options and
 * advanced EventBridge rule patterns.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

export class AdvancedConfigurationStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC for Lambda functions (optional)
    const vpc = new ec2.Vpc(this, 'NotificationVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Create various consumer targets
    const emailNotifierFunction = new lambda.Function(this, 'EmailNotifier', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
        const ses = new SESClient({ region: process.env.AWS_REGION });
        
        exports.handler = async (event) => {
          console.log('Processing email notification:', event.detail);
          
          const { eventType, userId, itemId } = event.detail;
          
          // Send email notification
          if (eventType === 'notification.created') {
            // Email sending logic here
            console.log(\`Sending email notification to user \${userId}\`);
          }
          
          return { statusCode: 200 };
        };
      `),
      environment: {
        SES_REGION: this.region,
      },
    });

    const pushNotifierFunction = new lambda.Function(this, 'PushNotifier', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Processing push notification:', event.detail);
          
          const { eventType, userId, itemId } = event.detail;
          
          // Push notification logic here
          if (eventType === 'notification.created') {
            console.log(\`Sending push notification to user \${userId}\`);
          }
          
          return { statusCode: 200 };
        };
      `),
    });

    const analyticsFunction = new lambda.Function(this, 'Analytics', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Processing analytics event:', event.detail);
          
          // Analytics processing logic
          const { eventType, userId, itemId, timestamp } = event.detail;
          
          // Track user engagement metrics
          console.log(\`Analytics: \${eventType} for user \${userId} at \${timestamp}\`);
          
          return { statusCode: 200 };
        };
      `),
    });

    // Create SQS queues for different priority levels
    const urgentQueue = new sqs.Queue(this, 'UrgentNotificationsQueue', {
      queueName: 'urgent-notifications',
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    const standardQueue = new sqs.Queue(this, 'StandardNotificationsQueue', {
      queueName: 'standard-notifications',
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    // Create SNS topic for broadcast notifications
    const broadcastTopic = new sns.Topic(this, 'BroadcastTopic', {
      topicName: 'notification-broadcasts',
    });

    // Deploy the notifications and messaging stack with advanced configuration
    const notificationStack = new NotificationMessagingStack(this, 'NotificationMessaging', {
      // Resource naming
      resourcePrefix: 'myapp-prod',
      eventBridgeBusName: 'myapp-notifications-events',
      
      // Feature toggles
      enableFullTextSearch: true,
      ttlAttributeName: 'expiresAt',
      
      // VPC configuration for Lambda functions
      vpcConfig: {
        vpcId: vpc.vpcId,
        subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
        securityGroupIds: [vpc.vpcDefaultSecurityGroup],
      },
      
      // Lambda environment variables
      lambdaEnvironment: {
        LOG_LEVEL: 'info',
        ENABLE_METRICS: 'true',
        ENVIRONMENT: 'production',
      },
      
      // Complex EventBridge rules
      eventBridgeRules: [
        // Rule 1: High priority notifications go to urgent queue and email
        {
          ruleName: 'HighPriorityNotifications',
          description: 'Route high priority notifications to urgent processing',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            detailType: ['notification.created'],
            detail: {
              priority: ['high', 'urgent']
            }
          },
          targets: [
            new targets.SqsQueue(urgentQueue),
            new targets.LambdaFunction(emailNotifierFunction),
            new targets.LambdaFunction(pushNotifierFunction),
          ]
        },
        
        // Rule 2: Standard notifications go to standard queue
        {
          ruleName: 'StandardNotifications',
          description: 'Route standard priority notifications',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            detailType: ['notification.created'],
            detail: {
              priority: ['low', 'medium']
            }
          },
          targets: [
            new targets.SqsQueue(standardQueue),
            new targets.LambdaFunction(pushNotifierFunction),
          ]
        },
        
        // Rule 3: All read events go to analytics
        {
          ruleName: 'ReadEventsAnalytics',
          description: 'Track all read events for analytics',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            detailType: ['notification.read', 'message.read']
          },
          targets: [
            new targets.LambdaFunction(analyticsFunction)
          ]
        },
        
        // Rule 4: Broadcast all creation events to SNS topic
        {
          ruleName: 'CreationEventsBroadcast',
          description: 'Broadcast all creation events',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            detailType: ['notification.created', 'message.created']
          },
          targets: [
            new targets.SnsTopic(broadcastTopic)
          ]
        },
        
        // Rule 5: User-specific routing (example for premium users)
        {
          ruleName: 'PremiumUserNotifications',
          description: 'Special handling for premium users',
          eventPattern: {
            source: ['kx-notifications-messaging'],
            detailType: ['notification.created'],
            detail: {
              userId: ['premium-user-1', 'premium-user-2'], // Example premium user IDs
            }
          },
          targets: [
            new targets.LambdaFunction(emailNotifierFunction),
            new targets.LambdaFunction(pushNotifierFunction),
            new targets.SqsQueue(urgentQueue),
          ]
        },
        
        // Rule 6: Simple rule format (backward compatibility)
        {
          eventPattern: {
            source: ['kx-notifications-messaging'],
            detailType: ['message.created']
          },
          targets: [new targets.LambdaFunction(analyticsFunction)]
        }
      ]
    });

    // Grant additional permissions
    urgentQueue.grantConsumeMessages(emailNotifierFunction);
    standardQueue.grantConsumeMessages(pushNotifierFunction);
    broadcastTopic.grantPublish(notificationStack.eventBridge.eventBus);

    // Create comprehensive outputs
    new cdk.CfnOutput(this, 'MessagesApiUrl', {
      value: notificationStack.messagesApi.url,
      description: 'Messages API Gateway URL',
      exportName: `${this.stackName}-MessagesApiUrl`,
    });

    new cdk.CfnOutput(this, 'NotificationsApiUrl', {
      value: notificationStack.notificationsApi.url,
      description: 'Notifications API Gateway URL',
      exportName: `${this.stackName}-NotificationsApiUrl`,
    });

    new cdk.CfnOutput(this, 'EventBridgeArn', {
      value: notificationStack.eventBridge.eventBridgeArn,
      description: 'EventBridge custom bus ARN',
      exportName: `${this.stackName}-EventBridgeArn`,
    });

    new cdk.CfnOutput(this, 'UrgentQueueUrl', {
      value: urgentQueue.queueUrl,
      description: 'Urgent notifications SQS queue URL',
      exportName: `${this.stackName}-UrgentQueueUrl`,
    });

    new cdk.CfnOutput(this, 'StandardQueueUrl', {
      value: standardQueue.queueUrl,
      description: 'Standard notifications SQS queue URL',
      exportName: `${this.stackName}-StandardQueueUrl`,
    });

    new cdk.CfnOutput(this, 'BroadcastTopicArn', {
      value: broadcastTopic.topicArn,
      description: 'Broadcast SNS topic ARN',
      exportName: `${this.stackName}-BroadcastTopicArn`,
    });
  }
}

// Deploy the stack
const app = new cdk.App();
new AdvancedConfigurationStack(app, 'AdvancedNotificationSetup', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
