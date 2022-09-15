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

server.onRequest('hello', (req, res) => {
  console.log('SERVER: HELLO REQUEST: ', req.data);
  res.send({message: 'ok'});
});

server.onRequest('upload', (req, res) => {
  console.log('SERVER: UPLOAD REQUEST: ', req.data);

  let buffer = '';
  req.stream!
    .on('data', (data) => {
      buffer += data.toString();
    })
    .on('end', () => {
      console.log('SERVER: UPLOAD DATA: ' + buffer);
      res.send({message: 'ok'});
    });
});

server.onRequest('download', (req, res) => {
  console.log('SERVER: DOWNLOAD REQUEST: ', req.data);
  res
    .withStream()
    .send({message: 'ok'});
  res.write('aaaaaaaaa', () => {
    res.end();
  });
});

client.request('hello', {})
  .then((res) => {
    console.log('CLIENT: HELLO RESPONSE: ', res.data);
  })
  .catch((err) => {
    console.log('CLIENT: HELLO RESPONSE: ', err);
  });

setTimeout(() => {
  client.request('download', {})
    .then((res) => {
      console.log('CLIENT: DOWNLOAD RESPONSE: ', res.data);
      let buffer: string = '';
      res.stream!
        .on('data', (data) => {
          buffer += data.toString();
        })
        .on('end', () => {
          console.log('CLIENT: DOWNLOAD PAYLOAD: ' + buffer);
        });
    })
    .catch((err) => {
      console.log('CLIENT: DOWNLOAD RESPONSE: ', err);
    });
}, 1000);


setTimeout(() => {
  const fileStream = new streams.PassThrough();

  const update = (count: number) => {
    if (count >= 10) {
      fileStream.end();
      return ;
    }
    fileStream.write('aaaaaaaaaa', () => {
      setTimeout(() => update(count + 1), 100);
    });
  }
  update(0);

  client.request('upload', {}, {
    withStream: fileStream
  })
    .then((res) => {
      console.log('CLIENT: UPLOAD RESPONSE: ', res.data);
    })
    .catch((err) => {
      console.log('CLIENT: UPLOAD RESPONSE: ', err);
    });
}, 2000);
