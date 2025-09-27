import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { NotificationMessagingStack } from '../src/stacks/notifications-messaging-stack';

/**
 * COMPREHENSIVE TEST: v1.1.5 Complete Fix for API Gateway Integration
 * 
 * This tests BOTH scenarios that were broken:
 * 1. separateApis: false (same API) - FIXED in v1.1.5
 * 2. separateApis: true (different APIs) - FIXED in v1.1.3
 * 
 * BEFORE v1.1.5: Both would fail with "Cannot read properties of null (reading 'grantPrincipal')"
 * AFTER v1.1.5: Both work perfectly!
 */

// TEST 1: Same API Gateway for both services (separateApis: false)
export class SameApiGatewayTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create your main API Gateway
    const api = new apigateway.RestApi(this, 'MainApi', {
      restApiName: 'Unified Application API',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO
      }
    });

    // Add existing endpoints
    const users = api.root.addResource('users');
    users.addMethod('GET');
    users.addMethod('POST');

    // 🎯 TEST: Same API for both services (separateApis: false)
    const notificationStack = new NotificationMessagingStack(this, 'Notifications', {
      resourcePrefix: 'SameApiTest',
      
      apiGatewayConfig: {
        existingMessagesApi: api,           // Same API
        existingNotificationsApi: api,      // Same API  
        separateApis: false,                // ⚠️ This was broken in v1.1.3-v1.1.4
        messagesBasePath: '/messages',
        notificationsBasePath: '/notifications'
      },
      
      eventSubscriptions: [
        {
          name: 'TestNotifications',
          eventPattern: { source: ['test-app'], detailType: ['test.event'] },
          notificationMapping: {
            'test.event': {
              targetType: 'user',
              userId: (detail: any) => detail.userId,
              title: 'Test Notification',
              content: 'This is a test notification'
            }
          }
        }
      ]
    });

    new cdk.CfnOutput(this, 'SameApiUrl', {
      value: api.url,
      description: 'API URL with integrated messages and notifications (same API)'
    });
  }
}

// TEST 2: Separate API Gateways for each service (separateApis: true)
export class SeparateApiGatewayTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create separate API Gateways
    const messagesApi = new apigateway.RestApi(this, 'MessagesApi', {
      restApiName: 'Messages API',
      deployOptions: { stageName: 'prod' }
    });

    const notificationsApi = new apigateway.RestApi(this, 'NotificationsApi', {
      restApiName: 'Notifications API', 
      deployOptions: { stageName: 'prod' }
    });

    // 🎯 TEST: Separate APIs for each service (separateApis: true)
    const notificationStack = new NotificationMessagingStack(this, 'Notifications', {
      resourcePrefix: 'SeparateApiTest',
      
      apiGatewayConfig: {
        existingMessagesApi: messagesApi,       // Different API
        existingNotificationsApi: notificationsApi, // Different API
        separateApis: true,                     // ✅ This was fixed in v1.1.3
        messagesBasePath: '/messages',
        notificationsBasePath: '/notifications'
      },
      
      eventSubscriptions: [
        {
          name: 'TestNotifications',
          eventPattern: { source: ['test-app'], detailType: ['test.event'] },
          notificationMapping: {
            'test.event': {
              targetType: 'user',
              userId: (detail: any) => detail.userId,
              title: 'Test Notification',
              content: 'This is a test notification'
            }
          }
        }
      ]
    });

    new cdk.CfnOutput(this, 'MessagesApiUrl', {
      value: messagesApi.url,
      description: 'Messages API URL'
    });

    new cdk.CfnOutput(this, 'NotificationsApiUrl', {
      value: notificationsApi.url,
      description: 'Notifications API URL'
    });
  }
}

// TEST 3: Your exact use case from the original bug report
export class YourExactUseCaseTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Simulate your AppStack pattern
    const api = new apigateway.RestApi(this, 'MainApi', {
      deployOptions: { stageName: 'prod' }
    });

    // Add your existing services (simulated)
    const health = api.root.addResource('health');
    health.addMethod('GET');

    // 🎯 YOUR EXACT PATTERN: This should now work!
    const notificationStack = new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'KxGen',
      
      // 🔌 INTEGRATE WITH YOUR EXISTING API GATEWAY
      apiGatewayConfig: {
        existingMessagesApi: api,
        existingNotificationsApi: api,
        separateApis: false,
        messagesBasePath: '/messages',
        notificationsBasePath: '/notifications'
      },
      
      eventSubscriptions: [
        {
          name: 'QREventNotifications',
          eventPattern: {
            source: ['kx-event-tracking'],
            detailType: ['qr.get', 'qr.scanned', 'form.submitted']
          },
          notificationMapping: {
            'qr.get': {
              targetType: 'client',
              clientId: (detail: any) => detail.clientId || detail.metadata?.clientId,
              title: 'QR Code Accessed',
              content: (detail: any) => `QR code ${detail.entityId} was accessed`,
              priority: 'low',
              metadata: (detail: any) => ({ ...detail, ...detail.metadata })
            }
          }
        }
      ]
    });

    new cdk.CfnOutput(this, 'YourApiUrl', {
      value: api.url,
      description: 'Your main API URL with integrated notifications and messages'
    });

    new cdk.CfnOutput(this, 'ExpectedEndpoints', {
      value: [
        `${api.url}health`,
        `${api.url}messages`,
        `${api.url}messages/{id}`,
        `${api.url}notifications`,
        `${api.url}notifications/{id}`
      ].join('\n'),
      description: 'All available endpoints'
    });
  }
}

// Deploy all tests
const app = new cdk.App();

new SameApiGatewayTest(app, 'SameApiGatewayTest', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

new SeparateApiGatewayTest(app, 'SeparateApiGatewayTest', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

new YourExactUseCaseTest(app, 'YourExactUseCaseTest', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

