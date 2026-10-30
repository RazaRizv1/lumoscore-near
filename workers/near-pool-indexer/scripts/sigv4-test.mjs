// SigV4 check against AWS's published example ("Create a signed AWS API request", IAM ListUsers):
//   GET https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08, 20150830T123600Z, us-east-1, iam,
//   secret wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY
//   expected signature 5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7
import { sign } from '../src/s3.js';
const { signature, headers } = await sign({
  method: 'GET', host: 'iam.amazonaws.com', path: '/', query: { Action: 'ListUsers', Version: '2010-05-08' },
  headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
  region: 'us-east-1', service: 'iam', accessKey: 'AKIDEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  amzDate: '20150830T123600Z',
});
const want = '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7';
console.log(signature === want ? 'SIGV4 OK' : 'SIGV4 MISMATCH\n got  ' + signature + '\n want ' + want);
console.log(headers.authorization);
process.exit(signature === want ? 0 : 1);
