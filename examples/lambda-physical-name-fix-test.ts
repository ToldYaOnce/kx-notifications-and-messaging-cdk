import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { NotificationMessagingStack } from '../src/stacks/notifications-messaging-stack';

/**
 * TEST: v1.1.7 Lambda Physical Name Fix
 * 
 * BEFORE v1.1.7: This would fail with:
 * "ValidationError: Cannot use resource 'TestStack/NotificationsMessaging/MessagesServiceScope/ServiceFunction' 
 *  in a cross-environment fashion, the resource's physical name must be explicit set"
 * 
 * AFTER v1.1.7: Lambda functions have explicit names based on resourcePrefix!
 */
export class LambdaPhysicalNameFixTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create your main API Gateway (simulating your AppStack)
    const api = new apigateway.RestApi(this, 'MainApi', {
      restApiName: 'Test Application API',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO
      }
    });

    // Add some existing endpoints
    const health = api.root.addResource('health');
    health.addMethod('GET', new apigateway.MockIntegration({
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

    // 🎯 TEST: This should now work without validation errors!
    const notificationStack = new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'TestApp',  // This will create Lambda functions with explicit names
      
      // API Gateway integration that previously failed
      apiGatewayConfig: {
        existingMessagesApi: api,           // Same stack reference
        existingNotificationsApi: api,      // Same stack reference
        separateApis: false,                // Use same API
        messagesBasePath: '/messages',
        notificationsBasePath: '/notifications'
      },
      
      // Optional: Test with event subscriptions too
      eventSubscriptions: [
        {
          name: 'TestNotifications',
          eventPattern: { 
            source: ['test-app'], 
            detailType: ['user.test'] 
          },
          notificationMapping: {
            'user.test': {
              targetType: 'user',
              userId: (detail: any) => detail.userId,
              title: 'Test Notification',
              content: 'Lambda physical names are now explicit!',
              metadata: (detail: any) => ({
                testId: detail.testId,
                timestamp: detail.timestamp
              })
            }
          }
        }
      ]
    });

    // Outputs to verify the Lambda functions have explicit names
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Main API URL with integrated notifications and messages'
    });

    new cdk.CfnOutput(this, 'ExpectedLambdaNames', {
      value: [
        'testapp-messages-service',      // Expected Lambda function name
        'testapp-notifications-service'  // Expected Lambda function name
      ].join(', '),
      description: 'Expected Lambda function names (explicit physical names)'
    });

    new cdk.CfnOutput(this, 'AvailableEndpoints', {
      value: [
        `${api.url}health`,
        `${api.url}messages`,
        `${api.url}messages/{id}`,
        `${api.url}notifications`,
        `${api.url}notifications/{id}`
      ].join('\n'),
      description: 'All available API endpoints'
    });
  }
}

// Test with your exact pattern
export class YourExactPatternTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Simulate your AppStack pattern exactly
    const api = new apigateway.RestApi(this, 'MainApi', {
      deployOptions: { stageName: 'prod' }
    });

    // 🎯 YOUR EXACT PATTERN: This should now work!
    const notificationStack = new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'KxGen',  // Your exact prefix
      
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
      description: 'Your API URL - should work without validation errors!'
    });

    new cdk.CfnOutput(this, 'YourLambdaNames', {
      value: [
        'kxgen-messages-service',      // Your Lambda function names
        'kxgen-notifications-service'  // Your Lambda function names
      ].join(', '),
      description: 'Your Lambda function names (now explicit)'
    });
  }
}

// Deploy the tests
const app = new cdk.App();

new LambdaPhysicalNameFixTest(app, 'LambdaPhysicalNameFixTest', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  }
});

new YourExactPatternTest(app, 'YourExactPatternTest', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  }
});

