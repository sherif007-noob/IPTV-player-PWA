import fetch from 'node-fetch';
const streamUrl = 'http://mar10.sbs/hlsr/Nasser0100/01008850042/533529.ts?segment=65&p=1789533881&uid=530595&mtplay=530595z5c2saa9sf1gbzob0jq4pj9l';
fetch(streamUrl, {
  method: 'GET',
  headers: {
    'User-Agent': 'IPTVSmartersPlayer/3.0.0',
    'Accept': '*/*'
  }
}).then(res => {
  console.log(res.status);
  console.log(res.headers);
}).catch(err => {
  console.error(err);
});
