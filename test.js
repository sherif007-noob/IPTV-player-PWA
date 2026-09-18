fetch("http://localhost:8080/api/xtream/proxy?url=http%3A%2F%2Fmar10.sbs%2Fplayer_api.php%3Fusername%3DNasser0100%26password%3D01008850042%26action%3Dget_vod_streams")
  .then(res => res.text())
  .then(text => console.log(text.slice(0, 100)))
  .catch(console.error);
