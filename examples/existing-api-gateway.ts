import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

export class ExistingApiGatewayExample extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Example 1: Use your existing API Gateway for both messages and notifications
    const existingApi = apigateway.RestApi.fromRestApiId(this, 'ExistingApi', 'your-api-id');

    new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'my-app',
      apiGatewayConfig: {
        // Use the same API for both services
        existingMessagesApi: existingApi,
        existingNotificationsApi: existingApi,
        separateApis: false, // Both services on same API
        
        // Custom base paths (optional)
        messagesBasePath: '/api/v1/messages',
        notificationsBasePath: '/api/v1/notifications'
      },
      
      // Blackbox event processing
      eventSubscriptions: [
        {
          name: 'LeadNotifications',
          eventPattern: {
            source: ['crm-system'],
            detailType: ['lead.created', 'lead.updated']
          },
          notificationMapping: {
            'lead.created': {
              targetType: 'client',
              clientId: (detail) => detail.tenantId,
              title: 'New Lead Created',
              content: (detail) => `Lead ${detail.leadName} requires attention`,
              priority: 'high'
            },
            'lead.updated': {
              targetType: 'user',
              userId: (detail) => detail.assignedTo,
              title: 'Lead Updated',
              content: (detail) => `Lead ${detail.leadName} has been updated`
            }
          }
        }
      ]
    });
  }
}

export class SeparateApiGatewayExample extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Example 2: Use separate existing APIs for messages and notifications
    const messagesApi = apigateway.RestApi.fromRestApiId(this, 'MessagesApi', 'messages-api-id');
    const notificationsApi = apigateway.RestApi.fromRestApiId(this, 'NotificationsApi', 'notifications-api-id');

    new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'my-app',
      apiGatewayConfig: {
        existingMessagesApi: messagesApi,
        existingNotificationsApi: notificationsApi,
        separateApis: true, // Use separate APIs
        
        // Custom base paths
        messagesBasePath: '/messages',
        notificationsBasePath: '/notifications'
      }
    });
  }
}

export class MixedApiGatewayExample extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Example 3: Import existing API by attributes
    const existingApi = apigateway.RestApi.fromRestApiAttributes(this, 'ExistingApi', {
      restApiId: 'your-api-id',
      rootResourceId: 'root-resource-id'
    });

    new NotificationMessagingStack(this, 'NotificationsMessaging', {
      resourcePrefix: 'my-app',
      apiGatewayConfig: {
        existingMessagesApi: existingApi,
        existingNotificationsApi: existingApi,
        separateApis: false,
        messagesBasePath: '/v2/messages',
        notificationsBasePath: '/v2/notifications'
      },
      
      // Mix existing API with blackbox processing
      eventSubscriptions: [
        {
          name: 'UserEvents',
          eventPattern: {
            source: ['user-service'],
            detailType: ['user.registered', 'user.upgraded']
          },
          notificationMapping: {
            'user.registered': {
              targetType: 'broadcast',
              title: 'Welcome New User!',
              content: (detail) => `${detail.userName} just joined us!`,
              priority: 'low'
            }
          }
        }
      ]
    });
  }
}
