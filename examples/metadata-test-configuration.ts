import * as cdk from 'aws-cdk-lib';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

/**
 * METADATA TESTING CONFIGURATION
 * 
 * This configuration tests the metadata functionality as requested.
 * Copy the notificationMapping section below into your eventSubscriptions.
 */

const app = new cdk.App();

const notificationStack = new NotificationMessagingStack(app, 'MetadataTestStack', {
  resourcePrefix: 'metadata-test',
  
  eventSubscriptions: [
    {
      name: 'QREventNotifications',
      description: 'Test metadata functionality with QR events',
      eventPattern: {
        source: ['kx-event-tracking'],
        detailType: ['qr.get', 'qr.scanned', 'form.submitted']
      },
      
      // 🧪 COPY THIS EXACT notificationMapping TO YOUR PROJECT:
      notificationMapping: {
        'qr.get': {
          targetType: 'client',
          clientId: (detail: any) => detail.clientId || detail.metadata?.clientId,
          title: 'QR Code Accessed',
          content: (detail: any) => `QR code ${detail.entityId} was accessed`,
          priority: 'low',
          metadata: (detail: any) => detail
        },
        'qr.scanned': {
          targetType: 'client',
          clientId: (detail: any) => detail.clientId || detail.metadata?.clientId,
          title: 'QR Code Scanned',
          content: (detail: any) => `QR code ${detail.entityId} was scanned`,
          priority: 'medium',
          metadata: (detail: any) => detail
        },
        'form.submitted': {
          targetType: 'client',
          clientId: (detail: any) => detail.clientId || detail.metadata?.clientId,
          title: 'Form Submitted',
          content: (detail: any) => 'New form submission received',
          priority: 'high',
          metadata: (detail: any) => detail
        }
      }
    }
  ]
});

/**
 * 🧪 TESTING STEPS:
 * 
 * STEP 1: Replace your current notification mapping
 * Copy the notificationMapping object above into your eventSubscriptions
 * 
 * STEP 2: Deploy the changes
 * Run: cdk deploy KxGenStack --require-approval never
 * 
 * STEP 3: Test QR code scan
 * Scan any QR code to trigger a notification
 * 
 * STEP 4: Check DynamoDB notification record
 * You should see a metadata field containing the entire original event like this:
 * {
 *   "targetKey": "client#tenant_1757418497028_g9o6mnb4m",
 *   "dateReceived": "2025-09-10T23:12:16.297Z",
 *   "content": "QR code uyoq0ez5il was accessed",
 *   "title": "QR Code Accessed",
 *   "priority": "low",
 *   "targetType": "client",
 *   "metadata": {
 *     "sourceEvent": "qr.get",           // ✅ Always added by package
 *     "sourceEventId": "event-uuid",     // ✅ Always added by package
 *     "eventId": "6f29564f-1c0e-4010-81d1-880087125125",     // ✅ From detail
 *     "clientId": "tenant_1757418497028_g9o6mnb4m",           // ✅ From detail
 *     "entityType": "qr",                                     // ✅ From detail
 *     "eventType": "get",                                     // ✅ From detail
 *     "occurredAt": "2025-09-10T15:46:00.907Z",              // ✅ From detail
 *     "entityId": "uyoq0ez5il",                               // ✅ From detail
 *     "metadata": {                                           // ✅ From detail.metadata
 *       "formId": "qwsd513e0g",
 *       "clientId": "tenant_1757418497028_g9o6mnb4m",
 *       "name": "Main Promo QR",
 *       "form": "badass form"
 *     }
 *   }
 * }
 * 
 * STEP 5: Access metadata in your frontend
 * Use these to access the data:
 * const eventId = notification.metadata.eventId;
 * const qrName = notification.metadata.metadata.name;
 * const formName = notification.metadata.metadata.form;
 * const formId = notification.metadata.metadata.formId;
 * const occurredAt = notification.metadata.occurredAt;
 * 
 * STEP 6: If metadata doesn't appear, test static version
 * Replace the metadata line with:
 * metadata: { test: 'static metadata works', version: '1.1.0' }
 * Then redeploy and test again.
 * 
 * STEP 7: If static metadata doesn't work either
 * The package version doesn't support the metadata field yet and needs to be updated in the source code.
 */

/**
 * 🔍 DEBUGGING TIPS:
 * 
 * 1. Check CloudWatch Logs for the internal-event-consumer Lambda:
 *    - Look for "🔧 Deserialized function for metadata: ..."
 *    - Look for "📝 Creating notification: ..." (shows full notification object)
 *    - Look for "✅ Notification created successfully"
 * 
 * 2. If you see "❌ Failed to deserialize function for metadata":
 *    - The function serialization failed
 *    - Try the static metadata test in Step 6
 * 
 * 3. Expected CloudWatch Log Flow:
 *    ✅ "📨 Internal consumer received event: ..."
 *    ✅ "🎯 Found 1 matching subscription(s)"
 *    ✅ "🔧 Deserialized function for clientId: ..."
 *    ✅ "🔧 Deserialized function for metadata: ..."
 *    ✅ "📝 Creating notification: ..." (with full metadata object)
 *    ✅ "✅ Notification created successfully"
 */
