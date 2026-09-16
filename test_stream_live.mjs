import fetch from 'node-fetch';
const target = 'http://localhost:3000/api/xtream/stream?url=' + encodeURIComponent('http://mar10.sbs/live/Nasser0100/01008850042/533529.m3u8');

fetch(target, {
  headers: {
    'Accept': 'application/json, text/plain, */*'
  }
}).then(async res => {
  console.log('Status:', res.status, res.headers.get('content-type'));
  const text = await res.text();
  console.log('Size:', text.length, 'Body:', text.slice(0, 100));
}).catch(err => {
  console.error('Fetch error:', err);
});
