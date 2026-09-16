import fetch from 'node-fetch';
const targetMkv = 'http://mar10.sbs/movie/Nasser0100/01008850042/625340.mkv';
const targetMp4 = 'http://mar10.sbs/movie/Nasser0100/01008850042/625340.mp4';
const resMkv = await fetch(targetMkv, { method: 'HEAD', headers: { 'Accept': '*/*' } });
console.log('MKV Status:', resMkv.status);
const resMp4 = await fetch(targetMp4, { method: 'HEAD', headers: { 'Accept': '*/*' } });
console.log('MP4 Status:', resMp4.status);
