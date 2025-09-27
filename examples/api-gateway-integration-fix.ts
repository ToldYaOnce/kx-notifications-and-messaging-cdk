import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { NotificationMessagingStack } from '../src/stacks/notifications-messaging-stack';

/**
 * Example demonstrating the v1.1.3 fix for API Gateway integration
 * 
 * BEFORE v1.1.3: This would fail with:
 * "TypeError: Cannot read properties of null (reading 'grantPrincipal')"
 * 
 * AFTER v1.1.3: This works perfectly!
 */
export class ApiGatewayIntegrationFixExample extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create your main API Gateway
    const api = new apigateway.RestApi(this, 'MainApi', {
      restApiName: 'My Application API',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO
      }
    });

    // Add some existing endpoints to your API
    const healthCheck = api.root.addResource('health');
    healthCheck.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{
        statusCode: '200',
        responseTemplates: {
          'application/json': '{"status": "healthy"}'
        }
      }],
      requestTemplates: {
        'application/json': '{"statusCode": 200}'
      }
    }), {
      methodResponses: [{ statusCode: '200' }]
    });

    // 🎯 THIS NOW WORKS! (Fixed in v1.1.3)
    const notificationStack = new NotificationMessagingStack(this, 'Notifications', {
      resourcePrefix: 'MyApp',
      
      // ✅ INTEGRATE WITH EXISTING API GATEWAY
      apiGatewayConfig: {
        existingMessagesApi: api,           // Use your existing API
        existingNotificationsApi: api,      // Use your existing API  
        separateApis: false,                // Both services on same API
        messagesBasePath: '/messages',      // Your preferred path
        notificationsBasePath: '/notifications'
      },
      
      // Optional: Auto-create notifications from events
      eventSubscriptions: [
        {
          name: 'UserActionNotifications',
          eventPattern: { 
            source: ['my-app'], 
            detailType: ['user.login', 'user.logout', 'user.action'] 
          },
          notificationMapping: {
            'user.login': {
              targetType: 'user',
              userId: (detail: any) => detail.userId,
              title: 'Welcome Back!',
              content: (detail: any) => `Welcome back, ${detail.username}!`,
              priority: 'low',
              icon: '👋',
              category: 'authentication'
            },
            'user.logout': {
              targetType: 'user', 
              userId: (detail: any) => detail.userId,
              title: 'See You Later!',
              content: 'You have been logged out successfully.',
              priority: 'low',
              icon: '👋',
              category: 'authentication'
            },
            'user.action': {
              targetType: 'user',
              userId: (detail: any) => detail.userId,
              title: 'Action Completed',
              content: (detail: any) => `Your ${detail.action} was completed successfully.`,
              priority: 'medium',
              metadata: (detail: any) => ({ 
                action: detail.action,
                timestamp: detail.timestamp,
                ...detail.metadata 
              })
            }
          }
        }
      ]
    });

    // Output the API URL - now includes /messages and /notifications endpoints!
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Main API URL with integrated notifications and messages',
      exportName: `${this.stackName}-ApiUrl`
    });

    new cdk.CfnOutput(this, 'AvailableEndpoints', {
      value: [
        `${api.url}health`,
        `${api.url}messages`,
        `${api.url}messages/{id}`,
        `${api.url}notifications`,
        `${api.url}notifications/{id}`
      ].join(', '),
      description: 'All available API endpoints'
    });
  }
}

// Example usage in your CDK app
const app = new cdk.App();
new ApiGatewayIntegrationFixExample(app, 'ApiGatewayIntegrationFixExample', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  }
});

