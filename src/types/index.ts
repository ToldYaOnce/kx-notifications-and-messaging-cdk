/**
 * Core types for notifications and messaging system with multi-targeting support
 */

export type MessageTargetType = 'user' | 'client' | 'broadcast';
export type MessageStatus = 'read' | 'deleted'; // 'unread' is implicit (no record)
export type MessagePriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Base message interface for all message types
 */
export interface BaseMessage {
  messageId: string;          // UUID primary key
  content: string;            // Message content
  title?: string;             // Optional title
  priority: MessagePriority;
  expiresAt?: string;         // TTL timestamp (ISO)
  createdAt: string;          // Creation timestamp
  dateReceived: string;       // ISO timestamp for sorting
  metadata?: Record<string, any>; // Extensible metadata
}

/**
 * User-targeted message (stored with user partition key)
 */
export interface UserMessage extends BaseMessage {
  userId: string;             // Partition key: user#{userId}
  targetType: 'user';
}

/**
 * Client-targeted message (stored with client partition key)
 */
export interface ClientMessage extends BaseMessage {
  clientId: string;           // Partition key: client#{clientId}
  targetType: 'client';
  targetUserIds?: string[];   // Optional: specific users within client
}

/**
 * Broadcast message (stored with broadcast partition key)
 */
export interface BroadcastMessage extends BaseMessage {
  targetType: 'broadcast';
  targetClientIds?: string[]; // Optional: specific clients for broadcast
}

/**
 * Union type for all message types
 */
export type Message = UserMessage | ClientMessage | BroadcastMessage;

/**
 * Base notification interface for all notification types
 */
export interface BaseNotification {
  notificationId: string;     // UUID primary key
  content: string;            // Notification content
  title: string;              // Required title for notifications
  priority: MessagePriority;
  expiresAt?: string;         // TTL timestamp (ISO)
  createdAt: string;          // Creation timestamp
  dateReceived: string;       // ISO timestamp for sorting
  metadata?: Record<string, any>; // Extensible metadata
}

/**
 * User-targeted notification
 */
export interface UserNotification extends BaseNotification {
  userId: string;             // Partition key: user#{userId}
  targetType: 'user';
}

/**
 * Client-targeted notification
 */
export interface ClientNotification extends BaseNotification {
  clientId: string;           // Partition key: client#{clientId}
  targetType: 'client';
  targetUserIds?: string[];   // Optional: specific users within client
}

/**
 * Broadcast notification
 */
export interface BroadcastNotification extends BaseNotification {
  targetType: 'broadcast';
  targetClientIds?: string[]; // Optional: specific clients for broadcast
}

/**
 * Union type for all notification types
 */
export type Notification = UserNotification | ClientNotification | BroadcastNotification;

/**
 * Message/Notification status tracking (sparse table - only interactions)
 */
export interface MessageStatusRecord {
  userId: string;             // Partition key
  messageId: string;          // Sort key (can be messageId or notificationId)
  status: MessageStatus;      // 'read' | 'deleted' (no 'unread' - absence = unread)
  messageType: 'message' | 'notification';
  targetType: MessageTargetType; // Original target type
  interactedAt: string;       // When user interacted
  ttl?: number;               // Optional TTL for cleanup
}

/**
 * Message with computed status (for API responses)
 */
export interface MessageWithStatus {
  status: MessageStatus | 'unread'; // Computed from MessageStatusRecord or default 'unread'
  messageId: string;
  content: string;
  title?: string;
  priority: MessagePriority;
  expiresAt?: string;
  createdAt: string;
  dateReceived: string;
  metadata?: Record<string, any>;
  targetType: MessageTargetType;
}

/**
 * Notification with computed status (for API responses)
 */
export interface NotificationWithStatus {
  status: MessageStatus | 'unread'; // Computed from MessageStatusRecord or default 'unread'
  notificationId: string;
  content: string;
  title: string;
  priority: MessagePriority;
  expiresAt?: string;
  createdAt: string;
  dateReceived: string;
  metadata?: Record<string, any>;
  targetType: MessageTargetType;
}

export interface MessageQueryOptions {
  userId?: string;
  status?: 'read' | 'unread';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  searchText?: string;        // For full-text search
}

export interface NotificationQueryOptions {
  userId?: string;
  status?: 'read' | 'unread';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  searchText?: string;        // For full-text search
}

export interface EventBridgeRuleConfig {
  ruleName: string;
  description?: string;
  eventPattern: {
    source?: string[];
    detailType?: string[];
    detail?: Record<string, any>;
  };
  targets: any[]; // CDK targets
}

/**
 * Event subscription configuration for blackbox event consumption
 */
export interface EventSubscription {
  name: string;
  description?: string;
  eventPattern: {
    source: string[];
    detailType: string[];
    detail?: Record<string, any>;
  };
  notificationMapping?: Record<string, NotificationTemplate>;
  messageMapping?: Record<string, MessageTemplate>;
}

/**
 * Template for auto-creating notifications from events
 */
export interface NotificationTemplate {
  targetType: MessageTargetType;
  title: string | ((detail: any) => string);
  content?: string | ((detail: any) => string);
  priority?: MessagePriority;
  clientId?: string | ((detail: any) => string);
  userId?: string | ((detail: any) => string);
  targetUserIds?: string[] | ((detail: any) => string[]);
  targetClientIds?: string[] | ((detail: any) => string[]);
  metadata?: Record<string, any> | ((detail: any) => Record<string, any>);
  
  // 🎨 Rich UI metadata properties
  icon?: string | ((detail: any) => string);
  category?: string | ((detail: any) => string);
  actionUrl?: string | ((detail: any) => string);
  tags?: string[] | ((detail: any) => string[]);
  displayDuration?: number | ((detail: any) => number);
  sound?: string | ((detail: any) => string);
}

/**
 * Template for auto-creating messages from events
 */
export interface MessageTemplate {
  targetType: MessageTargetType;
  content: string | ((detail: any) => string);
  title?: string | ((detail: any) => string);
  priority?: MessagePriority;
  clientId?: string | ((detail: any) => string);
  userId?: string | ((detail: any) => string);
  targetUserIds?: string[] | ((detail: any) => string[]);
  targetClientIds?: string[] | ((detail: any) => string[]);
  metadata?: Record<string, any> | ((detail: any) => Record<string, any>);
  
  // 🎨 Rich UI metadata properties
  icon?: string | ((detail: any) => string);
  category?: string | ((detail: any) => string);
  actionUrl?: string | ((detail: any) => string);
  tags?: string[] | ((detail: any) => string[]);
  displayDuration?: number | ((detail: any) => number);
  sound?: string | ((detail: any) => string);
}

export interface NotificationMessagingStackProps {
  /**
   * Prefix for all resource names
   */
  resourcePrefix?: string;
  
  /**
   * EventBridge rules to create (for external consumers)
   * Can be provided as either simple event patterns or complete rule configs
   */
  eventBridgeRules?: EventBridgeRuleConfig[] | {
    eventPattern: any;
    targets: any[];
  }[];
  
  /**
   * Event subscriptions for blackbox event consumption
   * The package will automatically create notifications/messages from these events
   */
  eventSubscriptions?: EventSubscription[];
  
  /**
   * Custom EventBridge bus name (only used when creating new EventBridge)
   */
  eventBridgeBusName?: string;
  
  /**
   * Use an existing EventBridge bus instead of creating a new one
   * When provided, the stack will use this existing bus for all event operations
   */
  existingEventBus?: any; // events.EventBus
  
  /**
   * Enable full-text search on content fields
   */
  enableFullTextSearch?: boolean;
  
  /**
   * TTL attribute name for automatic cleanup
   */
  ttlAttributeName?: string;
  
  /**
   * VPC configuration for Lambda functions
   */
  vpcConfig?: {
    vpcId?: string;
    subnetIds?: string[];
    securityGroupIds?: string[];
  };
  
  /**
   * Environment variables for Lambda functions
   */
  lambdaEnvironment?: Record<string, string>;
  
  /**
   * API Gateway configuration - use existing or create new
   */
  apiGatewayConfig?: {
    /**
     * Use existing API Gateway instead of creating new ones
     * If provided, the package will attach to these existing APIs
     */
    existingMessagesApi?: any; // apigateway.RestApi
    existingNotificationsApi?: any; // apigateway.RestApi
    
    /**
     * Base path for messages endpoints (default: '/messages')
     * Only used when attaching to existing API Gateway
     */
    messagesBasePath?: string;
    
    /**
     * Base path for notifications endpoints (default: '/notifications')  
     * Only used when attaching to existing API Gateway
     */
    notificationsBasePath?: string;
    
    /**
     * Whether to create separate APIs for messages and notifications
     * If false and only one existing API is provided, both services attach to the same API
     */
    separateApis?: boolean;
  };
}

/**
 * EventBridge event structure for notifications and messages
 */
export interface NotificationMessageEvent {
  eventId: string;
  eventType: 'message.created' | 'message.read' | 'message.deleted' | 
            'notification.created' | 'notification.read' | 'notification.deleted';
  userId: string;
  itemId: string; // messageId or notificationId
  timestamp: string;
  metadata?: Record<string, any>;
}
