import * as aws from '@pulumi/aws'

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566'

export const localstackProvider = new aws.Provider('fulfillment-localstack', {
  accessKey: process.env.AWS_ACCESS_KEY_ID ?? 'test',
  secretKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
  region: process.env.AWS_REGION ?? 'us-east-1',
  skipCredentialsValidation: true,
  skipMetadataApiCheck: true,
  skipRegionValidation: true,
  skipRequestingAccountId: true,
  endpoints: [
    {
      cloudwatchlogs: endpoint,
      iam: endpoint,
      lambda: endpoint,
      sns: endpoint,
      sqs: endpoint,
      sts: endpoint,
    },
  ],
})
