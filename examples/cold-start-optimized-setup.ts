import * as cdk from 'aws-cdk-lib';
import { NotificationMessagingStack } from '@toldyaonce/kx-notifications-and-messaging-cdk';

/**
 * COLD START OPTIMIZED SETUP
 * 
 * This example shows how to configure the package to minimize Lambda cold start issues
 * for the internal EventBridge consumer.
 */

const app = new cdk.App();

// 🚀 OPTION 1: Standard Optimizations (Recommended)
const optimizedStack = new NotificationMessagingStack(app, 'OptimizedNotificationStack', {
  resourcePrefix: 'myapp-optimized',
  
  eventSubscriptions: [
    {
      name: 'QREventNotifications',
      description: 'QR events with cold start optimizations',
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
          metadata: (detail: any) => detail
        }
      }
    }
  ],
  
  // 🚀 COLD START OPTIMIZATIONS ENABLED:
  // - NodeJS 20.x runtime (faster)
  // - 1024MB memory (faster cold starts)
  // - 60s timeout (handles cold start delays)
  // - Reserved concurrency (prevents cold starts under load)
  // - EventBridge retries (3 attempts with 1hr max age)
  // - Connection reuse enabled
  // - Minified bundles
  // - Cached subscription parsing
});

// 🔥 OPTION 2: Maximum Performance (Higher Cost)
const highPerfStack = new NotificationMessagingStack(app, 'HighPerfNotificationStack', {
  resourcePrefix: 'myapp-highperf',
  
  eventSubscriptions: [
    {
      name: 'CriticalEvents',
      description: 'Critical events requiring zero cold starts',
      eventPattern: {
        source: ['critical-system'],
        detailType: ['payment.failed', 'security.breach']
      },
      notificationMapping: {
        'payment.failed': {
          targetType: 'broadcast',
          title: '🚨 Payment Failed',
          content: (detail: any) => `Payment ${detail.paymentId} failed: ${detail.reason}`,
          priority: 'urgent',
          metadata: (detail: any) => detail
        }
      }
    }
  ],
  
  // 💰 PROVISIONED CONCURRENCY: Eliminates cold starts completely
  // Costs ~$15/month per provisioned execution but guarantees warm instances
  internalEventConsumerProps: {
    enableProvisionedConcurrency: true,
    provisionedConcurrency: 2 // Keep 2 warm instances always ready
  }
});

/**
 * 📊 COLD START OPTIMIZATIONS EXPLAINED:
 * 
 * 1. **Runtime Upgrade**: NodeJS 20.x has faster startup than 18.x
 * 
 * 2. **Memory Increase**: 1024MB vs 512MB
 *    - More CPU allocated (proportional to memory)
 *    - Faster initialization and execution
 *    - Cost increase: ~$0.50/month for typical usage
 * 
 * 3. **Timeout Increase**: 60s vs 30s
 *    - Handles cold start delays gracefully
 *    - Prevents timeout failures on first event
 * 
 * 4. **Reserved Concurrency**: Limits to 5 concurrent executions
 *    - Prevents Lambda from scaling to cold instances under load
 *    - Keeps instances warm longer
 * 
 * 5. **EventBridge Retries**: 3 attempts with 1hr max age
 *    - If cold start causes timeout, EventBridge retries
 *    - Second attempt usually hits warm instance
 * 
 * 6. **Connection Reuse**: AWS_NODEJS_CONNECTION_REUSE_ENABLED=1
 *    - Reuses HTTP connections between invocations
 *    - Faster DynamoDB operations on warm starts
 * 
 * 7. **Bundle Optimizations**: Minified, modern target
 *    - Smaller bundle = faster download and initialization
 *    - ES2022 target uses modern JS features
 * 
 * 8. **Subscription Caching**: Parse once, cache for warm starts
 *    - Cold start: Parse subscriptions from JSON + eval functions
 *    - Warm start: Use cached parsed subscriptions
 * 
 * 9. **Client Initialization**: DynamoDB client created outside handler
 *    - Reused across warm invocations
 *    - Configured with retries and timeouts
 */

/**
 * 🔍 MONITORING COLD STARTS:
 * 
 * Check CloudWatch Logs for these patterns:
 * 
 * COLD START (First Event):
 * ✅ "🔥 Parsing subscriptions (cold start)"
 * ✅ "🔧 Deserialized function for clientId: ..."
 * ✅ "✅ Subscriptions cached for future invocations"
 * 
 * WARM START (Subsequent Events):
 * ✅ "⚡ Using cached subscriptions (warm start)"
 * ✅ "📝 Creating notification: ..." (much faster)
 * 
 * If you see repeated cold start messages, consider:
 * - Enabling provisioned concurrency
 * - Increasing reserved concurrency
 * - Adding a CloudWatch Event to ping the function every 5 minutes
 */

/**
 * 🚨 TROUBLESHOOTING COLD START ISSUES:
 * 
 * SYMPTOM: First event never creates notification
 * CAUSE: Cold start timeout (30s default too short)
 * SOLUTION: ✅ Timeout increased to 60s
 * 
 * SYMPTOM: First event creates notification, but very slowly
 * CAUSE: Cold start initialization time
 * SOLUTION: ✅ Memory increased to 1024MB, caching added
 * 
 * SYMPTOM: Every event seems like cold start
 * CAUSE: High concurrency creating new instances
 * SOLUTION: ✅ Reserved concurrency limits scaling
 * 
 * SYMPTOM: Events lost during cold starts
 * CAUSE: EventBridge not retrying failed invocations
 * SOLUTION: ✅ Retry configuration added (3 attempts, 1hr max age)
 */

export { optimizedStack, highPerfStack };

