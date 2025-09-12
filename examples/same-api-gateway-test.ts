import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

/**
 * Test case for the construct naming collision fix
 * 
 * This example demonstrates that both messages and notifications services
 * can now attach to the same API Gateway without CDK construct naming conflicts.
 * 
 * Previously this would fail with:
 * "The library is trying to create two constructs with the same name ('OPTIONS')"
 * 
 * Now it works because we create separate construct scopes:
 * - MessagesServiceScope/OPTIONS
 * - NotificationsServiceScope/OPTIONS
 */
export class SameApiGatewayTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create or import existing API Gateway
    const sharedApi = new apigateway.RestApi(this, 'SharedApi', {
      restApiName: 'shared-api-test',
      description: 'Test API Gateway shared by both services'
    });

    // This should now work without construct naming collisions
    new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'test-app',
      apiGatewayConfig: {
        // Both services use the SAME API Gateway
        existingMessagesApi: sharedApi,
        existingNotificationsApi: sharedApi,
        separateApis: false, // This is the key - same API for both
        
        // Different base paths on the same API
        messagesBasePath: '/api/messages',
        notificationsBasePath: '/api/notifications'
      },
      
      // Add some blackbox event processing for good measure
      eventSubscriptions: [
        {
          name: 'TestEvents',
          eventPattern: {
            source: ['test-system'],
            detailType: ['test.created']
          },
          notificationMapping: {
            'test.created': {
              targetType: 'broadcast',
              title: 'Test Notification',
              content: 'This is a test notification'
            }
          }
        }
      ]
    });

    // Output the shared API URL to verify it works
    new cdk.CfnOutput(this, 'SharedApiUrl', {
      value: sharedApi.url,
      description: 'Shared API Gateway URL with both services'
    });
  }
}

/**
 * Alternative test using imported existing API
 */
export class ImportedApiGatewayTest extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing API Gateway (replace with real API ID)
    const existingApi = apigateway.RestApi.fromRestApiId(this, 'ExistingApi', 'replace-with-real-api-id');

    // This should also work without naming collisions
    new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'imported-test',
      apiGatewayConfig: {
        existingMessagesApi: existingApi,
        existingNotificationsApi: existingApi,
        separateApis: false,
        messagesBasePath: '/v1/messages',
        notificationsBasePath: '/v1/notifications'
      }
    });
  }
}

