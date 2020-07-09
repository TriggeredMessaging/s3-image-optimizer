import * as aws from 'aws-sdk';
import * as path from 'path';
import * as imagemin from 'imagemin';
import * as imageminJpegTran from 'imagemin-jpegtran';
import * as imageminPngQuant from 'imagemin-pngquant';
import * as imageminOptiPNG from 'imagemin-optipng';
import * as imageminGifSicle from 'imagemin-gifsicle';
import * as imageminSvgo from 'imagemin-svgo';
import * as fs from 'fs';
import * as os from 'os';

const s3 = new aws.S3();

// (<any>Symbol).asyncIterator = Symbol.asyncIterator || Symbol.for("Symbol.asyncIterator");
if (!process.env.SOURCE_BUCKET) {
  require('dotenv').load();
}
const SOURCE_BUCKET  = process.env.SOURCE_BUCKET;
const PREFIX         = process.env.PREFIX;
const UPLOAD_BUCKET  = process.env.UPLOAD_BUCKET;
const UPLOAD_ACL     = process.env.UPLOAD_ACL || 'public-read';
const SKIP_FILE_SIZE = +process.env.MAX_FILE_SIZE || -1;
const SKIP_PREFIX    = process.env.EXCLUDE_PREFIX || null;
const MAX_AGE        = process.env.MAX_AGE || 600;

const imageminOptions = {
  optimizationLevel: (+process.env.PNG_OPTIM_LEVEL || 7),
  progressive      : (process.env.JPG_OPTIM_PROGRESSIVE == 'true'),
  interlaced       : (process.env.GIF_OPTIM_INTERLACED == 'true')
};
const processedLog    = './processed.log'; // file containing all precessed files
const markerFile      = './.marker'; // file containing current file marker

async function optimizeImage(buf: Buffer): Promise<Buffer> {
  let optimizedData: Buffer = await imagemin.buffer(buf, {
    plugins: [
      imageminGifSicle(imageminOptions),
      imageminJpegTran(imageminOptions),
      imageminPngQuant({...imageminOptions, ... {quality: '65-100'}}),
      imageminSvgo(imageminOptions)
    ]
  });
  if (optimizedData.length - buf.length === 0) {
    // probable png not fixed by pngquant
    optimizedData = await imagemin.buffer(buf, {
      plugins: [
        imageminOptiPNG(imageminOptions)
      ]
    });
  }
  console.log('Reduction: ', Math.round(((buf.length - optimizedData.length) / buf.length)*100)  + "%");
  return optimizedData;
}

/**
 * Checks if image is an image file.
 */
function isImageFile(key: string): boolean {
  const extMatch = key.match(/\.([^.]*)$/);
  if (!extMatch) {
    console.error('Unable to infer image type for key ' + key);
    return false;
  }
  const ext = extMatch[1].toLowerCase();
  return !(ext != "jpg" && ext != "jpeg" && ext != "gif" && ext != "png" && ext != "svg");
}

export async function processOne(key: string, bucket: string = SOURCE_BUCKET) {
  key = decodeURIComponent(key.replace(/\+/g, '%20'));
  console.log(`Processing ${key}`);
  if ( path.basename(key).startsWith(SKIP_PREFIX) ) {
    console.log(`Skipping ${key} cause of prefix`);
    return;
  }
  const data = await s3.headObject({Bucket: bucket, Key: key}).promise();
  if (data.Metadata && data.Metadata.optimized) {
    console.log(`${key} already optimized. Skipping`);
    return;
  }

  if (!isImageFile(key)) {
    console.log(`${key} is not an image`);
    return;
  }

  if (!data.ContentLength) {
    console.log(`${key} is empty. Skipping.`);
    return;
  }

  if (SKIP_FILE_SIZE !== -1 && data.ContentLength > SKIP_FILE_SIZE) {
    console.log(`${key} Image is larger than configured threshold. Skipping.`);
    return;
  }

  // download
  const imageData = await s3.getObject({Bucket: bucket, Key: key}).promise();

  // optimize
  const optimizedData: Buffer = await optimizeImage(imageData.Body as any);


  console.log(`Optimized! Final file size from ${(imageData.Body as any).length} to ${optimizedData.length} - ${key}`);

  data.Metadata.optimized = 'y';

  // upload
  await s3.putObject({
    ACL        : UPLOAD_ACL,
    Bucket     : UPLOAD_BUCKET || bucket,
    Key        : key,
    Body       : optimizedData,
    ContentType: imageData.ContentType,
    CacheControl: "max-age=" + MAX_AGE,
    Metadata   : data.Metadata
  }).promise();

  console.log(`Uploaded ${key}`);

}

async function* getKeys(options: { Bucket: string, Marker: string, MaxKeys: number, Prefix: string }): AsyncIterator<string> {
  console.log(options);
  let isTruncated = true;
  let Marker      = options.Marker;
  do {
    const resp         = await s3.listObjects({...options, ...{Marker}}).promise();
    let keys: string[] = resp.Contents.map((item) => item.Key);
    isTruncated        = resp.IsTruncated;
    if (isTruncated) {
      Marker = keys[keys.length - 1];
    }
    yield* keys;
    console.log('ciao');
  } while (isTruncated);
}


function updateMarkerFile(key) {
  fs.writeFileSync(markerFile, key); // update the current market
}

function loadLastMarker() {
  if (!fs.existsSync(markerFile))
    return null;
  return fs.readFileSync(markerFile).toString();
}

export async function processAll() {




  const keysIterator = getKeys({
    Bucket : SOURCE_BUCKET,
    Marker : loadLastMarker(),
    MaxKeys: 1000,
    Prefix : PREFIX,
  });

  // Parallelize by # of cpus since tasks will spawn a different
  // process.
  await Promise.all(new Array(os.cpus().length)
    .fill(null)
    .map(async (item, idx) => {
      let run = true;
      do {
        const {value, done} = await keysIterator.next();
        if (!done) {
          await processOne(value);
          updateMarkerFile(value);
          // add to processed files log
          fs.appendFileSync(processedLog, `${value}\n`);
        }
        run = !done;
      } while (run);
      console.log(`Task ${idx} has finished`);
    }));
}
