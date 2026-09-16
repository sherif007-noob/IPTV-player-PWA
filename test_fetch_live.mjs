import fetch from 'node-fetch';
const target = 'http://localhost:3000/api/xtream/proxy?url=' + encodeURIComponent('http://mar10.sbs/player_api.php?username=Nasser0100&password=01008850042&action=get_live_streams&category_id=255');

fetch(target, {
  headers: {
    'Accept': 'application/json, text/plain, */*'
  }
}).then(async res => {
  const text = await res.text();
  const json = JSON.parse(text);
  console.log('Stream ID:', json[0].stream_id, 'Ext:', json[0].stream_type);
}).catch(err => {
  console.error('Fetch error:', err);
});
