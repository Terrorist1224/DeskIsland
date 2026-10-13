using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// PolicyConfig is an undocumented Windows COM interface. Vtable order must not change.
// Declaration adapted from frgnca/AudioDeviceCmdlets (MIT); see THIRD_PARTY_NOTICES.md.
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] internal class PolicyConfigClient { }
[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, bool def, IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format, IntPtr mix);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, bool def, IntPtr period, IntPtr minimum);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr period);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, bool fx, IntPtr key, IntPtr value);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, bool fx, IntPtr key, IntPtr value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, Role role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, bool visible);
}

// Frame positions are 48 kHz stereo, on one monotonic clock. Keep two seconds of bounded audio.
public sealed class AudioTimeline {
  public const int Rate = 48000;
  private readonly float[] samples = new float[Rate * 4];
  private readonly long[] positions = new long[Rate * 2];
  private readonly object gate = new object();
  private long endFrame = -1;
  public AudioTimeline() { for (int i=0;i<positions.Length;i++) positions[i]=-1; }
  public void Add(float[] data, int count, long observedEnd) {
    int frames=count/2;
    long start=Math.Max(0, observedEnd-frames);
    // Align packet runs, but re-anchor after silence or clock drift exceeding 20 ms.
    if(endFrame>=0 && Math.Abs(start-endFrame)<Rate/50) start=endFrame;
    lock(gate) {
      for(int i=0;i<frames;i++) { long frame=start+i;int slot=(int)(frame%positions.Length);samples[slot*2]=data[i*2];samples[slot*2+1]=data[i*2+1];positions[slot]=frame; }
      endFrame=start+frames;
    }
  }
  public void Read(long start, float[] result, int frames) {
    lock(gate) { for(int i=0;i<frames;i++) {long frame=start+i;int slot=(int)(frame%positions.Length);bool present=frame>=endFrame-positions.Length&&positions[slot]==frame;result[i*2]=present?samples[slot*2]:0;result[i*2+1]=present?samples[slot*2+1]:0;} }
  }
  public static short Mix(float a, float b) { return (short)(Math.Max(-1,Math.Min(1,(a+b)*0.5f))*32767); }
}

internal sealed class StereoSource : ISampleProvider {
  private readonly ISampleProvider source;
  private float[] buffer = new float[0];
  public WaveFormat WaveFormat {get;private set;}
  public StereoSource(ISampleProvider source) {this.source=source;WaveFormat=WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate,2);}
  public int Read(float[] target,int offset,int count) {
    if(count==0) return 0;
    int channels=source.WaveFormat.Channels, needed=count/2*channels;
    if(buffer.Length<needed) buffer=new float[needed];
    int read=source.Read(buffer,0,needed),frames=read/channels;
    for(int i=0;i<frames;i++) {
      float left=0,right=0;
      if(channels==1) left=right=buffer[i];
      else {int leftCount=0,rightCount=0;for(int c=0;c<channels;c++){if(c%2==0){left+=buffer[i*channels+c];leftCount++;}else{right+=buffer[i*channels+c];rightCount++;}}left/=leftCount;right/=rightCount;}
      target[offset+i*2]=left;target[offset+i*2+1]=right;
    }
    return frames*2;
  }
}

internal sealed class CaptureInput {
  public readonly AudioTimeline Timeline = new AudioTimeline();
  private readonly BufferedWaveProvider bytes;
  private readonly ISampleProvider source;
  private readonly Stopwatch clock;
  private double remainder;
  public CaptureInput(WasapiCapture capture,Stopwatch clock) {
    this.clock=clock;bytes=new BufferedWaveProvider(capture.WaveFormat){BufferDuration=TimeSpan.FromSeconds(2),ReadFully=true};
    ISampleProvider stereo=new StereoSource(bytes.ToSampleProvider());
    source=stereo.WaveFormat.SampleRate==AudioTimeline.Rate?stereo:new WdlResamplingSampleProvider(stereo,AudioTimeline.Rate);
    capture.DataAvailable+=Receive;
  }
  private void Receive(object sender,WaveInEventArgs args) {
    if(args.BytesRecorded==0) return;
    lock(bytes) {
      bytes.AddSamples(args.Buffer,0,args.BytesRecorded);
      double exact=args.BytesRecorded/(double)bytes.WaveFormat.BlockAlign*AudioTimeline.Rate/bytes.WaveFormat.SampleRate+remainder;
      int frames=(int)exact;remainder=exact-frames;if(frames==0) return;
      float[] data=new float[frames*2];int read=source.Read(data,0,data.Length);
      Timeline.Add(data,read,(long)(clock.Elapsed.TotalSeconds*AudioTimeline.Rate));
    }
  }
}

public sealed class DeskIslandAudio : IDisposable {
  private WasapiCapture mic,system;
  private MMDevice micDevice,outputDevice;
  private CaptureInput micInput,systemInput;
  private readonly Stopwatch clock=new Stopwatch();
  private Thread pump;
  private volatile bool finishing;
  private volatile bool stopping;
  private volatile string failure;
  private long stopFrames;
  private string inputId,outputId;
  private double elapsedMs;
  private readonly object meterGate=new object();
  private readonly float[] levels=new float[20];
  private int meterPosition;
  public bool Recording {get;private set;}
  public string Failure {get{return failure;}}
  public double ElapsedMs {get{return Recording?clock.Elapsed.TotalMilliseconds:elapsedMs;}}
  private static MMDevice Default(MMDeviceEnumerator devices,DataFlow flow,Role role) {try{return devices.GetDefaultAudioEndpoint(flow,role);}catch(COMException){return null;}}
  private static IDictionary DefaultIds(MMDeviceEnumerator devices,DataFlow flow) {
    var result=new Hashtable();foreach(Role role in new[]{Role.Console,Role.Multimedia,Role.Communications}) using(var device=Default(devices,flow,role)) result[role.ToString()]=device==null?null:device.ID;return result;
  }
  public IDictionary Snapshot() {
    using(var devices=new MMDeviceEnumerator()) {
      var inputs=new List<object>();var outputs=new List<object>();
      foreach(DataFlow flow in new[]{DataFlow.Capture,DataFlow.Render}) foreach(var device in devices.EnumerateAudioEndPoints(flow,DeviceState.Active)) {
        using(device) (flow==DataFlow.Capture?inputs:outputs).Add(new Hashtable{{"id",device.ID},{"name",device.FriendlyName}});
      }
      using(var input=Default(devices,DataFlow.Capture,Role.Communications)) using(var output=Default(devices,DataFlow.Render,Role.Multimedia)) {
        string currentInput=input==null?null:input.ID,currentOutput=output==null?null:output.ID;
        return new Hashtable{{"inputs",inputs.ToArray()},{"outputs",outputs.ToArray()},{"inputId",currentInput},{"outputId",currentOutput},{"inputDefaults",DefaultIds(devices,DataFlow.Capture)},{"outputDefaults",DefaultIds(devices,DataFlow.Render)},{"volume",output==null?(object)null:(int)Math.Round(output.AudioEndpointVolume.MasterVolumeLevelScalar*100)},{"elapsedMs",ElapsedMs},{"recording",Recording},{"failure",failure},{"devicesChanged",Recording&&(currentInput!=inputId||currentOutput!=outputId)}};
      }
    }
  }
  public IDictionary Meter() {
    lock(meterGate) {
      var recent=new float[levels.Length];
      for(int i=0;i<recent.Length;i++) recent[i]=Recording?levels[(meterPosition+i)%levels.Length]:0;
      return new Hashtable{{"levels",recent},{"elapsedMs",ElapsedMs}};
    }
  }
  public static float PcmLevel(byte[] pcm,int count) {
    double sum=0;
    for(int i=0;i<count;i+=2) {double sample=(short)(pcm[i]|pcm[i+1]<<8)/32768.0;sum+=sample*sample;}
    return count==0?0:(float)Math.Sqrt(sum/(count/2));
  }
  public int SetVolume(double volume) {
    if(Double.IsNaN(volume)||Double.IsInfinity(volume)||volume<0||volume>100) throw new ArgumentException("音量必须在 0 到 100 之间");
    using(var devices=new MMDeviceEnumerator()) using(var output=devices.GetDefaultAudioEndpoint(DataFlow.Render,Role.Multimedia)) {
      output.AudioEndpointVolume.MasterVolumeLevelScalar=(float)(volume/100);if(volume>0) output.AudioEndpointVolume.Mute=false;
      return (int)Math.Round(output.AudioEndpointVolume.MasterVolumeLevelScalar*100);
    }
  }
  public void SetDefault(string kind,string id) {
    if(Recording) throw new InvalidOperationException("录音时不能切换设备");
    if(kind!="input"&&kind!="output") throw new ArgumentException("设备方向无效");
    using(var devices=new MMDeviceEnumerator()) using(var device=devices.GetDevice(id)) {
      var flow=kind=="input"?DataFlow.Capture:DataFlow.Render;
      if(device.State!=DeviceState.Active||device.DataFlow!=flow) throw new ArgumentException("设备不可用或方向不符");
      object policyObject=new PolicyConfigClient();var policy=(IPolicyConfig)policyObject;
      var previous=new Dictionary<Role,string>();
      try {
        foreach(Role role in new[]{Role.Console,Role.Multimedia,Role.Communications}) using(var old=Default(devices,flow,role)) previous[role]=old==null?null:old.ID;
        SetRoles(id,previous,(target,role)=>Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(target,role)));
      } finally {Marshal.ReleaseComObject(policyObject);}
    }
  }
  public static void SetRoles(string id,Dictionary<Role,string> previous,Action<string,Role> apply) {
    try {foreach(Role role in previous.Keys) apply(id,role);}
    catch(Exception original) {
      var failures=new List<Exception>{original};
      foreach(var item in previous) if(item.Value!=null) try{apply(item.Value,item.Key);}catch(Exception error){failures.Add(error);}
      if(failures.Count>1) throw new AggregateException("设备切换失败，部分默认角色未能恢复，请检查 Windows 声音设置",failures);
      throw;
    }
  }
  public void Start(string file) {
    if(Recording||pump!=null) throw new InvalidOperationException("已有录音正在处理");
    failure=null;finishing=false;stopping=false;elapsedMs=0;
    lock(meterGate) {Array.Clear(levels,0,levels.Length);meterPosition=0;}
    try {
      using(var devices=new MMDeviceEnumerator()) {micDevice=devices.GetDefaultAudioEndpoint(DataFlow.Capture,Role.Communications);outputDevice=devices.GetDefaultAudioEndpoint(DataFlow.Render,Role.Multimedia);}
      inputId=micDevice.ID;outputId=outputDevice.ID;
      mic=new WasapiCapture(micDevice);system=new WasapiLoopbackCapture(outputDevice);
      micInput=new CaptureInput(mic,clock);systemInput=new CaptureInput(system,clock);
      mic.RecordingStopped+=CaptureStopped;system.RecordingStopped+=CaptureStopped;
      clock.Restart();mic.StartRecording();system.StartRecording();Recording=true;
      pump=new Thread(()=>Write(file)){IsBackground=true,Name="DeskIsland audio writer"};pump.Start();
    } catch {Stop();throw;}
  }
  private void CaptureStopped(object sender,StoppedEventArgs args) {if(!stopping){failure=args.Exception==null?"录音设备已停止":args.Exception.Message;if(args.Exception!=null) Console.Error.WriteLine(args.Exception);}}
  private void Write(string file) {
    try {
      using(var stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.Read)) {
        float[] a=new float[1920],b=new float[1920];byte[] pcm=new byte[3840];long written=0;
        while(true) {
          // 200 ms staging lets packets from both WASAPI devices arrive before committing frames.
          long target=finishing?stopFrames:Math.Max(0,(long)(clock.Elapsed.TotalSeconds*AudioTimeline.Rate)-AudioTimeline.Rate/5);
          while(written<target) {
            int frames=(int)Math.Min(960,target-written);micInput.Timeline.Read(written,a,frames);systemInput.Timeline.Read(written,b,frames);
            for(int i=0;i<frames*2;i++){short value=AudioTimeline.Mix(a[i],b[i]);pcm[i*2]=(byte)value;pcm[i*2+1]=(byte)(value>>8);}
            stream.Write(pcm,0,frames*4);written+=frames;
            // Meter the exact 48 kHz stereo PCM written to disk; 20 bins hold about 400 ms.
            lock(meterGate) {levels[meterPosition]=PcmLevel(pcm,frames*4);meterPosition=(meterPosition+1)%levels.Length;}
          }
          stream.Flush();if(finishing) break;Thread.Sleep(20);
        }
        stream.Flush(true);
      }
    } catch(Exception error) {failure=error.Message;Console.Error.WriteLine(error);}
  }
  public void Stop() {
    elapsedMs=clock.Elapsed.TotalMilliseconds;stopFrames=(long)(elapsedMs*AudioTimeline.Rate/1000);stopping=true;
    Exception stopError=null;
    foreach(var capture in new[]{mic,system}) if(capture!=null) try{capture.StopRecording();capture.Dispose();}catch(Exception error){stopError=error;}
    finishing=true;
    if(pump!=null&&!pump.Join(5000)) throw new TimeoutException("录音写入未结束，临时文件已保留");
    pump=null;mic=null;system=null;clock.Stop();Recording=false;
    if(micDevice!=null) micDevice.Dispose();if(outputDevice!=null) outputDevice.Dispose();micDevice=null;outputDevice=null;
    if(stopError!=null) failure=stopError.Message;
  }
  public void Dispose(){Stop();}
}
