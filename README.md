# json-stream.io

json-stream.io is a JSON-based Request-Response protocol, and the protocol can be upgraded to another stream .

# Installation

**YARN**

```bash
$ yarn add json-protocol-stream
```

**NPM**

```bash
$ npm install --save json-protocol-stream
```

# Usage

```typescript
const server = new Server();
socket.pipe(server).pipe(socket);
server.onRequest('hello', (request, response) => {
  const {data, stream} = request.data;
  
  // General JSON
  console.log(data);
  
  // With Stream
  stream.pipe(process.stdout);
  
  // send general JSON response
  response
    .send({...});
  
  // send and upgrade protocol after send response
  response
    .withUpgrade(otherWritable, otherReadable) // upgrade protocol after send response
    .send({...});
});

const client = new Client();
socket.pipe(client).pipe(socket);
client.request('hello', {...data...}, {
  withStream: readableStream /* optional, you can also file upload */
})
  .then((res) => {
    // res.data
    // res.stream
  });
client.on('upgrade', (stream) => {
  // use stream
});

```

# License

Apache-2.0
