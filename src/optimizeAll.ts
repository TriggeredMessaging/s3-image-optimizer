import * as dotenv from 'dotenv';
dotenv.load();

import { processAll } from './optimizer';

processAll()
  .then(() => console.log('Finished'))
  .catch((err) => {
    console.log(err);
    console.log(err.stack);
  });