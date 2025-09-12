import * as cdk from 'aws-cdk-lib';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

/**
 * Example: Fixed clientId Bug + Rich UI Metadata Support
 * 
 * This example demonstrates:
 * 1. ✅ FIXED: clientId mapping functions are now properly called
 * 2. 🎨 NEW: Rich UI metadata properties for better notification display
 * 3. 🔄 BACKWARD COMPATIBLE: Existing configurations still work
 */

const app = new cdk.App();

const notificationStack = new NotificationMessagingStack(app, 'FixedNotificationStack', {
  resourcePrefix: 'myapp-fixed',
  
  eventSubscriptions: [
    {
      name: 'QREventNotifications',
      description: 'Auto-create notifications from QR events - FIXED clientId mapping!',
      eventPattern: {
        source: ['kx-event-tracking'],
        detailType: ['qr.get', 'qr.scanned', 'form.submitted']
      },
      notificationMapping: {
        // 🐛 FIXED: This clientId function will now be called properly!
        'qr.get': {
          targetType: 'client',
          clientId: (detail: any) => {
            console.log('🧀💥 DEBUG: QR.GET clientId mapping called with detail:', JSON.stringify(detail, null, 2));
            const result = detail.clientId || detail.metadata?.clientId || 'default-client';
            console.log('🧀💥 DEBUG: QR.GET clientId result:', result);
            return result;
          },
          title: (detail: any) => `${detail.metadata?.name || 'QR Code'} Accessed`,
          content: (detail: any) => `Someone viewed your QR code at ${new Date(detail.occurredAt).toLocaleString()}`,
          priority: 'low',
          
          // 🎨 NEW: Rich UI metadata properties
          icon: '🔍',
          category: 'qr-activity',
          actionUrl: (detail: any) => `/dashboard/qr/${detail.entityId}`,
          metadata: (detail: any) => ({
            qrName: detail.metadata?.name,
            formName: detail.metadata?.form,
            timestamp: detail.occurredAt,
            entityId: detail.entityId
          }),
          tags: ['qr', 'access', 'engagement'],
          displayDuration: 5000,
          sound: 'notification-soft'
        },
        
        'qr.scanned': {
          targetType: 'client',
          clientId: (detail: any) => detail.clientId || detail.metadata?.clientId,
          title: (detail: any) => `📱 QR Code Scanned: ${detail.metadata?.name}`,
          content: (detail: any) => `Your QR code was scanned by a visitor at ${new Date(detail.occurredAt).toLocaleString()}`,
          priority: 'medium',
          
          // 🎨 Rich UI with dynamic functions
          icon: '📱',
          category: 'qr-engagement',
          actionUrl: (detail: any) => `/dashboard/qr/${detail.entityId}/analytics`,
          metadata: (detail: any) => ({
            qrName: detail.metadata?.name,
            scanLocation: detail.metadata?.location,
            userAgent: detail.metadata?.userAgent,
            timestamp: detail.occurredAt,
            entityId: detail.entityId,
            conversionEvent: true
          }),
          tags: (detail: any) => ['qr', 'scan', 'conversion', detail.metadata?.source || 'unknown'],
          displayDuration: (detail: any) => detail.metadata?.important ? 10000 : 7000,
          sound: 'notification-success'
        },
        
        'form.submitted': {
          targetType: 'client', 
          clientId: (detail: any) => detail.clientId || detail.metadata?.clientId,
          title: (detail: any) => `📝 Form Submitted: ${detail.metadata?.form || 'Contact Form'}`,
          content: (detail: any) => `New form submission received from ${detail.metadata?.name || 'visitor'}`,
          priority: 'high',
          
          // 🎨 Form-specific UI metadata
          icon: '📝',
          category: 'form-submissions',
          actionUrl: (detail: any) => `/dashboard/forms/${detail.entityId}`,
          metadata: (detail: any) => ({
            formName: detail.metadata?.form,
            submitterName: detail.metadata?.name,
            submitterEmail: detail.metadata?.email,
            timestamp: detail.occurredAt,
            entityId: detail.entityId,
            requiresResponse: true
          }),
          tags: ['form', 'submission', 'lead', 'urgent'],
          displayDuration: 0, // Don't auto-dismiss
          sound: 'notification-urgent'
        }
      }
    },
    
    // 🔄 BACKWARD COMPATIBILITY: Old configurations still work
    {
      name: 'LegacyNotifications',
      description: 'Existing configurations without new UI properties',
      eventPattern: {
        source: ['legacy-system'],
        detailType: ['user.created']
      },
      notificationMapping: {
        'user.created': {
          targetType: 'client',
          clientId: (detail: any) => detail.tenantId, // This function will now work!
          title: 'New User Created',
          content: (detail: any) => `User ${detail.userName} has joined your organization`,
          priority: 'medium'
          // No UI metadata properties - should work fine
        }
      }
    },
    
    // 🎨 STATIC VALUES: Mix of static and dynamic properties
    {
      name: 'SystemAlerts',
      description: 'System alerts with mix of static and dynamic UI properties',
      eventPattern: {
        source: ['system'],
        detailType: ['alert.critical', 'alert.warning']
      },
      notificationMapping: {
        'alert.critical': {
          targetType: 'broadcast',
          title: (detail: any) => `🚨 CRITICAL: ${detail.alertType}`,
          content: (detail: any) => detail.message,
          priority: 'urgent',
          
          // Mix of static and dynamic properties
          icon: '🚨', // Static
          category: 'system-alerts', // Static
          actionUrl: (detail: any) => `/admin/alerts/${detail.alertId}`, // Dynamic
          tags: ['system', 'critical', 'alert'], // Static array
          displayDuration: 0, // Static - don't auto-dismiss
          sound: 'alert-critical' // Static
        },
        
        'alert.warning': {
          targetType: 'broadcast',
          title: (detail: any) => `⚠️ WARNING: ${detail.alertType}`,
          content: (detail: any) => detail.message,
          priority: 'medium',
          
          icon: '⚠️',
          category: 'system-alerts',
          actionUrl: (detail: any) => `/admin/alerts/${detail.alertId}`,
          tags: (detail: any) => ['system', 'warning', detail.severity], // Dynamic array
          displayDuration: 8000,
          sound: 'alert-warning'
        }
      }
    }
  ]
});

// Export API URLs
new cdk.CfnOutput(notificationStack, 'NotificationsApiUrl', {
  value: notificationStack.notificationsApi.url,
  description: 'Notifications REST API URL'
});

new cdk.CfnOutput(notificationStack, 'MessagesApiUrl', {
  value: notificationStack.messagesApi.url,
  description: 'Messages REST API URL'
});

/**
 * 🧪 TESTING THE FIXES
 * 
 * To test the clientId bug fix, send this event to EventBridge:
 * 
 * {
 *   "Source": "kx-event-tracking",
 *   "DetailType": "qr.get",
 *   "Detail": {
 *     "clientId": "tenant_1757418497028_g9o6mnb4m",
 *     "entityId": "uyoq0ez5il",
 *     "occurredAt": "2024-01-15T10:30:00Z",
 *     "metadata": {
 *       "clientId": "tenant_1757418497028_g9o6mnb4m",
 *       "name": "Main Promo QR",
 *       "form": "Contact Form",
 *       "important": true
 *     }
 *   }
 * }
 * 
 * Expected CloudWatch Logs:
 * ✅ "🧀💥 DEBUG: QR.GET clientId mapping called with detail: {...}"
 * ✅ "🧀💥 DEBUG: QR.GET clientId result: tenant_1757418497028_g9o6mnb4m"
 * ✅ "📝 Creating notification: {...}" (with all UI metadata properties)
 * ✅ "✅ Notification created successfully"
 * 
 * The notification will now include:
 * - icon: "🔍"
 * - category: "qr-activity"  
 * - actionUrl: "/dashboard/qr/uyoq0ez5il"
 * - tags: ["qr", "access", "engagement"]
 * - displayDuration: 5000
 * - sound: "notification-soft"
 * - metadata: { qrName: "Main Promo QR", formName: "Contact Form", ... }
 */

