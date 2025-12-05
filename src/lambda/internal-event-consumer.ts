import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
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
    'channelId', 'senderId', // Channel message fields
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
 * 🤖 AGENT EVENT HANDLERS
 * Handle events from kx-langchain-agent to update channel workflow state
 */

/**
 * Route agent events to appropriate handlers
 */
async function handleAgentEvent(
  event: EventBridgeEvent<string, any>,
  detailType: string,
  detail: any
) {
  console.log(`🤖 Handling agent event: ${detailType}`);
  
  switch (detailType) {
    case 'agent.workflow.state_updated':
      await handleWorkflowStateUpdated(detail);
      break;
      
    case 'lead.created':
      await handleLeadCreated(detail);
      break;
      
    case 'agent.goal.completed':
      await handleGoalCompleted(detail);
      break;
      
    case 'agent.goal.activated':
      await handleGoalActivated(detail);
      break;
      
    case 'agent.data.captured':
      await handleDataCaptured(detail);
      break;
      
    case 'appointment.requested':
      await handleAppointmentRequested(detail);
      break;
      
    case 'agent.workflow.error':
      await handleWorkflowError(detail);
      break;
      
    default:
      console.log(`ℹ️ No specific handler for agent event: ${detailType}`);
  }
}

/**
 * Handle workflow state updates - fired after every message
 */
async function handleWorkflowStateUpdated(detail: any) {
  console.log('🔄 Updating workflow state for channel:', detail.channelId);
  
  const { channelId, tenantId, activeGoals, completedGoals, messageCount, capturedData, contactStatus } = detail;
  
  if (!channelId) {
    console.error('❌ Missing channelId in workflow state update');
    return;
  }
  
  try {
    // Get current channel to preserve createdAt (sort key)
    const channelResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId }
    }));
    
    if (!channelResult.Item) {
      console.warn(`⚠️ Channel ${channelId} not found, skipping workflow state update`);
      return;
    }
    
    const currentGoalOrder = channelResult.Item.workflowState?.currentGoalOrder || 0;
    const emittedEvents = channelResult.Item.workflowState?.emittedEvents || [];
    
    // Update channel with new workflow state
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { 
        channelId,
        createdAt: channelResult.Item.createdAt
      },
      UpdateExpression: `
        SET workflowState = :workflowState,
            lastActivity = :lastActivity,
            updated_at = :updated_at
      `,
      ExpressionAttributeValues: {
        ':workflowState': {
          activeGoals: activeGoals || [],
          completedGoals: completedGoals || [],
          currentGoalOrder,
          messageCount: messageCount || 0,
          capturedData: capturedData || {},
          isEmailCaptured: contactStatus?.isEmailCaptured || false,
          isPhoneCaptured: contactStatus?.isPhoneCaptured || false,
          isFirstNameCaptured: contactStatus?.isFirstNameCaptured || false,
          isLastNameCaptured: contactStatus?.isLastNameCaptured || false,
          emittedEvents,
          lastUpdated: detail.timestamp || new Date().toISOString()
        },
        ':lastActivity': detail.timestamp || new Date().toISOString(),
        ':updated_at': new Date().toISOString()
      }
    }));
    
    console.log('✅ Workflow state updated successfully');
    
  } catch (error) {
    console.error('❌ Error updating workflow state:', error);
    throw error;
  }
}

/**
 * Handle lead creation event
 */
async function handleLeadCreated(detail: any) {
  console.log('🎯 Lead created for channel:', detail.channelId);
  
  const { channelId, leadId, tenantId, contactInfo, capturedData } = detail;
  
  if (!channelId) {
    console.error('❌ Missing channelId in lead.created event');
    return;
  }
  
  try {
    // Get current channel
    const channelResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId }
    }));
    
    if (!channelResult.Item) {
      console.warn(`⚠️ Channel ${channelId} not found for lead creation`);
      return;
    }
    
    const currentWorkflowState = channelResult.Item.workflowState || {};
    const emittedEvents = [...(currentWorkflowState.emittedEvents || []), 'lead.created'];
    
    // Update channel with lead status and contact info
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { 
        channelId,
        createdAt: channelResult.Item.createdAt
      },
      UpdateExpression: `
        SET leadStatus = :leadStatus,
            workflowState.emittedEvents = :emittedEvents,
            metadata.contactInfo = :contactInfo,
            metadata.capturedData = :capturedData,
            lastActivity = :lastActivity,
            updated_at = :updated_at
      `,
      ExpressionAttributeValues: {
        ':leadStatus': 'qualified',
        ':emittedEvents': emittedEvents,
        ':contactInfo': contactInfo || {},
        ':capturedData': capturedData || {},
        ':lastActivity': detail.timestamp || new Date().toISOString(),
        ':updated_at': new Date().toISOString()
      }
    }));
    
    console.log('✅ Lead status updated successfully');
    
  } catch (error) {
    console.error('❌ Error updating lead status:', error);
    throw error;
  }
}

/**
 * Handle goal completion event
 */
async function handleGoalCompleted(detail: any) {
  console.log('🎉 Goal completed:', detail.goalId, 'for channel:', detail.channelId);
  
  const { channelId, goalId, goalName, capturedData } = detail;
  
  if (!channelId) {
    console.error('❌ Missing channelId in goal.completed event');
    return;
  }
  
  try {
    // Get current channel
    const channelResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId }
    }));
    
    if (!channelResult.Item) {
      console.warn(`⚠️ Channel ${channelId} not found for goal completion`);
      return;
    }
    
    const currentWorkflowState = channelResult.Item.workflowState || {};
    const completedGoals = [...(currentWorkflowState.completedGoals || []), goalId];
    const activeGoals = (currentWorkflowState.activeGoals || []).filter((g: string) => g !== goalId);
    
    // Merge captured data
    const mergedCapturedData = {
      ...(currentWorkflowState.capturedData || {}),
      ...(capturedData || {})
    };
    
    // Update channel
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { 
        channelId,
        createdAt: channelResult.Item.createdAt
      },
      UpdateExpression: `
        SET workflowState.completedGoals = :completedGoals,
            workflowState.activeGoals = :activeGoals,
            workflowState.capturedData = :capturedData,
            workflowState.lastUpdated = :lastUpdated,
            lastActivity = :lastActivity,
            updated_at = :updated_at
      `,
      ExpressionAttributeValues: {
        ':completedGoals': completedGoals,
        ':activeGoals': activeGoals,
        ':capturedData': mergedCapturedData,
        ':lastUpdated': detail.timestamp || new Date().toISOString(),
        ':lastActivity': detail.timestamp || new Date().toISOString(),
        ':updated_at': new Date().toISOString()
      }
    }));
    
    console.log(`✅ Goal ${goalName} completion recorded`);
    
  } catch (error) {
    console.error('❌ Error recording goal completion:', error);
    throw error;
  }
}

/**
 * Handle goal activation event
 */
async function handleGoalActivated(detail: any) {
  console.log('🚀 Goal activated:', detail.goalId, 'for channel:', detail.channelId);
  
  const { channelId, goalId, goalName, order } = detail;
  
  if (!channelId) {
    console.error('❌ Missing channelId in goal.activated event');
    return;
  }
  
  try {
    // Get current channel
    const channelResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId }
    }));
    
    if (!channelResult.Item) {
      console.warn(`⚠️ Channel ${channelId} not found for goal activation`);
      return;
    }
    
    const currentWorkflowState = channelResult.Item.workflowState || {};
    const activeGoals = [...(currentWorkflowState.activeGoals || []), goalId];
    
    // Update channel
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { 
        channelId,
        createdAt: channelResult.Item.createdAt
      },
      UpdateExpression: `
        SET workflowState.activeGoals = :activeGoals,
            workflowState.currentGoalOrder = :currentGoalOrder,
            workflowState.lastUpdated = :lastUpdated,
            lastActivity = :lastActivity,
            updated_at = :updated_at
      `,
      ExpressionAttributeValues: {
        ':activeGoals': activeGoals,
        ':currentGoalOrder': order || currentWorkflowState.currentGoalOrder || 0,
        ':lastUpdated': detail.timestamp || new Date().toISOString(),
        ':lastActivity': detail.timestamp || new Date().toISOString(),
        ':updated_at': new Date().toISOString()
      }
    }));
    
    console.log(`✅ Goal ${goalName} activation recorded`);
    
  } catch (error) {
    console.error('❌ Error recording goal activation:', error);
    throw error;
  }
}

/**
 * Handle data capture event
 */
async function handleDataCaptured(detail: any) {
  console.log('📝 Data captured:', detail.fieldName, 'for channel:', detail.channelId);
  
  const { channelId, fieldName, fieldValue } = detail;
  
  if (!channelId) {
    console.error('❌ Missing channelId in data.captured event');
    return;
  }
  
  try {
    // Get current channel
    const channelResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId }
    }));
    
    if (!channelResult.Item) {
      console.warn(`⚠️ Channel ${channelId} not found for data capture`);
      return;
    }
    
    const currentWorkflowState = channelResult.Item.workflowState || {};
    const capturedData = {
      ...(currentWorkflowState.capturedData || {}),
      [fieldName]: fieldValue
    };
    
    // Update contact capture flags
    const contactFlags: any = {};
    if (fieldName === 'email') contactFlags['workflowState.isEmailCaptured'] = true;
    if (fieldName === 'phone') contactFlags['workflowState.isPhoneCaptured'] = true;
    if (fieldName === 'firstName') contactFlags['workflowState.isFirstNameCaptured'] = true;
    if (fieldName === 'lastName') contactFlags['workflowState.isLastNameCaptured'] = true;
    
    const updateExpression = `
      SET workflowState.capturedData = :capturedData,
          workflowState.lastUpdated = :lastUpdated,
          lastActivity = :lastActivity,
          updated_at = :updated_at
          ${Object.keys(contactFlags).length > 0 ? ', ' + Object.keys(contactFlags).map((k, i) => `${k} = :flag${i}`).join(', ') : ''}
    `;
    
    const expressionValues: any = {
      ':capturedData': capturedData,
      ':lastUpdated': detail.timestamp || new Date().toISOString(),
      ':lastActivity': detail.timestamp || new Date().toISOString(),
      ':updated_at': new Date().toISOString()
    };
    
    Object.values(contactFlags).forEach((val, i) => {
      expressionValues[`:flag${i}`] = val;
    });
    
    // Update channel
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { 
        channelId,
        createdAt: channelResult.Item.createdAt
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionValues
    }));
    
    console.log(`✅ Data capture for ${fieldName} recorded`);
    
  } catch (error) {
    console.error('❌ Error recording data capture:', error);
    throw error;
  }
}

/**
 * Handle appointment requested event
 */
async function handleAppointmentRequested(detail: any) {
  console.log('📅 Appointment requested for channel:', detail.channelId);
  
  const { channelId, appointmentType, requestedDate, requestedTime } = detail;
  
  if (!channelId) {
    console.error('❌ Missing channelId in appointment.requested event');
    return;
  }
  
  try {
    // Get current channel
    const channelResult = await dynamodb.send(new GetCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { channelId }
    }));
    
    if (!channelResult.Item) {
      console.warn(`⚠️ Channel ${channelId} not found for appointment request`);
      return;
    }
    
    const currentWorkflowState = channelResult.Item.workflowState || {};
    const emittedEvents = [...(currentWorkflowState.emittedEvents || []), 'appointment.requested'];
    
    // Update channel
    await dynamodb.send(new UpdateCommand({
      TableName: process.env.CHANNELS_TABLE_NAME!,
      Key: { 
        channelId,
        createdAt: channelResult.Item.createdAt
      },
      UpdateExpression: `
        SET workflowState.emittedEvents = :emittedEvents,
            metadata.appointmentRequest = :appointmentRequest,
            lastActivity = :lastActivity,
            updated_at = :updated_at
      `,
      ExpressionAttributeValues: {
        ':emittedEvents': emittedEvents,
        ':appointmentRequest': {
          appointmentType,
          requestedDate,
          requestedTime,
          requestedAt: detail.timestamp || new Date().toISOString()
        },
        ':lastActivity': detail.timestamp || new Date().toISOString(),
        ':updated_at': new Date().toISOString()
      }
    }));
    
    console.log('✅ Appointment request recorded');
    
  } catch (error) {
    console.error('❌ Error recording appointment request:', error);
    throw error;
  }
}

/**
 * Handle workflow error event
 */
async function handleWorkflowError(detail: any) {
  console.error('⚠️ Workflow error for channel:', detail.channelId, '|', detail.errorMessage);
  
  // Log error but don't throw - we don't want to break the event consumer
  // In the future, could emit alerts or create error notifications
}

/**
 * Internal EventBridge consumer that automatically creates notifications/messages
 * based on configured event subscriptions
 */
export const handler = async (event: EventBridgeEvent<string, any>) => {
  console.log('📨 Internal consumer received event:', JSON.stringify(event, null, 2));
  
  const { source, 'detail-type': detailType, detail } = event;
  
  try {
    // 🤖 AGENT EVENTS: Handle agent workflow events for channel state updates
    if (source === 'kx-langchain-agent') {
      console.log('🤖 Detected agent event, routing to agent handler...');
      await handleAgentEvent(event, detailType, detail);
      // Continue to generic subscription processing if needed
    }
    
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
      console.log(`✅ Subscriptions cached for future invocations. Total: ${subscriptions.length}, Names:`, subscriptions.map(s => s.name));
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
    console.log(`📋 Matching subscription names:`, matchingSubscriptions.map(s => s.name));
    
    // Process each matching subscription
    for (const subscription of matchingSubscriptions) {
      console.log(`⚙️ Processing subscription: ${subscription.name}`);
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
  
  console.log(`🔍 Matching event - source: ${source}, detailType: ${detailType}, pattern:`, JSON.stringify(pattern));
  
  // Check source (exact match required)
  if (pattern.source && !pattern.source.includes(source)) {
    console.log(`❌ Source mismatch: ${source} not in`, pattern.source);
    return false;
  }
  
  // Check detail type (EXACT match required - prevent chat.message from matching chat.message.available)
  if (pattern.detailType && !pattern.detailType.includes(detailType)) {
    console.log(`❌ DetailType mismatch: ${detailType} not in`, pattern.detailType);
    return false;
  }
  
  console.log(`✅ Pattern matched!`);
  
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
      ...(template.sound && { sound: resolveValue(template.sound, detail) }),
      
      // Include tenantId if present in the detail (for tenant isolation)
      ...(detail.tenantId && { tenantId: detail.tenantId })
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
      ...(template.sound && { sound: resolveValue(template.sound, detail) }),
      
      // Include tenantId if present in the detail (for tenant isolation)
      ...(detail.tenantId && { tenantId: detail.tenantId })
    };
    
    // Add target-specific fields
    if (template.targetType === 'client' && template.targetUserIds) {
      (message.metadata as any).targetUserIds = resolveValue(template.targetUserIds, detail);
    }
    
    if (template.targetType === 'broadcast' && template.targetClientIds) {
      (message.metadata as any).targetClientIds = resolveValue(template.targetClientIds, detail);
    }
    
    // Add channel-specific fields
    if (template.targetType === 'channel') {
      (message as any).channelId = resolveValue(template.channelId, detail);
      (message as any).senderId = resolveValue(template.senderId, detail);
      (message as any).messageType = 'chat';
      // Preserve userType if present in the event detail (e.g., 'agent' for AI messages)
      if (detail.userType) {
        (message as any).userType = detail.userType;
      }
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
      
    case 'channel':
      const channelId = resolveValue((template as any).channelId, detail);
      if (!channelId) {
        throw new Error('channelId is required for channel-targeted messages');
      }
      return `channel#${channelId}`;
      
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
