import fetch from 'node-fetch';
const streamUrl = 'http://mar10.sbs/movie/Nasser0100/01008850042/625340.mkv';
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
