import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { EventSubscription } from '../types';
import * as path from 'path';

/**
 * Serialize event subscriptions with functions converted to strings
 */
function serializeEventSubscriptions(subscriptions: EventSubscription[]): string {
  const serialized = subscriptions.map(subscription => {
    const serializedSubscription = { ...subscription };
    
    // Serialize notification mapping functions
    if (subscription.notificationMapping) {
      serializedSubscription.notificationMapping = {};
      for (const [key, template] of Object.entries(subscription.notificationMapping)) {
        serializedSubscription.notificationMapping[key] = serializeTemplate(template);
      }
    }
    
    // Serialize message mapping functions
    if (subscription.messageMapping) {
      serializedSubscription.messageMapping = {};
      for (const [key, template] of Object.entries(subscription.messageMapping)) {
        serializedSubscription.messageMapping[key] = serializeTemplate(template);
      }
    }
    
    return serializedSubscription;
  });
  
  return JSON.stringify(serialized);
}

/**
 * Serialize a template by converting functions to strings
 */
function serializeTemplate(template: any): any {
  const serialized = { ...template };
  
  // List of properties that can be functions
  const functionProperties = [
    'title', 'content', 'clientId', 'userId', 'targetUserIds', 'targetClientIds', 
    'metadata', 'icon', 'category', 'actionUrl', 'tags', 'displayDuration', 'sound'
  ];
  
  for (const prop of functionProperties) {
    if (template[prop] && typeof template[prop] === 'function') {
      // Convert function to string with special marker
      serialized[prop] = {
        __isFunction: true,
        __functionString: template[prop].toString()
      };
    }
  }
  
  return serialized;
}

export interface InternalEventConsumerProps {
  /**
   * Event subscriptions to process
   */
  eventSubscriptions: EventSubscription[];
  
  /**
   * EventBridge bus to subscribe to
   */
  eventBus: events.EventBus;
  
  /**
   * Messages table to write to
   */
  messagesTable: dynamodb.Table;
  
  /**
   * Notifications table to write to
   */
  notificationsTable: dynamodb.Table;
  
  /**
   * Resource prefix for naming
   */
  resourcePrefix: string;
}

/**
 * Internal EventBridge consumer that automatically creates notifications/messages
 * from configured event subscriptions
 */
export class InternalEventConsumer extends Construct {
  public readonly consumerFunction: NodejsFunction;
  public readonly eventRules: events.Rule[];

  constructor(scope: Construct, id: string, props: InternalEventConsumerProps) {
    super(scope, id);

    // Create the internal consumer Lambda function
    // Find the package root and point to the TypeScript source
    const packageRoot = path.dirname(require.resolve('@toldyaonce/kx-notifications-and-messaging-cdk/package.json'));
    const entryPath = path.join(packageRoot, 'src/lambda/internal-event-consumer.ts');
    
    this.consumerFunction = new NodejsFunction(this, 'ConsumerFunction', {
      functionName: `${props.resourcePrefix}-internal-event-consumer`,
      entry: entryPath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        MESSAGES_TABLE_NAME: props.messagesTable.tableName,
        NOTIFICATIONS_TABLE_NAME: props.notificationsTable.tableName,
        EVENT_SUBSCRIPTIONS: serializeEventSubscriptions(props.eventSubscriptions)
      },
      bundling: {
        externalModules: [] // Bundle all dependencies including AWS SDK v3
      }
    });

    // Grant DynamoDB permissions
    props.messagesTable.grantWriteData(this.consumerFunction);
    props.notificationsTable.grantWriteData(this.consumerFunction);

    // Create EventBridge rules for each subscription
    this.eventRules = [];
    
    props.eventSubscriptions.forEach((subscription, index) => {
      const rule = new events.Rule(this, `InternalRule${index}`, {
        ruleName: `${props.resourcePrefix}-internal-${subscription.name}`,
        description: subscription.description || `Auto-generated rule for ${subscription.name}`,
        eventBus: props.eventBus,
        eventPattern: subscription.eventPattern,
        targets: [new targets.LambdaFunction(this.consumerFunction)]
      });
      
      this.eventRules.push(rule);
      
      // Add tags
      cdk.Tags.of(rule).add('Component', 'InternalEventConsumer');
      cdk.Tags.of(rule).add('Subscription', subscription.name);
    });

    // CloudFormation outputs
    new cdk.CfnOutput(this, 'InternalConsumerFunctionArn', {
      value: this.consumerFunction.functionArn,
      description: 'Internal event consumer Lambda function ARN',
      exportName: `${props.resourcePrefix}-InternalConsumerFunctionArn`
    });

    new cdk.CfnOutput(this, 'InternalConsumerRuleCount', {
      value: this.eventRules.length.toString(),
      description: 'Number of internal EventBridge rules created',
      exportName: `${props.resourcePrefix}-InternalConsumerRuleCount`
    });

    // Add tags
    cdk.Tags.of(this.consumerFunction).add('Component', 'InternalEventConsumer');
    cdk.Tags.of(this).add('Component', 'InternalEventConsumer');
  }
}
