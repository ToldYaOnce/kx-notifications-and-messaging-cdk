import { LambdaIntegration, RestApi, Resource, Method } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ChannelsServiceMethod {
  method: Method;
  lambda: NodejsFunction | null;
}

export class SimpleChannelsService {
  public static attachToApiGateway(
    scope: Construct,
    api: RestApi,
    basePath: string = '/channels',
    lambdaOptions: any = {},
    resourcePrefix: string = 'kx'
  ): ChannelsServiceMethod[] {
    
    // Create the channels Lambda function
    const channelsFunction = new NodejsFunction(scope, 'ChannelsServiceFunction', {
      functionName: `${resourcePrefix}-channels-service`,
      runtime: Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/channels-service-handler.ts'),
      timeout: lambdaOptions.timeout,
      memorySize: lambdaOptions.memorySize,
      environment: {
        ...lambdaOptions.environment,
        CHANNELS_TABLE_NAME: process.env.CHANNELS_TABLE_NAME || '',
        CHANNEL_PARTICIPANTS_TABLE_NAME: process.env.CHANNEL_PARTICIPANTS_TABLE_NAME || '',
        MESSAGES_TABLE_NAME: process.env.MESSAGES_TABLE_NAME || '',
        EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || ''
      },
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: false
      }
    });

    const channelsIntegration = new LambdaIntegration(channelsFunction);

    // Create resource hierarchy
    const channelsResource = api.root.resourceForPath(basePath);
    const channelResource = channelsResource.addResource('{channelId}');
    const actionResource = channelResource.addResource('{action}');

    // Define methods
    const methods: ChannelsServiceMethod[] = [
      // GET /channels - List channels for user
      {
        method: channelsResource.addMethod('GET', channelsIntegration),
        lambda: channelsFunction
      },
      
      // POST /channels - Create new channel
      {
        method: channelsResource.addMethod('POST', channelsIntegration),
        lambda: channelsFunction
      },
      
      // GET /channels/{channelId} - Get specific channel
      {
        method: channelResource.addMethod('GET', channelsIntegration),
        lambda: channelsFunction
      },
      
      // PUT /channels/{channelId} - Update channel
      {
        method: channelResource.addMethod('PUT', channelsIntegration),
        lambda: channelsFunction
      },
      
      // PATCH /channels/{channelId} - Partial update channel
      {
        method: channelResource.addMethod('PATCH', channelsIntegration),
        lambda: channelsFunction
      },
      
      // DELETE /channels/{channelId} - Delete/archive channel
      {
        method: channelResource.addMethod('DELETE', channelsIntegration),
        lambda: channelsFunction
      },
      
      // POST /channels/{channelId}/{action} - Channel actions (join, leave, claim, etc.)
      {
        method: actionResource.addMethod('POST', channelsIntegration),
        lambda: channelsFunction
      },

      // OPTIONS for CORS
      {
        method: channelsResource.addMethod('OPTIONS'),
        lambda: null
      },
      {
        method: channelResource.addMethod('OPTIONS'),
        lambda: null
      },
      {
        method: actionResource.addMethod('OPTIONS'),
        lambda: null
      }
    ];

    return methods;
  }
}

