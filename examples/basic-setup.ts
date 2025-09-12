/**
 * Basic setup examples for @toldyaonce/kx-notifications-and-messaging-cdk
 * 
 * Shows both API-only and blackbox event processing approaches
 */

import * as cdk from 'aws-cdk-lib';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

const app = new cdk.App();

// 🚀 Option 1: API-Only (Simplest Setup)
// Perfect for getting started - just deploy and use the APIs
const apiOnlyStack = new NotificationMessagingStack(app, 'ApiOnlyStack', {
  resourcePrefix: 'myapp-api-only'
  // No eventSubscriptions or eventBridgeRules needed!
  // APIs work immediately after deployment
});

// 🎯 Option 2: Blackbox Event Processing (New EventBridge)
// Automatically creates notifications from EventBridge events - no Lambda functions needed!
const blackboxStack = new NotificationMessagingStack(app, 'BlackboxStack', {
  resourcePrefix: 'myapp-blackbox',
  
  // Configure what events to listen for and how to create notifications
  eventSubscriptions: [
    {
      name: 'LeadNotifications',
      description: 'Auto-create notifications when leads are created',
      eventPattern: {
        source: ['crm-system'],
        detailType: ['lead.created']
      },
      notificationMapping: {
        'lead.created': {
          targetType: 'client', // All employees in the tenant see this
          clientId: (detail) => detail.tenantId,
          title: 'New Lead Created',
          content: (detail) => `Lead ${detail.leadName} needs attention`,
          priority: 'medium',
          metadata: (detail) => ({
            leadId: detail.leadId,
            sourceEvent: 'lead.created'
          })
        }
      }
    }
  ]
});

// 🔌 Option 3: Use Existing EventBridge (v1.0.11+)
// Perfect for integrating with existing infrastructure - eliminates CloudFormation conflicts!
/*
const existingEventBusStack = new NotificationMessagingStack(app, 'ExistingEventBusStack', {
  resourcePrefix: 'myapp-existing',
  
  // Use your existing EventBridge instead of creating a new one
  existingEventBus: yourExistingEventBridge, // Pass your existing EventBridge here
  
  eventSubscriptions: [
    {
      name: 'ExistingBusNotifications',
      eventPattern: {
        source: ['your-existing-source'],
        detailType: ['your.existing.event']
      },
      notificationMapping: {
        'your.existing.event': {
          targetType: 'broadcast',
          title: 'Event from Existing Bus',
          content: (detail) => `Event received: ${detail.message}`
        }
      }
    }
  ]
});
*/

// Export API URLs
new cdk.CfnOutput(apiOnlyStack, 'ApiOnlyNotificationsUrl', {
  value: apiOnlyStack.notificationsApi.url,
  description: 'API-Only Notifications REST API URL'
});

new cdk.CfnOutput(blackboxStack, 'BlackboxNotificationsUrl', {
  value: blackboxStack.notificationsApi.url,
  description: 'Blackbox Notifications REST API URL (with auto event processing)'
});

/*
Usage after deployment:

API-Only Stack:
- Call POST /notifications to create notifications manually
- Call GET /notifications to retrieve them

Blackbox Stack:
- Publishes lead.created events to EventBridge
- Notifications are automatically created and stored
- Call GET /notifications to retrieve them (includes auto-created ones)
- No Lambda functions needed!
*/
