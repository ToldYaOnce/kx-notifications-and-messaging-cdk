import * as cdk from 'aws-cdk-lib';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

/**
 * Example: Blackbox Event Consumption
 * 
 * This example shows how to use the package as a blackbox that automatically
 * creates notifications and messages from EventBridge events without requiring
 * any consumer Lambda functions.
 */

const app = new cdk.App();

// Deploy the blackbox notifications system
const notificationStack = new NotificationMessagingStack(app, 'BlackboxNotificationStack', {
  resourcePrefix: 'myapp-blackbox',
  
  // 🎯 Blackbox Event Subscriptions - No Lambda functions needed!
  eventSubscriptions: [
    {
      name: 'LeadEvents',
      description: 'Auto-create notifications for lead events',
      eventPattern: {
        source: ['crm-system'],
        detailType: ['lead.created', 'lead.updated', 'lead.converted']
      },
      notificationMapping: {
        // When lead.created event arrives → Auto-create client notification
        'lead.created': {
          targetType: 'client',
          clientId: (detail) => detail.tenantId, // Extract from event
          title: 'New Lead Created',
          content: (detail) => `Lead ${detail.leadName} has been created and needs attention`,
          priority: 'medium',
          metadata: (detail) => ({
            leadId: detail.leadId,
            leadSource: detail.source,
            assignedTo: detail.assignedUserId
          })
        },
        
        // When lead.converted → Personal notification to sales rep
        'lead.converted': {
          targetType: 'user',
          userId: (detail) => detail.assignedUserId,
          title: '🎉 Lead Converted!',
          content: (detail) => `Congratulations! Lead ${detail.leadName} has been converted to a customer`,
          priority: 'high',
          metadata: (detail) => ({
            leadId: detail.leadId,
            conversionValue: detail.dealValue
          })
        }
      }
    },
    
    {
      name: 'UserEvents',
      description: 'Auto-create notifications for user events',
      eventPattern: {
        source: ['user-management'],
        detailType: ['user.signup', 'user.login.suspicious']
      },
      notificationMapping: {
        // Welcome notification for new users
        'user.signup': {
          targetType: 'user',
          userId: (detail) => detail.userId,
          title: 'Welcome to MyApp!',
          content: 'Your account has been created successfully. Get started by exploring our features.',
          priority: 'low'
        },
        
        // Security alert for suspicious logins
        'user.login.suspicious': {
          targetType: 'user',
          userId: (detail) => detail.userId,
          title: '🔒 Security Alert',
          content: (detail) => `Suspicious login detected from ${detail.location}. If this wasn't you, please secure your account.`,
          priority: 'urgent'
        }
      }
    },
    
    {
      name: 'SystemEvents',
      description: 'System-wide notifications',
      eventPattern: {
        source: ['system'],
        detailType: ['maintenance.scheduled', 'feature.released']
      },
      notificationMapping: {
        // Broadcast maintenance notifications to all users
        'maintenance.scheduled': {
          targetType: 'broadcast',
          title: '🔧 Scheduled Maintenance',
          content: (detail) => `System maintenance is scheduled for ${detail.scheduledTime}. Expected downtime: ${detail.duration}`,
          priority: 'high',
          targetClientIds: (detail) => detail.affectedClients || []
        },
        
        // Feature announcements
        'feature.released': {
          targetType: 'broadcast',
          title: '🚀 New Feature Available!',
          content: (detail) => `${detail.featureName} is now available. ${detail.description}`,
          priority: 'low'
        }
      }
    }
  ]
});

// 🎯 That's it! No Lambda functions needed!
// The system will automatically:
// 1. Listen for the specified EventBridge events
// 2. Create notifications/messages based on the templates
// 3. Store them in DynamoDB with proper targeting
// 4. Make them available via the REST APIs
// 5. Publish events for any downstream consumers

// Export API URLs for your applications
new cdk.CfnOutput(notificationStack, 'NotificationsApiUrl', {
  value: notificationStack.notificationsApi.url,
  description: 'Notifications REST API URL'
});

new cdk.CfnOutput(notificationStack, 'MessagesApiUrl', {
  value: notificationStack.messagesApi.url,
  description: 'Messages REST API URL'
});

// Example API usage after deployment:
/*

// Get all notifications for a user (personal + client + broadcast)
GET /notifications
Authorization: Bearer <jwt-token>

// Response will include:
{
  "success": true,
  "data": [
    {
      "notificationId": "notif-123",
      "title": "New Lead Created",
      "content": "Lead John Doe has been created and needs attention",
      "targetType": "client",
      "priority": "medium",
      "status": "unread",
      "metadata": {
        "leadId": "lead-456",
        "sourceEvent": "lead.created"
      }
    },
    {
      "notificationId": "notif-124", 
      "title": "🎉 Lead Converted!",
      "content": "Congratulations! Lead Jane Smith has been converted",
      "targetType": "user",
      "priority": "high",
      "status": "unread"
    }
  ],
  "sources": {
    "user": 1,
    "client": 1,
    "broadcast": 0
  }
}

*/
