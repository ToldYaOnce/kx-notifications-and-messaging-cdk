import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { 
  EventSubscription, 
  NotificationTemplate, 
  MessageTemplate,
  MessageTargetType,
  MessagePriority 
} from '../types';

// ⚡ COLD START OPTIMIZATION: Initialize clients outside handler
const dynamoClient = new DynamoDBClient({ 
  region: process.env.AWS_REGION,
  maxAttempts: 3 // Retry failed requests
});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true // Clean up undefined values
  }
});

// ⚡ COLD START OPTIMIZATION: Pre-parse subscriptions outside handler
let cachedSubscriptions: EventSubscription[] | null = null;

/**
 * Deserialize event subscriptions by converting function strings back to functions
 */
function deserializeEventSubscriptions(subscriptionsJson: string): EventSubscription[] {
  const parsed = JSON.parse(subscriptionsJson);
  
  return parsed.map((subscription: any) => {
    const deserialized = { ...subscription };
    
    // Deserialize notification mapping functions
    if (subscription.notificationMapping) {
      deserialized.notificationMapping = {};
      for (const [key, template] of Object.entries(subscription.notificationMapping)) {
        deserialized.notificationMapping[key] = deserializeTemplate(template as any);
      }
    }
    
    // Deserialize message mapping functions
    if (subscription.messageMapping) {
      deserialized.messageMapping = {};
      for (const [key, template] of Object.entries(subscription.messageMapping)) {
        deserialized.messageMapping[key] = deserializeTemplate(template as any);
      }
    }
    
    return deserialized;
  });
}

/**
 * Deserialize a template by converting function strings back to functions
 */
function deserializeTemplate(template: any): any {
  const deserialized = { ...template };
  
  // List of properties that can be functions
  const functionProperties = [
    'title', 'content', 'clientId', 'userId', 'targetUserIds', 'targetClientIds', 
    'metadata', 'icon', 'category', 'actionUrl', 'tags', 'displayDuration', 'sound'
  ];
  
  for (const prop of functionProperties) {
    if (template[prop] && typeof template[prop] === 'object' && template[prop].__isFunction) {
      // Convert function string back to function
      try {
        // Use eval to reconstruct the function (safe in this controlled environment)
        deserialized[prop] = eval(`(${template[prop].__functionString})`);
        console.log(`🔧 Deserialized function for ${prop}:`, template[prop].__functionString);
      } catch (error) {
        console.error(`❌ Failed to deserialize function for ${prop}:`, error);
        // Keep the original value as fallback
        deserialized[prop] = template[prop];
      }
    }
  }
  
  return deserialized;
}

/**
 * Internal EventBridge consumer that automatically creates notifications/messages
 * based on configured event subscriptions
 */
export const handler = async (event: EventBridgeEvent<string, any>) => {
  console.log('📨 Internal consumer received event:', JSON.stringify(event, null, 2));
  
  const { source, 'detail-type': detailType, detail } = event;
  
  try {
    // ⚡ COLD START OPTIMIZATION: Use cached subscriptions if available
    let subscriptions: EventSubscription[];
    
    if (cachedSubscriptions) {
      console.log('⚡ Using cached subscriptions (warm start)');
      subscriptions = cachedSubscriptions;
    } else {
      console.log('🔥 Parsing subscriptions (cold start)');
      // Get event subscriptions from environment (passed by CDK)
      const subscriptionsJson = process.env.EVENT_SUBSCRIPTIONS;
      if (!subscriptionsJson) {
        console.log('ℹ️ No event subscriptions configured');
        return;
      }
      
      subscriptions = deserializeEventSubscriptions(subscriptionsJson);
      cachedSubscriptions = subscriptions; // Cache for next invocation
      console.log('✅ Subscriptions cached for future invocations');
    }
    
    // Find matching subscriptions
    const matchingSubscriptions = subscriptions.filter(subscription => 
      matchesEventPattern(event, subscription.eventPattern)
    );
    
    if (matchingSubscriptions.length === 0) {
      console.log(`ℹ️ No matching subscriptions for ${source}:${detailType}`);
      return;
    }
    
    console.log(`🎯 Found ${matchingSubscriptions.length} matching subscription(s)`);
    
    // Process each matching subscription
    for (const subscription of matchingSubscriptions) {
      await processSubscription(subscription, event, detail);
    }
    
  } catch (error) {
    console.error('❌ Error processing event:', error);
    throw error; // This will trigger EventBridge retry
  }
};

/**
 * Check if event matches the subscription pattern
 */
function matchesEventPattern(event: EventBridgeEvent<string, any>, pattern: any): boolean {
  const { source, 'detail-type': detailType } = event;
  
  // Check source
  if (pattern.source && !pattern.source.includes(source)) {
    return false;
  }
  
  // Check detail type
  if (pattern.detailType && !pattern.detailType.includes(detailType)) {
    return false;
  }
  
  // TODO: Add detail field matching if needed
  
  return true;
}

/**
 * Process a matching subscription
 */
async function processSubscription(
  subscription: EventSubscription, 
  event: EventBridgeEvent<string, any>, 
  detail: any
) {
  const detailType = event['detail-type'];
  
  // Process notification mappings
  if (subscription.notificationMapping && subscription.notificationMapping[detailType]) {
    const template = subscription.notificationMapping[detailType];
    await createNotificationFromTemplate(template, detail, event);
  }
  
  // Process message mappings
  if (subscription.messageMapping && subscription.messageMapping[detailType]) {
    const template = subscription.messageMapping[detailType];
    await createMessageFromTemplate(template, detail, event);
  }
}

/**
 * Create notification from template
 */
async function createNotificationFromTemplate(
  template: NotificationTemplate, 
  detail: any, 
  event: EventBridgeEvent<string, any>
) {
  try {
    const notification = {
      notificationId: uuidv4(),
      targetKey: buildTargetKey(template.targetType, template, detail),
      dateReceived: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      targetType: template.targetType,
      title: resolveValue(template.title, detail),
      content: resolveValue(template.content, detail) || '',
      priority: template.priority || 'medium' as MessagePriority,
      metadata: {
        sourceEvent: event['detail-type'],
        sourceEventId: event.id,
        ...resolveValue(template.metadata, detail)
      },
      
      // 🎨 Rich UI metadata properties
      ...(template.icon && { icon: resolveValue(template.icon, detail) }),
      ...(template.category && { category: resolveValue(template.category, detail) }),
      ...(template.actionUrl && { actionUrl: resolveValue(template.actionUrl, detail) }),
      ...(template.tags && { tags: resolveValue(template.tags, detail) }),
      ...(template.displayDuration && { displayDuration: resolveValue(template.displayDuration, detail) }),
      ...(template.sound && { sound: resolveValue(template.sound, detail) })
    };
    
    // Add target-specific fields
    if (template.targetType === 'client' && template.targetUserIds) {
      (notification.metadata as any).targetUserIds = resolveValue(template.targetUserIds, detail);
    }
    
    if (template.targetType === 'broadcast' && template.targetClientIds) {
      (notification.metadata as any).targetClientIds = resolveValue(template.targetClientIds, detail);
    }
    
    console.log('📝 Creating notification:', notification);
    
    await dynamodb.send(new PutCommand({
      TableName: process.env.NOTIFICATIONS_TABLE_NAME!,
      Item: notification
    }));
    
    console.log('✅ Notification created successfully');
    
  } catch (error) {
    console.error('❌ Error creating notification:', error);
    throw error;
  }
}

/**
 * Create message from template
 */
async function createMessageFromTemplate(
  template: MessageTemplate, 
  detail: any, 
  event: EventBridgeEvent<string, any>
) {
  try {
    const message = {
      messageId: uuidv4(),
      targetKey: buildTargetKey(template.targetType, template, detail),
      dateReceived: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      targetType: template.targetType,
      content: resolveValue(template.content, detail),
      title: resolveValue(template.title, detail),
      priority: template.priority || 'medium' as MessagePriority,
      metadata: {
        sourceEvent: event['detail-type'],
        sourceEventId: event.id,
        ...resolveValue(template.metadata, detail)
      },
      
      // 🎨 Rich UI metadata properties
      ...(template.icon && { icon: resolveValue(template.icon, detail) }),
      ...(template.category && { category: resolveValue(template.category, detail) }),
      ...(template.actionUrl && { actionUrl: resolveValue(template.actionUrl, detail) }),
      ...(template.tags && { tags: resolveValue(template.tags, detail) }),
      ...(template.displayDuration && { displayDuration: resolveValue(template.displayDuration, detail) }),
      ...(template.sound && { sound: resolveValue(template.sound, detail) })
    };
    
    // Add target-specific fields
    if (template.targetType === 'client' && template.targetUserIds) {
      (message.metadata as any).targetUserIds = resolveValue(template.targetUserIds, detail);
    }
    
    if (template.targetType === 'broadcast' && template.targetClientIds) {
      (message.metadata as any).targetClientIds = resolveValue(template.targetClientIds, detail);
    }
    
    console.log('📝 Creating message:', message);
    
    await dynamodb.send(new PutCommand({
      TableName: process.env.MESSAGES_TABLE_NAME!,
      Item: message
    }));
    
    console.log('✅ Message created successfully');
    
  } catch (error) {
    console.error('❌ Error creating message:', error);
    throw error;
  }
}

/**
 * Build target key based on target type
 */
function buildTargetKey(
  targetType: MessageTargetType, 
  template: NotificationTemplate | MessageTemplate, 
  detail: any
): string {
  switch (targetType) {
    case 'user':
      const userId = resolveValue(template.userId, detail);
      if (!userId) {
        throw new Error('userId is required for user-targeted notifications');
      }
      return `user#${userId}`;
      
    case 'client':
      const clientId = resolveValue(template.clientId, detail);
      if (!clientId) {
        throw new Error('clientId is required for client-targeted notifications');
      }
      return `client#${clientId}`;
      
    case 'broadcast':
      return 'broadcast';
      
    default:
      throw new Error(`Unknown target type: ${targetType}`);
  }
}

/**
 * Resolve template value (can be string or function)
 */
function resolveValue<T>(value: T | ((detail: any) => T) | undefined, detail: any): T | undefined {
  if (typeof value === 'function') {
    return (value as (detail: any) => T)(detail);
  }
  return value;
}
