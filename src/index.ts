/**
 * @toldyaonce/kx-notifications-and-messaging-cdk
 * 
 * CDK constructs for notifications and messaging persistence with DynamoDB, EventBridge, and REST APIs
 */

// Main stack
export { NotificationMessagingStack } from './stacks/notifications-messaging-stack';

// Constructs
export { DynamoDBTables } from './constructs/dynamodb-tables';
export { EventBridgeConstruct } from './constructs/eventbridge';
export { InternalEventConsumer } from './constructs/internal-event-consumer';

// Services (reference implementations)
export { SimpleMessagesService } from './services/simple-messages-service';
export { SimpleNotificationsService } from './services/simple-notifications-service';

// Types
export * from './types';

// Re-export commonly used CDK types for convenience
export { StackProps } from 'aws-cdk-lib';
export { Construct } from 'constructs';
