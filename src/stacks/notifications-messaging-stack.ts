import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as path from 'path';
import { DynamoDBTables } from '../constructs/dynamodb-tables';
import { EventBridgeConstruct } from '../constructs/eventbridge';
import { InternalEventConsumer } from '../constructs/internal-event-consumer';
import { NotificationMessagingStackProps, EventBridgeRuleConfig } from '../types';
import { LambdaOptions } from '@toldyaonce/kx-cdk-constructs/wrappers/rest';
import { SimpleMessagesService } from '../services/simple-messages-service';
import { SimpleNotificationsService } from '../services/simple-notifications-service';
import { SimpleChannelsService } from '../services/simple-channels-service';

export class NotificationMessagingStack extends cdk.Stack {
  public readonly dynamoTables: DynamoDBTables;
  public readonly eventBridge: EventBridgeConstruct;
  public readonly messagesApi: apigateway.RestApi;
  public readonly notificationsApi: apigateway.RestApi;
  public readonly channelsApi: apigateway.RestApi;
  public readonly internalConsumer?: InternalEventConsumer;
  public readonly usingExistingApis: boolean;

  constructor(scope: Construct, id: string, props: NotificationMessagingStackProps & cdk.StackProps = {}) {
    super(scope, id, props);

    const {
      resourcePrefix = 'kx-notifications',
      eventBridgeRules = [],
      eventSubscriptions = [],
      eventBridgeBusName,
      existingEventBus,
      enableFullTextSearch = true,
      ttlAttributeName = 'expiresAt',
      vpcConfig,
      lambdaEnvironment = {},
      apiGatewayConfig,
      internalEventConsumerProps
    } = props;

    // Create DynamoDB tables
    this.dynamoTables = new DynamoDBTables(this, 'DynamoTables', {
      resourcePrefix,
      enableTtl: true,
      ttlAttributeName,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Normalize EventBridge rules
    const normalizedRules: EventBridgeRuleConfig[] = eventBridgeRules.map((rule, index) => {
      if ('ruleName' in rule) {
        return rule as EventBridgeRuleConfig;
      } else {
        // Convert simple rule format to full config
        return {
          ruleName: `${resourcePrefix}-rule-${index}`,
          description: `Auto-generated rule ${index}`,
          eventPattern: rule.eventPattern,
          targets: rule.targets
        };
      }
    });

    // Create or use existing EventBridge
    if (existingEventBus) {
      // Use existing EventBridge bus
      this.eventBridge = {
        eventBus: existingEventBus,
        eventBridgeArn: existingEventBus.eventBusArn,
        eventBridgeName: existingEventBus.eventBusName,
        rules: []
      } as any; // Cast to match EventBridgeConstruct interface
    } else {
      // Create new EventBridge construct
      this.eventBridge = new EventBridgeConstruct(this, 'EventBridge', {
        eventBridgeBusName: eventBridgeBusName || `${resourcePrefix}-events-bus`,
        eventBridgeRules: normalizedRules,
        messagesTable: this.dynamoTables.messagesTable,
        notificationsTable: this.dynamoTables.notificationsTable,
        resourcePrefix
      });
    }

    // Create internal event consumer for blackbox event processing
    if (eventSubscriptions && eventSubscriptions.length > 0) {
      this.internalConsumer = new InternalEventConsumer(this, 'InternalConsumer', {
        eventSubscriptions,
        eventBus: existingEventBus || this.eventBridge.eventBus,
        messagesTable: this.dynamoTables.messagesTable,
        notificationsTable: this.dynamoTables.notificationsTable,
        resourcePrefix,
        // ⚡ Cold start optimization props
        enableProvisionedConcurrency: internalEventConsumerProps?.enableProvisionedConcurrency,
        provisionedConcurrency: internalEventConsumerProps?.provisionedConcurrency
      });
    }

    // Handle API Gateway creation or use existing
    if (apiGatewayConfig?.existingMessagesApi || apiGatewayConfig?.existingNotificationsApi || apiGatewayConfig?.existingChannelsApi) {
      // Use existing API Gateway(s)
      this.usingExistingApis = true;
      
      if (apiGatewayConfig.existingMessagesApi) {
        this.messagesApi = apiGatewayConfig.existingMessagesApi;
      } else if (apiGatewayConfig.existingNotificationsApi && !apiGatewayConfig.separateApis) {
        // Use notifications API for both if separateApis is false
        this.messagesApi = apiGatewayConfig.existingNotificationsApi;
      } else {
        throw new Error('existingMessagesApi is required when using existing API Gateway with separateApis=true');
      }
      
      if (apiGatewayConfig.existingNotificationsApi) {
        this.notificationsApi = apiGatewayConfig.existingNotificationsApi;
      } else if (apiGatewayConfig.existingMessagesApi && !apiGatewayConfig.separateApis) {
        // Use messages API for both if separateApis is false
        this.notificationsApi = apiGatewayConfig.existingMessagesApi;
      } else {
        throw new Error('existingNotificationsApi is required when using existing API Gateway with separateApis=true');
      }

      // Channels API: Use existingChannelsApi if provided, otherwise use messagesApi
      if (apiGatewayConfig.existingChannelsApi) {
        this.channelsApi = apiGatewayConfig.existingChannelsApi;
      } else {
        // Default: channels attach to the same API as messages
        this.channelsApi = this.messagesApi;
      }
    } else {
      // Create new API Gateway instances
      this.usingExistingApis = false;
      
      // Create API Gateway for Messages
      this.messagesApi = new apigateway.RestApi(this, 'MessagesApi', {
        restApiName: `${resourcePrefix}-messages-api`,
        description: 'REST API for Messages management',
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowHeaders: [
            'Content-Type',
            'X-Amz-Date',
            'Authorization',
            'X-Api-Key',
            'X-Amz-Security-Token',
          ],
        },
      });

      // Create API Gateway for Notifications
      this.notificationsApi = new apigateway.RestApi(this, 'NotificationsApi', {
        restApiName: `${resourcePrefix}-notifications-api`,
        description: 'REST API for Notifications management',
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowHeaders: [
            'Content-Type',
            'X-Amz-Date',
            'Authorization',
            'X-Api-Key',
            'X-Amz-Security-Token',
          ],
        },
      });

      // Create API Gateway for Channels
      this.channelsApi = new apigateway.RestApi(this, 'ChannelsApi', {
        restApiName: `${resourcePrefix}-channels-api`,
        description: 'REST API for Chat Channels management',
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
          allowHeaders: [
            'Content-Type',
            'X-Amz-Date',
            'Authorization',
            'X-Api-Key',
            'X-Amz-Security-Token',
          ],
        },
      });
    }

    // Configure Lambda options
    const lambdaOptions: LambdaOptions = {
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        MESSAGES_TABLE_NAME: this.dynamoTables.messagesTable.tableName,
        NOTIFICATIONS_TABLE_NAME: this.dynamoTables.notificationsTable.tableName,
        CHANNELS_TABLE_NAME: this.dynamoTables.channelsTable.tableName,
        CHANNEL_PARTICIPANTS_TABLE_NAME: this.dynamoTables.channelParticipantsTable.tableName,
        EVENT_BUS_NAME: this.eventBridge.eventBridgeName,
        ...lambdaEnvironment
      }
    };

    // Add VPC configuration if provided
    if (vpcConfig) {
      if (vpcConfig.vpcId) {
        lambdaOptions.vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
          vpcId: vpcConfig.vpcId
        });
      }
      
      if (vpcConfig.subnetIds && vpcConfig.subnetIds.length > 0) {
        lambdaOptions.vpcSubnets = {
          subnets: vpcConfig.subnetIds.map((subnetId, index) => 
            ec2.Subnet.fromSubnetId(this, `ImportedSubnet${index}`, subnetId)
          )
        };
      }

      if (vpcConfig.securityGroupIds && vpcConfig.securityGroupIds.length > 0) {
        lambdaOptions.securityGroups = vpcConfig.securityGroupIds.map((sgId, index) =>
          ec2.SecurityGroup.fromSecurityGroupId(this, `ImportedSG${index}`, sgId)
        );
      }
    }

    // Determine base paths for API attachment
    const messagesBasePath = apiGatewayConfig?.messagesBasePath || '/messages';
    const notificationsBasePath = apiGatewayConfig?.notificationsBasePath || '/notifications';
    const channelsBasePath = apiGatewayConfig?.channelsBasePath || '/channels';

    // Create unique construct scopes to prevent naming collisions
    const messagesScope = new Construct(this, 'MessagesServiceScope');
    const notificationsScope = new Construct(this, 'NotificationsServiceScope');

    // Check if we're using the same API Gateway for both services
    const usingSameApi = this.messagesApi === this.notificationsApi;
    
    let messagesMethods: any[];
    let notificationsMethods: any[];
    
    if (usingSameApi) {
      // CRITICAL FIX: When using the same API Gateway, attach messages first, 
      // then manually attach notifications without CORS to avoid collision
      
      // CRITICAL FIX: Use our own implementation that properly handles scoping
      messagesMethods = this.attachServiceManually(
        messagesScope,
        this.messagesApi,
        SimpleMessagesService,
        messagesBasePath,
        lambdaOptions,
        resourcePrefix
      );

      notificationsMethods = this.attachServiceManually(
        notificationsScope,
        this.notificationsApi,
        SimpleNotificationsService,
        notificationsBasePath,
        lambdaOptions,
        resourcePrefix
      );
      
      // Attach Channels service to the configured API Gateway
      const channelsScope = new Construct(this, 'ChannelsScope');
      const channelsMethods = this.attachServiceManually(
        channelsScope,
        this.channelsApi, // Use configured channels API (defaults to messages API)
        SimpleChannelsService,
        channelsBasePath,
        lambdaOptions,
        resourcePrefix
      );

      // Grant DynamoDB permissions to Lambda functions (filter out null lambdas from CORS methods)
      messagesMethods.filter(method => method.lambda !== null).forEach(method => {
        this.dynamoTables.messagesTable.grantReadWriteData(method.lambda);
        this.dynamoTables.notificationsTable.grantReadData(method.lambda);
        this.dynamoTables.channelsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.channelParticipantsTable.grantReadWriteData(method.lambda);
      });

      notificationsMethods.filter(method => method.lambda !== null).forEach(method => {
        this.dynamoTables.notificationsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.messagesTable.grantReadData(method.lambda);
      });

      channelsMethods.filter(method => method.lambda !== null).forEach(method => {
        this.dynamoTables.channelsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.channelParticipantsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.messagesTable.grantReadWriteData(method.lambda);
        // Grant EventBridge PutEvents permission for publishing channel events
        this.eventBridge.eventBus.grantPutEventsTo(method.lambda);
      });
    } else {
      // Different API Gateways - use our own implementation to avoid external library bugs
      messagesMethods = this.attachServiceManually(
        messagesScope,
        this.messagesApi,
        SimpleMessagesService,
        messagesBasePath,
        lambdaOptions,
        resourcePrefix
      );

      notificationsMethods = this.attachServiceManually(
        notificationsScope,
        this.notificationsApi,
        SimpleNotificationsService,
        notificationsBasePath,
        lambdaOptions,
        resourcePrefix
      );

      // Attach Channels service
      const channelsScope = new Construct(this, 'ChannelsScope');
      const channelsMethods = this.attachServiceManually(
        channelsScope,
        this.channelsApi,
        SimpleChannelsService,
        channelsBasePath,
        lambdaOptions,
        resourcePrefix
      );
      
      // Grant DynamoDB permissions to Lambda functions (filter out null lambdas from CORS methods)
      messagesMethods.filter(method => method.lambda !== null).forEach(method => {
        this.dynamoTables.messagesTable.grantReadWriteData(method.lambda);
        this.dynamoTables.notificationsTable.grantReadData(method.lambda);
        this.dynamoTables.channelsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.channelParticipantsTable.grantReadWriteData(method.lambda);
      });

      notificationsMethods.filter(method => method.lambda !== null).forEach(method => {
        this.dynamoTables.notificationsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.messagesTable.grantReadData(method.lambda);
      });

      channelsMethods.filter(method => method.lambda !== null).forEach(method => {
        this.dynamoTables.channelsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.channelParticipantsTable.grantReadWriteData(method.lambda);
        this.dynamoTables.messagesTable.grantReadWriteData(method.lambda);
        // Grant EventBridge PutEvents permission for publishing channel events
        this.eventBridge.eventBus.grantPutEventsTo(method.lambda);
      });
      
      return; // Early return for separate APIs case
    }

    // Grant DynamoDB permissions to Lambda functions (filter out null lambdas from CORS methods)
    messagesMethods.filter(method => method.lambda !== null).forEach(method => {
      this.dynamoTables.messagesTable.grantReadWriteData(method.lambda);
      this.dynamoTables.notificationsTable.grantReadData(method.lambda); // Allow cross-table reads if needed
      this.dynamoTables.channelsTable.grantReadWriteData(method.lambda);
      this.dynamoTables.channelParticipantsTable.grantReadWriteData(method.lambda);
    });

    notificationsMethods.filter(method => method.lambda !== null).forEach(method => {
      this.dynamoTables.notificationsTable.grantReadWriteData(method.lambda);
      this.dynamoTables.messagesTable.grantReadData(method.lambda); // Allow cross-table reads if needed
    });

    // CloudFormation outputs (only create if we created the APIs)
    if (!this.usingExistingApis) {
      new cdk.CfnOutput(this, 'MessagesApiUrl', {
        value: this.messagesApi.url,
        description: 'Messages API Gateway URL',
        exportName: `${this.stackName}-MessagesApiUrl`,
      });

      new cdk.CfnOutput(this, 'NotificationsApiUrl', {
        value: this.notificationsApi.url,
        description: 'Notifications API Gateway URL',
        exportName: `${this.stackName}-NotificationsApiUrl`,
      });

      new cdk.CfnOutput(this, 'ChannelsApiUrl', {
        value: this.channelsApi.url,
        description: 'Channels API Gateway URL',
        exportName: `${this.stackName}-ChannelsApiUrl`,
      });
    } else {
      // Output the base paths when using existing APIs
      new cdk.CfnOutput(this, 'MessagesBasePath', {
        value: messagesBasePath,
        description: 'Messages API base path on existing API Gateway',
        exportName: `${this.stackName}-MessagesBasePath`,
      });

      new cdk.CfnOutput(this, 'NotificationsBasePath', {
        value: notificationsBasePath,
        description: 'Notifications API base path on existing API Gateway',
        exportName: `${this.stackName}-NotificationsBasePath`,
      });

      new cdk.CfnOutput(this, 'ChannelsBasePath', {
        value: channelsBasePath,
        description: 'Channels API base path on existing API Gateway',
        exportName: `${this.stackName}-ChannelsBasePath`,
      });
    }

    new cdk.CfnOutput(this, 'EventBridgeArn', {
      value: this.eventBridge.eventBridgeArn,
      description: 'EventBridge custom bus ARN',
      exportName: `${this.stackName}-EventBridgeArn`,
    });

    new cdk.CfnOutput(this, 'EventBridgeName', {
      value: this.eventBridge.eventBridgeName,
      description: 'EventBridge custom bus name',
      exportName: `${this.stackName}-EventBridgeName`,
    });

    // Tags
    cdk.Tags.of(this).add('Component', 'NotificationsMessaging');
    cdk.Tags.of(this).add('CreatedBy', 'kx-notifications-and-messaging-cdk');
  }

  /**
   * Import resources from an existing stack
   */
  public static fromStackOutputs(
    scope: Construct,
    id: string,
    stackName: string
  ): {
    messagesApiUrl: string;
    notificationsApiUrl: string;
    eventBridgeArn: string;
    eventBridgeName: string;
    messagesTableName: string;
    messagesTableArn: string;
    notificationsTableName: string;
    notificationsTableArn: string;
  } {
    return {
      messagesApiUrl: cdk.Fn.importValue(`${stackName}-MessagesApiUrl`),
      notificationsApiUrl: cdk.Fn.importValue(`${stackName}-NotificationsApiUrl`),
      eventBridgeArn: cdk.Fn.importValue(`${stackName}-EventBridgeArn`),
      eventBridgeName: cdk.Fn.importValue(`${stackName}-EventBridgeName`),
      messagesTableName: cdk.Fn.importValue(`${stackName}-MessagesTableName`),
      messagesTableArn: cdk.Fn.importValue(`${stackName}-MessagesTableArn`),
      notificationsTableName: cdk.Fn.importValue(`${stackName}-NotificationsTableName`),
      notificationsTableArn: cdk.Fn.importValue(`${stackName}-NotificationsTableArn`),
    };
  }

  /**
   * CRITICAL FIX: Properly attach service to API Gateway with NodejsFunction and scoped CORS handling
   * This replaces the broken @toldyaonce/kx-cdk-constructs attachServiceToApiGateway function
   */
  private attachServiceManually(
    scope: Construct,
    api: apigateway.RestApi,
    serviceClass: any,
    basePath: string,
    options: LambdaOptions,
    resourcePrefix?: string
  ): any[] {
    // Create the service resource path
    const pathParts = basePath.split('/').filter(part => part.length > 0);
    let currentResource = api.root;
    
    // Navigate/create the resource path
    for (const part of pathParts) {
      const existingResource = currentResource.getResource(part);
      if (existingResource) {
        currentResource = existingResource;
      } else {
        currentResource = currentResource.addResource(part);
      }
    }
    
    // Determine which handler to use based on service class
    const isMessagesService = serviceClass.name.includes('Messages');
    const isChannelsService = serviceClass.name.includes('Channels');
    const handlerPath = isChannelsService ? 'channels-service-handler' : 
                        (isMessagesService ? 'messages-service-handler' : 'notifications-service-handler');
    
    // Find the package root and point to the TypeScript source
    const packageRoot = path.dirname(require.resolve('@toldyaonce/kx-notifications-and-messaging-cdk/package.json'));
    const entryPath = path.join(packageRoot, `src/lambda/${handlerPath}.ts`);
    
    // Create NodejsFunction for proper TypeScript support and dependency bundling
    // CRITICAL FIX: Use explicit physical name to avoid cross-environment validation errors
    const serviceName = isChannelsService ? 'channels' : (isMessagesService ? 'messages' : 'notifications');
    const prefix = resourcePrefix || 'kx-notifications';
    const functionName = `${prefix}-${serviceName}-service`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    
    const serviceFunction = new NodejsFunction(scope, 'ServiceFunction', {
      functionName: functionName,
      entry: entryPath,
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: options.timeout || cdk.Duration.seconds(30),
      memorySize: options.memorySize || 512,
      environment: options.environment || {},
      bundling: {
        externalModules: [], // Bundle all dependencies including AWS SDK v3
        minify: true,
        sourceMap: false
      }
    });
    
    const methods: any[] = [];
    
    // Add HTTP methods (GET, POST, PUT, DELETE, PATCH)
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    
    // CRITICAL FIX: Ensure Lambda function is fully created before API Gateway integration
    // Create Lambda integration with explicit dependency
    const lambdaIntegration = new apigateway.LambdaIntegration(serviceFunction, {
      requestTemplates: { "application/json": '{ "statusCode": "200" }' }
    });

    for (const method of httpMethods) {
      try {
        const apiMethod = currentResource.addMethod(method, lambdaIntegration);
        // Ensure API method depends on Lambda function
        apiMethod.node.addDependency(serviceFunction);
        methods.push({ lambda: serviceFunction, method });
      } catch (error) {
        console.warn(`Failed to add ${method} method to ${basePath}:`, error);
      }
    }
    
    // Add {id} resource for individual item operations
    // For channels, use {channelId} instead of {id}
    const idParamName = isChannelsService ? '{channelId}' : '{id}';
    const idResource = currentResource.addResource(idParamName);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      try {
        const apiMethod = idResource.addMethod(method, lambdaIntegration);
        // Ensure API method depends on Lambda function
        apiMethod.node.addDependency(serviceFunction);
        methods.push({ lambda: serviceFunction, method: `${method}_ID` });
      } catch (error) {
        console.warn(`Failed to add ${method} method to ${basePath}/${idParamName}:`, error);
      }
    }

    // For channels service, add {channelId}/{action} resource for actions (join, leave, claim, etc.)
    if (isChannelsService) {
      const actionResource = idResource.addResource('{action}');
      try {
        const apiMethod = actionResource.addMethod('POST', lambdaIntegration);
        apiMethod.node.addDependency(serviceFunction);
        methods.push({ lambda: serviceFunction, method: 'POST_ACTION' });
      } catch (error) {
        console.warn(`Failed to add POST method to ${basePath}/{channelId}/{action}:`, error);
      }

      // Add OPTIONS for CORS on action resource
      try {
        actionResource.addMethod('OPTIONS', new apigateway.MockIntegration({
          integrationResponses: [{
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
              'method.response.header.Access-Control-Allow-Origin': "'*'",
              'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'"
            }
          }],
          requestTemplates: {
            'application/json': '{"statusCode": 200}'
          }
        }), {
          methodResponses: [{
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Headers': true,
              'method.response.header.Access-Control-Allow-Origin': true,
              'method.response.header.Access-Control-Allow-Methods': true
            }
          }]
        });
      } catch (error) {
        console.warn(`Failed to add OPTIONS method to ${basePath}/{channelId}/{action}:`, error);
      }
    }
    
    // Add CORS OPTIONS method with proper scoping to avoid collisions
    try {
      // Create OPTIONS method within the service scope to avoid naming conflicts
      const corsMethod = currentResource.addMethod('OPTIONS', new apigateway.MockIntegration({
        integrationResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,PATCH,OPTIONS'"
          }
        }],
        requestTemplates: {
          'application/json': '{"statusCode": 200}'
        }
      }), {
        methodResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        }]
      });
      
      // Also add OPTIONS to {id} resource
      idResource.addMethod('OPTIONS', new apigateway.MockIntegration({
        integrationResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
            'method.response.header.Access-Control-Allow-Origin': "'*'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,PUT,PATCH,DELETE,OPTIONS'"
          }
        }],
        requestTemplates: {
          'application/json': '{"statusCode": 200}'
        }
      }), {
        methodResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Methods': true
          }
        }]
      });
      
      methods.push({ lambda: null, method: 'OPTIONS', corsMethod });
    } catch (error) {
      console.warn(`CORS OPTIONS method may already exist for ${basePath}, skipping:`, error);
    }
    
    return methods;
  }
}
