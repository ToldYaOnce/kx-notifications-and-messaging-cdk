/**
 * Cross-stack integration example for @toldyaonce/kx-notifications-and-messaging-cdk
 * 
 * This example demonstrates how to deploy the notification system across
 * multiple stacks and integrate with existing infrastructure.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as events from 'aws-cdk-lib/aws-events';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

// Stack 1: Core notification infrastructure
export class NotificationInfrastructureStack extends cdk.Stack {
  public readonly notificationStack: NotificationMessagingStack;

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Deploy the core notifications and messaging infrastructure
    this.notificationStack = new NotificationMessagingStack(this, 'NotificationMessaging', {
      resourcePrefix: 'myapp-core',
      eventBridgeBusName: 'myapp-core-events',
      enableFullTextSearch: true,
      
      // Basic EventBridge rules for system events
      eventBridgeRules: [
        {
          ruleName: 'SystemEventsRule',
          description: 'Capture all system notification events',
          eventPattern: {
            source: ['kx-notifications-messaging'],
          },
          targets: [] // Will be populated by consumer stacks
        }
      ]
    });

    // Export key resources for other stacks
    new cdk.CfnOutput(this, 'MessagesApiUrl', {
      value: this.notificationStack.messagesApi.url,
      exportName: `${this.stackName}-MessagesApiUrl`,
    });

    new cdk.CfnOutput(this, 'NotificationsApiUrl', {
      value: this.notificationStack.notificationsApi.url,
      exportName: `${this.stackName}-NotificationsApiUrl`,
    });

    new cdk.CfnOutput(this, 'EventBridgeArn', {
      value: this.notificationStack.eventBridge.eventBridgeArn,
      exportName: `${this.stackName}-EventBridgeArn`,
    });

    new cdk.CfnOutput(this, 'EventBridgeName', {
      value: this.notificationStack.eventBridge.eventBridgeName,
      exportName: `${this.stackName}-EventBridgeName`,
    });
  }
}

// Stack 2: Application API that integrates with notifications
export class ApplicationApiStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, infrastructureStackName: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import notification resources from infrastructure stack
    const messagesApiUrl = cdk.Fn.importValue(`${infrastructureStackName}-MessagesApiUrl`);
    const notificationsApiUrl = cdk.Fn.importValue(`${infrastructureStackName}-NotificationsApiUrl`);
    const eventBridgeArn = cdk.Fn.importValue(`${infrastructureStackName}-EventBridgeArn`);

    // Create main application API
    const api = new apigateway.RestApi(this, 'ApplicationApi', {
      restApiName: 'MyApp API',
      description: 'Main application API with notification integration',
    });

    // Create application Lambda that sends notifications
    const orderProcessorFunction = new lambda.Function(this, 'OrderProcessor', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const https = require('https');
        const { URL } = require('url');
        
        exports.handler = async (event) => {
          console.log('Processing order:', JSON.stringify(event, null, 2));
          
          const body = JSON.parse(event.body || '{}');
          const userId = event.requestContext?.authorizer?.userId;
          
          if (!userId) {
            return {
              statusCode: 401,
              body: JSON.stringify({ error: 'User not authenticated' })
            };
          }
          
          // Process the order
          const orderId = \`order-\${Date.now()}\`;
          
          // Send notification to user
          const notification = {
            title: 'Order Confirmed',
            content: \`Your order #\${orderId} has been confirmed and is being processed.\`,
            priority: 'medium',
            metadata: {
              orderId,
              orderTotal: body.total,
              estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            }
          };
          
          try {
            await sendNotification(notification, userId);
            console.log('Notification sent successfully');
          } catch (error) {
            console.error('Failed to send notification:', error);
            // Don't fail the order if notification fails
          }
          
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: true,
              orderId,
              message: 'Order processed successfully'
            })
          };
        };
        
        async function sendNotification(notification, userId) {
          const url = new URL(process.env.NOTIFICATIONS_API_URL);
          
          const postData = JSON.stringify(notification);
          
          const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              'Authorization': \`Bearer \${process.env.SERVICE_TOKEN}\` // Service-to-service auth
            }
          };
          
          return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
              let data = '';
              res.on('data', (chunk) => data += chunk);
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  resolve(JSON.parse(data));
                } else {
                  reject(new Error(\`HTTP \${res.statusCode}: \${data}\`));
                }
              });
            });
            
            req.on('error', reject);
            req.write(postData);
            req.end();
          });
        }
      `),
      environment: {
        NOTIFICATIONS_API_URL: notificationsApiUrl,
        SERVICE_TOKEN: 'your-service-token', // In production, use AWS Secrets Manager
      },
    });

    // Create user profile Lambda that sends messages
    const userProfileFunction = new lambda.Function(this, 'UserProfile', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const https = require('https');
        const { URL } = require('url');
        
        exports.handler = async (event) => {
          console.log('User profile update:', JSON.stringify(event, null, 2));
          
          const userId = event.requestContext?.authorizer?.userId;
          const body = JSON.parse(event.body || '{}');
          
          if (!userId) {
            return {
              statusCode: 401,
              body: JSON.stringify({ error: 'User not authenticated' })
            };
          }
          
          // Update user profile logic here
          console.log(\`Updating profile for user \${userId}\`);
          
          // Send welcome message for new users
          if (body.isNewUser) {
            const message = {
              content: 'Welcome to MyApp! We\\'re excited to have you on board. Check out our getting started guide to make the most of your experience.',
              title: 'Welcome to MyApp!',
              priority: 'medium',
              metadata: {
                messageType: 'welcome',
                onboardingStep: 1
              }
            };
            
            try {
              await sendMessage(message, userId);
              console.log('Welcome message sent');
            } catch (error) {
              console.error('Failed to send welcome message:', error);
            }
          }
          
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: true,
              message: 'Profile updated successfully'
            })
          };
        };
        
        async function sendMessage(message, userId) {
          const url = new URL(process.env.MESSAGES_API_URL);
          
          const postData = JSON.stringify(message);
          
          const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              'Authorization': \`Bearer \${process.env.SERVICE_TOKEN}\`
            }
          };
          
          return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
              let data = '';
              res.on('data', (chunk) => data += chunk);
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  resolve(JSON.parse(data));
                } else {
                  reject(new Error(\`HTTP \${res.statusCode}: \${data}\`));
                }
              });
            });
            
            req.on('error', reject);
            req.write(postData);
            req.end();
          });
        }
      `),
      environment: {
        MESSAGES_API_URL: messagesApiUrl,
        SERVICE_TOKEN: 'your-service-token',
      },
    });

    // Add API routes
    const orders = api.root.addResource('orders');
    orders.addMethod('POST', new apigateway.LambdaIntegration(orderProcessorFunction));

    const profile = api.root.addResource('profile');
    profile.addMethod('PUT', new apigateway.LambdaIntegration(userProfileFunction));

    // Output the main API URL
    new cdk.CfnOutput(this, 'ApplicationApiUrl', {
      value: api.url,
      description: 'Main application API URL',
    });
  }
}

// Stack 3: Real-time notification consumers
export class NotificationConsumersStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, infrastructureStackName: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import EventBridge from infrastructure stack
    const eventBridgeArn = cdk.Fn.importValue(`${infrastructureStackName}-EventBridgeArn`);
    const eventBus = events.EventBus.fromEventBusArn(this, 'ImportedEventBus', eventBridgeArn);

    // WebSocket notification handler
    const websocketHandler = new lambda.Function(this, 'WebSocketHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('WebSocket notification:', JSON.stringify(event, null, 2));
          
          const { eventType, userId, itemId } = event.detail;
          
          // WebSocket broadcasting logic
          console.log(\`Broadcasting \${eventType} to user \${userId}\`);
          
          // In a real implementation, you would:
          // 1. Get the user's WebSocket connection ID from DynamoDB
          // 2. Send the notification via API Gateway WebSocket API
          // 3. Handle connection cleanup if the connection is stale
          
          return { statusCode: 200 };
        };
      `),
    });

    // Email notification handler
    const emailHandler = new lambda.Function(this, 'EmailHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Email notification:', JSON.stringify(event, null, 2));
          
          const { eventType, userId, itemId } = event.detail;
          
          // Email sending logic
          console.log(\`Sending email for \${eventType} to user \${userId}\`);
          
          // In a real implementation, you would:
          // 1. Get user email from user service
          // 2. Generate email content based on event type
          // 3. Send email via SES
          // 4. Track email delivery status
          
          return { statusCode: 200 };
        };
      `),
    });

    // Push notification handler
    const pushHandler = new lambda.Function(this, 'PushHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Push notification:', JSON.stringify(event, null, 2));
          
          const { eventType, userId, itemId } = event.detail;
          
          // Push notification logic
          console.log(\`Sending push notification for \${eventType} to user \${userId}\`);
          
          // In a real implementation, you would:
          // 1. Get user's device tokens from database
          // 2. Format notification for different platforms (iOS/Android)
          // 3. Send via SNS or direct to FCM/APNS
          // 4. Handle token cleanup for invalid tokens
          
          return { statusCode: 200 };
        };
      `),
    });

    // Create EventBridge rules for different notification channels
    
    // Real-time WebSocket notifications for all events
    new events.Rule(this, 'WebSocketRule', {
      eventBus,
      ruleName: 'websocket-notifications',
      description: 'Send all events to WebSocket handler',
      eventPattern: {
        source: ['kx-notifications-messaging'],
      },
      targets: [new targets.LambdaFunction(websocketHandler)],
    });

    // Email notifications for high priority items only
    new events.Rule(this, 'EmailRule', {
      eventBus,
      ruleName: 'email-notifications',
      description: 'Send high priority notifications via email',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['notification.created'],
        detail: {
          priority: ['high', 'urgent']
        }
      },
      targets: [new targets.LambdaFunction(emailHandler)],
    });

    // Push notifications for urgent items
    new events.Rule(this, 'PushRule', {
      eventBus,
      ruleName: 'push-notifications',
      description: 'Send urgent notifications via push',
      eventPattern: {
        source: ['kx-notifications-messaging'],
        detailType: ['notification.created'],
        detail: {
          priority: ['urgent']
        }
      },
      targets: [new targets.LambdaFunction(pushHandler)],
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketHandlerArn', {
      value: websocketHandler.functionArn,
      description: 'WebSocket notification handler ARN',
    });

    new cdk.CfnOutput(this, 'EmailHandlerArn', {
      value: emailHandler.functionArn,
      description: 'Email notification handler ARN',
    });

    new cdk.CfnOutput(this, 'PushHandlerArn', {
      value: pushHandler.functionArn,
      description: 'Push notification handler ARN',
    });
  }
}

// Deploy all stacks with proper dependencies
const app = new cdk.App();

// Stack 1: Core infrastructure
const infrastructureStack = new NotificationInfrastructureStack(app, 'NotificationInfrastructure', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Stack 2: Application API (depends on infrastructure)
const applicationStack = new ApplicationApiStack(
  app, 
  'ApplicationApi', 
  infrastructureStack.stackName,
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  }
);
applicationStack.addDependency(infrastructureStack);

// Stack 3: Notification consumers (depends on infrastructure)
const consumersStack = new NotificationConsumersStack(
  app, 
  'NotificationConsumers', 
  infrastructureStack.stackName,
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  }
);
consumersStack.addDependency(infrastructureStack);
