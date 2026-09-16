fetch('http://localhost:3000/api/xtream/stream?url=http%3A%2F%2Fmar10.sbs%2Fmovie%2FNasser0100%2F01008850042%2F625340.mkv')
  .then(res => console.log(res.status))
  .catch(err => console.log(err));
