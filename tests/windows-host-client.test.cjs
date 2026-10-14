const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');

test('a broken host input pipe rejects pending requests without an unhandled stream error', async t=>{
  const child=new EventEmitter();
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const module={exports:{}};
  new Function('require','module','__dirname',fs.readFileSync(require.resolve('../src/main/windows-host-client.cjs'),'utf8'))(
    name=>name==='node:child_process'?{spawn:()=>child}:require(name),module,require('node:path').dirname(require.resolve('../src/main/windows-host-client.cjs')));
  const client=new module.exports.WindowsHostClient();t.after(()=>client.close());
  const error=Object.assign(Error('test broken pipe'),{code:'EPIPE'});
  child.stdin.write=(_text,callback)=>queueMicrotask(()=>{callback(error);child.stdin.emit('error',error);});
  await assert.rejects(client.request('system.pause-state'),/test broken pipe/);
  assert.equal(client.pending.size,0);
});
