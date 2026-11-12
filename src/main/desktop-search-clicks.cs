using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

// The PowerShell request loop blocks on stdin; low-level hooks need their own pumping thread.
public sealed class DeskIslandSearchClicks {
  private const uint OutsideClickMessage = 0x8051; // WM_APP + 0x51, shared with desktop-search.cjs.
  private static DeskIslandSearchClicks current;
  private readonly IntPtr target;
  private readonly int token;
  private readonly Thread thread;
  private readonly ManualResetEvent ready = new ManualResetEvent(false);
  private Exception startupError;
  private volatile uint threadId;
  private volatile bool stopping;
  private HookProc callback;

  [StructLayout(LayoutKind.Sequential)]
  private struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)]
  private struct Message {
    public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam;
    public uint Time; public Point Position; public uint Private;
  }
  private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
  [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);

  private DeskIslandSearchClicks(IntPtr target, int token) {
    this.target = target;
    this.token = token;
    thread = new Thread(Run);
    thread.IsBackground = true;
  }

  public static void Start(string handle, int token) {
    IntPtr target = new IntPtr(long.Parse(handle));
    if (!IsWindow(target) || token <= 0) throw new ArgumentException("Invalid search window or session.");
    Stop(0);
    var watch = new DeskIslandSearchClicks(target, token);
    current = watch;
    watch.thread.Start();
    if (!watch.ready.WaitOne(3000)) {
      Stop(token);
      throw new TimeoutException("Search outside-click listener did not start.");
    }
    if (watch.startupError != null) {
      Exception error = watch.startupError;
      Stop(token);
      throw new InvalidOperationException("Cannot watch search outside clicks.", error);
    }
  }

  public static void Stop(int token) {
    var watch = current;
    if (watch == null || (token != 0 && token != watch.token)) return;
    watch.stopping = true;
    if (watch.thread.IsAlive) {
      if (watch.threadId != 0) PostThreadMessage(watch.threadId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
      if (!watch.thread.Join(2000)) throw new TimeoutException("Search click listener did not stop.");
    }
    current = null;
    watch.ready.Dispose();
  }

  private void Run() {
    IntPtr hook = IntPtr.Zero;
    IntPtr previousDpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      Message message;
      PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Create the queue before Stop can post WM_QUIT.
      threadId = GetCurrentThreadId();
      if (stopping) return;
      callback = OnMouse;
      hook = SetWindowsHookEx(14, callback, GetModuleHandle(null), 0); // WH_MOUSE_LL.
      if (hook == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      ready.Set();
      while (!stopping && GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
    } catch (Exception error) { startupError = error; }
    finally {
      if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
      if (previousDpi != IntPtr.Zero) SetThreadDpiAwarenessContext(previousDpi);
      ready.Set();
    }
  }

  private void OnClick(Point point) {
    IntPtr hit = WindowFromPoint(point);
    if (GetAncestor(hit, 2) != target) PostMessage(target, OutsideClickMessage, new IntPtr(token), IntPtr.Zero);
  }

  private IntPtr OnMouse(int code, IntPtr message, IntPtr data) {
    int id = message.ToInt32();
    if (code >= 0 && (id == 0x0201 || id == 0x0204 || id == 0x0207 || id == 0x020B)) {
      // Hook points and WindowFromPoint are physical pixels on this PMv2 thread, including negative monitors.
      Point point = (Point)Marshal.PtrToStructure(data, typeof(Point));
      OnClick(point);
    }
    return CallNextHookEx(IntPtr.Zero, code, message, data); // Observe only; never swallow clicks.
  }
}
