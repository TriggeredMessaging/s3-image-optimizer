import { Handler, Context, Callback, S3CreateEvent } from 'aws-lambda';
import { processOne } from './optimizer';

export const optimize: Handler = async (event: S3CreateEvent, context: Context, callback: Callback) => {
  try {
    await Promise.all(event.Records.map(async (r) => {
      const bucket = r.s3.bucket;
      const key = r.s3.object.key;
      await processOne(key, bucket.name);
    }));
    callback(null, 'ok');
  } catch (err) {
    return callback(err);
  }
};