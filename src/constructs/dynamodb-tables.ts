import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DynamoDBTablesProps {
  /**
   * Prefix for table names
   */
  resourcePrefix?: string;
  
  /**
   * Enable TTL for automatic cleanup of expired items
   */
  enableTtl?: boolean;
  
  /**
   * TTL attribute name for messages/notifications
   */
  ttlAttributeName?: string;
  
  /**
   * TTL attribute name for status records
   */
  statusTtlAttributeName?: string;
  
  /**
   * Billing mode for tables
   */
  billingMode?: dynamodb.BillingMode;
  
  /**
   * Read capacity units (if using provisioned billing)
   */
  readCapacity?: number;
  
  /**
   * Write capacity units (if using provisioned billing)
   */
  writeCapacity?: number;
  
  /**
   * Enable point-in-time recovery
   */
  pointInTimeRecovery?: boolean;
  
  /**
   * Removal policy for tables
   */
  removalPolicy?: cdk.RemovalPolicy;
}

export class DynamoDBTables extends Construct {
  public readonly messagesTable: dynamodb.Table;
  public readonly notificationsTable: dynamodb.Table;
  public readonly messageStatusTable: dynamodb.Table;
  public readonly channelsTable: dynamodb.Table;
  public readonly channelParticipantsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DynamoDBTablesProps = {}) {
    super(scope, id);

    const {
      resourcePrefix = 'kx-notifications',
      enableTtl = true,
      ttlAttributeName = 'expiresAt',
      statusTtlAttributeName = 'ttl',
      billingMode = dynamodb.BillingMode.PAY_PER_REQUEST,
      readCapacity = 5,
      writeCapacity = 5,
      pointInTimeRecovery = true,
      removalPolicy = cdk.RemovalPolicy.RETAIN
    } = props;

    // Messages Table - Multi-targeting with composite partition keys
    // Supports: user#{userId}, client#{clientId}, broadcast
    this.messagesTable = new dynamodb.Table(this, 'MessagesTable', {
      tableName: `${resourcePrefix}-messages`,
      partitionKey: {
        name: 'targetKey', // user#{userId} | client#{clientId} | broadcast
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'dateReceived',
        type: dynamodb.AttributeType.STRING
      },
      billingMode,
      readCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? readCapacity : undefined,
      writeCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? writeCapacity : undefined,
      pointInTimeRecovery,
      removalPolicy,
      timeToLiveAttribute: enableTtl ? ttlAttributeName : undefined,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For EventBridge integration
    });

    // GSI for querying by message ID (for status lookups)
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'messageId-index',
      partitionKey: {
        name: 'messageId',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by priority across all targets
    this.messagesTable.addGlobalSecondaryIndex({
      indexName: 'priority-index',
      partitionKey: {
        name: 'priority',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'dateReceived',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Notifications Table - Multi-targeting with composite partition keys
    // Supports: user#{userId}, client#{clientId}, broadcast
    this.notificationsTable = new dynamodb.Table(this, 'NotificationsTable', {
      tableName: `${resourcePrefix}-notifications`,
      partitionKey: {
        name: 'targetKey', // user#{userId} | client#{clientId} | broadcast
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'dateReceived',
        type: dynamodb.AttributeType.STRING
      },
      billingMode,
      readCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? readCapacity : undefined,
      writeCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? writeCapacity : undefined,
      pointInTimeRecovery,
      removalPolicy,
      timeToLiveAttribute: enableTtl ? ttlAttributeName : undefined,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For EventBridge integration
    });

    // GSI for querying by notification ID (for status lookups)
    this.notificationsTable.addGlobalSecondaryIndex({
      indexName: 'notificationId-index',
      partitionKey: {
        name: 'notificationId',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by priority across all targets
    this.notificationsTable.addGlobalSecondaryIndex({
      indexName: 'priority-index',
      partitionKey: {
        name: 'priority',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'dateReceived',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Message Status Table - Sparse table for user interactions only
    // Only contains records when users interact (read/delete)
    this.messageStatusTable = new dynamodb.Table(this, 'MessageStatusTable', {
      tableName: `${resourcePrefix}-message-status`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'messageId', // Can be messageId or notificationId
        type: dynamodb.AttributeType.STRING
      },
      billingMode,
      readCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? readCapacity : undefined,
      writeCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? writeCapacity : undefined,
      pointInTimeRecovery,
      removalPolicy,
      timeToLiveAttribute: statusTtlAttributeName, // TTL for automatic cleanup
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For EventBridge integration
    });

    // GSI for querying status by message ID (reverse lookup)
    this.messageStatusTable.addGlobalSecondaryIndex({
      indexName: 'messageId-status-index',
      partitionKey: {
        name: 'messageId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status type (read/deleted)
    this.messageStatusTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'interactedAt',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'MessagesTableName', {
      value: this.messagesTable.tableName,
      description: 'Messages DynamoDB table name',
      exportName: `${cdk.Stack.of(this).stackName}-MessagesTableName`,
    });

    new cdk.CfnOutput(this, 'MessagesTableArn', {
      value: this.messagesTable.tableArn,
      description: 'Messages DynamoDB table ARN',
      exportName: `${cdk.Stack.of(this).stackName}-MessagesTableArn`,
    });

    new cdk.CfnOutput(this, 'NotificationsTableName', {
      value: this.notificationsTable.tableName,
      description: 'Notifications DynamoDB table name',
      exportName: `${cdk.Stack.of(this).stackName}-NotificationsTableName`,
    });

    new cdk.CfnOutput(this, 'NotificationsTableArn', {
      value: this.notificationsTable.tableArn,
      description: 'Notifications DynamoDB table ARN',
      exportName: `${cdk.Stack.of(this).stackName}-NotificationsTableArn`,
    });

    new cdk.CfnOutput(this, 'MessageStatusTableName', {
      value: this.messageStatusTable.tableName,
      description: 'Message Status DynamoDB table name',
      exportName: `${cdk.Stack.of(this).stackName}-MessageStatusTableName`,
    });

    new cdk.CfnOutput(this, 'MessageStatusTableArn', {
      value: this.messageStatusTable.tableArn,
      description: 'Message Status DynamoDB table ARN',
      exportName: `${cdk.Stack.of(this).stackName}-MessageStatusTableArn`,
    });

    // Channels Table - Chat channel metadata and management
    // DUAL PURPOSE:
    // 1. Regular items: Chat session state (createdAt = ISO timestamp)
    // 2. Special items: Active response tracking (createdAt = "ACTIVE_RESPONSE")
    // Note: No TTL - old sessions will be cleaned up by scheduled Lambda
    this.channelsTable = new dynamodb.Table(this, 'ChannelsTableV3', {
      tableName: `${resourcePrefix}-channels`,
      partitionKey: {
        name: 'channelId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING
      },
      billingMode,
      readCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? readCapacity : undefined,
      writeCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? writeCapacity : undefined,
      pointInTimeRecovery,
      removalPolicy,
      timeToLiveAttribute: undefined, // TEMPORARILY DISABLED - Will re-enable after GSI creation
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For EventBridge integration
    });

    // GSI for querying channels by tenant (for admin views)
    this.channelsTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-lastActivity-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'lastActivity',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying unclaimed leads by tenant
    this.channelsTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-leadStatus-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'leadStatus',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying channels by channelId alone (without createdAt)
    this.channelsTable.addGlobalSecondaryIndex({
      indexName: 'channelId-index',
      partitionKey: {
        name: 'channelId',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for finding channels by exact participant match (prevents duplicates)
    // participantHash = sorted userIds joined with '|' (e.g., 'user1|user2|user3')
    this.channelsTable.addGlobalSecondaryIndex({
      indexName: 'participantHash-index',
      partitionKey: {
        name: 'participantHash',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Channel Participants Table - For efficient user-to-channel queries
    this.channelParticipantsTable = new dynamodb.Table(this, 'ChannelParticipantsTable', {
      tableName: `${resourcePrefix}-channel-participants`,
      partitionKey: {
        name: 'userId', // Includes botIds and leadIds
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'channelId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode,
      readCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? readCapacity : undefined,
      writeCapacity: billingMode === dynamodb.BillingMode.PROVISIONED ? writeCapacity : undefined,
      pointInTimeRecovery,
      removalPolicy,
      timeToLiveAttribute: statusTtlAttributeName, // TTL for cleanup
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For EventBridge integration
    });

    // GSI for reverse lookup - find participants by channel
    this.channelParticipantsTable.addGlobalSecondaryIndex({
      indexName: 'channelId-userId-index',
      partitionKey: {
        name: 'channelId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for tenant-based participant queries (for unclaimed lead visibility)
    this.channelParticipantsTable.addGlobalSecondaryIndex({
      indexName: 'tenantId-joinedAt-index',
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'joinedAt',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // CloudFormation outputs for new tables
    new cdk.CfnOutput(this, 'ChannelsTableName', {
      value: this.channelsTable.tableName,
      description: 'Channels DynamoDB table name',
      exportName: `${cdk.Stack.of(this).stackName}-ChannelsTableName`,
    });

    new cdk.CfnOutput(this, 'ChannelsTableArn', {
      value: this.channelsTable.tableArn,
      description: 'Channels DynamoDB table ARN',
      exportName: `${cdk.Stack.of(this).stackName}-ChannelsTableArn`,
    });

    new cdk.CfnOutput(this, 'ChannelParticipantsTableName', {
      value: this.channelParticipantsTable.tableName,
      description: 'Channel Participants DynamoDB table name',
      exportName: `${cdk.Stack.of(this).stackName}-ChannelParticipantsTableName`,
    });

    new cdk.CfnOutput(this, 'ChannelParticipantsTableArn', {
      value: this.channelParticipantsTable.tableArn,
      description: 'Channel Participants DynamoDB table ARN',
      exportName: `${cdk.Stack.of(this).stackName}-ChannelParticipantsTableArn`,
    });

    // Tags
    cdk.Tags.of(this.messagesTable).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this.messagesTable).add('TableType', 'Messages');
    cdk.Tags.of(this.notificationsTable).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this.notificationsTable).add('TableType', 'Notifications');
    cdk.Tags.of(this.messageStatusTable).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this.messageStatusTable).add('TableType', 'MessageStatus');
    cdk.Tags.of(this.channelsTable).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this.channelsTable).add('TableType', 'Channels');
    cdk.Tags.of(this.channelParticipantsTable).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this.channelParticipantsTable).add('TableType', 'ChannelParticipants');
  }
}
