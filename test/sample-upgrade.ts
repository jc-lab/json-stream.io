import * as io from '../src';
import * as streams from 'stream';

function newAsyncStream(): streams.Transform {
  return new streams.Transform({
    transform(chunk, encoding, callback) {
      setImmediate(() => {
        this.push(chunk, encoding);
        callback();
      });
    }
  });
}

const server = new io.Server();
const client = new io.Client();

server
  .pipe(newAsyncStream())
  .pipe(client)
  .pipe(newAsyncStream())
  .pipe(server);

server.onRequest('do-upgrade', (req, res) => {
  const passthrough = new streams.PassThrough();
  console.log('SERVER: DO_UPGRADE REQUEST: ', req.data);
  res
    .withUpgrade(passthrough, passthrough)
    .send({message: 'ok'});
});

client.on('upgrade', (stream) => {
  const next = (count: number) => {
    if (count >= 10) {
      return ;
    }
    stream.write('hello world', () => {
      next(count + 1);
    });
  }
  next(0);

  stream.on('data', (data) => {
    console.log('CLIENT: UPGRADED: ', data.toString());
  });
});
client.request('do-upgrade', {})
  .then((res) => {
    console.log('CLIENT: DO_UPGRADE RESPONSE: ', res.data);
  })
  .catch((err) => {
    console.log('CLIENT: DO_UPGRADE RESPONSE: ', err);
  });
