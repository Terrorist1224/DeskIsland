$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot '../src/main/windows-host.ps1'
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$errors)
if ($errors.Count) { throw 'Invalid Windows host syntax' }
$definition = $ast.FindAll({ param($node)
  $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type' -and $node.Extent.Text -like '*TypeDefinition*'
}, $true)[0]
Invoke-Expression $definition.Extent.Text
Add-Type -Path (Join-Path $PSScriptRoot '../src/main/desktop-search-clicks.cs')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class TestOnlySearchForm : Form {
  public int Clicks;
  public int Token;
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override void WndProc(ref Message message) {
    if (message.Msg == 0x8051) { Clicks++; Token = message.WParam.ToInt32(); }
    base.WndProc(ref message);
  }
}
public static class TestOnlyDesktopNative {
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] private static extern int SetWindowLong(IntPtr window, int index, int value);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] private static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);

  private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
  private static IntPtr Create() {
    IntPtr result = CreateWindowEx(0x08000080, "STATIC", "DeskIsland TEST_ONLY", 0x80000000, -30000, -30000, 80, 80, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    Check(result != IntPtr.Zero, "Cannot create isolated test HWND");return result;
  }
  public static void State(Type state) {
    var maintain = state.GetMethod("MaintainDesktopWidget");
    IntPtr host=Create(), replacement=Create(), tile=Create();
    string handle=tile.ToInt64().ToString();
    IntPtr foreground=GetForegroundWindow();
    Func<IntPtr,bool,bool> repair=(desktop,focusable)=>(bool)maintain.Invoke(null,new object[]{handle,focusable,desktop});
    try {
      Check(repair(host,false),"Initial ownership was not installed");
      Rect before,after;GetWindowRect(tile,out before);
      Check(!repair(host,false),"Healthy tile was changed");
      GetWindowRect(tile,out after);
      Check(before.Left==after.Left && before.Top==after.Top && before.Right==after.Right && before.Bottom==after.Bottom,"Geometry changed");
      Check(repair(replacement,false) && GetWindow(tile,4)==replacement,"Replacement desktop host was not bound");
      SetWindowLong(tile,-20,(GetWindowLong(tile,-20)|0x00040000)&~0x00000080);
      Check(repair(replacement,false),"Style drift was ignored");
      Check((GetWindowLong(tile,-20)&0x08040088)==0x08000080,"TOOLWINDOW/APPWINDOW/NOACTIVATE repair failed");
      Check(repair(replacement,true),"Interactive style was not restored");
      Check((GetWindowLong(tile,-20)&0x08040088)==0x80,"Interactive tile cannot accept focus");
      SetWindowPos(tile,new IntPtr(-1),0,0,0,0,0x13);
      Check(repair(replacement,true) && (GetWindowLong(tile,-20)&8)==0,"Topmost drift was ignored");
      ShowWindow(tile,7);
      Check(IsIconic(tile),"Test window did not minimize");
      Check(repair(replacement,true) && !IsIconic(tile),"Minimized tile did not recover");
      try { repair(IntPtr.Zero,true);throw new Exception("Missing desktop accepted"); }
      catch(TargetInvocationException error) { Check(error.InnerException is InvalidOperationException,"Unexpected missing-desktop error"); }
      Check(GetWindow(tile,4)==replacement,"Missing desktop destroyed ownership");
      Check(!repair(replacement,true),"Recovery retry changed a healthy tile");
      Check(GetForegroundWindow()==foreground,"Recovery stole foreground focus");
    } finally { DestroyWindow(tile);DestroyWindow(host);DestroyWindow(replacement); }
  }
  private static void Pump() { for(int i=0;i<5;i++) { Application.DoEvents();Thread.Sleep(10); } }
  private static void WaitFor(Func<bool> ready, string message) {
    // Window hit-testing and posted messages can lag Show/Pump under build load; keep a bounded assertion.
    var deadline=DateTime.UtcNow.AddSeconds(2);
    while(!ready() && DateTime.UtcNow<deadline) Pump();
    Check(ready(),message);
  }
  private static object Watch(Type clicks) { return clicks.GetField("current",BindingFlags.Static|BindingFlags.NonPublic).GetValue(null); }
  private static void Click(Type clicks, object watch, int x, int y, int awareness = -1) {
    MethodInfo method=clicks.GetMethod("OnClick",BindingFlags.Instance|BindingFlags.NonPublic);
    Type pointType=method.GetParameters()[0].ParameterType;
    object point=Activator.CreateInstance(pointType);
    pointType.GetField("X").SetValue(point,x);pointType.GetField("Y").SetValue(point,y);
    // Windows may dispatch the hook callback as DPI-unaware even when its message-loop thread is PMv2.
    IntPtr context=new IntPtr(awareness);
    IntPtr dpi=SetThreadDpiAwarenessContext(context);
    Check(dpi!=IntPtr.Zero,"Test DPI context is unavailable");
    try {
      method.Invoke(watch,new object[]{point});
      Check(AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(),context),"Click handler leaked its DPI context");
    }
    finally { if(dpi!=IntPtr.Zero) SetThreadDpiAwarenessContext(dpi); }
    Pump();
  }
  public static void Clicks(Type clicks) {
    // Enumerate monitor work areas under PMv2 too, so secondary-screen coordinates are physical.
    IntPtr dpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try { foreach(var screen in Screen.AllScreens) ClicksOnScreen(clicks,screen); }
    finally { if(dpi!=IntPtr.Zero) SetThreadDpiAwarenessContext(dpi); }
  }
  private static void ClicksOnScreen(Type clicks, Screen screen) {
    Action<string,int> start=(handle,token)=>clicks.GetMethod("Start").Invoke(null,new object[]{handle,token});
    Action<int> stop=token=>clicks.GetMethod("Stop").Invoke(null,new object[]{token});
    IntPtr dpi=SetThreadDpiAwarenessContext(new IntPtr(-4));
    var form=new TestOnlySearchForm();var covering=new TestOnlySearchForm();
    try {
      Rectangle area=screen.WorkingArea;
      form.FormBorderStyle=FormBorderStyle.None;form.StartPosition=FormStartPosition.Manual;
      form.Bounds=new Rectangle(area.Right-150,area.Bottom-110,130,90);form.TopMost=true;
      var child=new Panel();child.Bounds=new Rectangle(5,5,60,40);form.Controls.Add(child);
      form.Show();Pump();
      string handle=form.Handle.ToInt64().ToString();
      Point inside=child.PointToScreen(new Point(10,10));
      WaitFor(()=>GetAncestor(WindowFromPoint(inside),2)==form.Handle,"Test search window did not become hittable");
      start(handle,17);object first=Watch(clicks);
      int expected=0;
      foreach(int awareness in new[]{-1,-2,-3,-4,-5}) {
        Click(clicks,first,inside.X,inside.Y,awareness);
        Check(form.Clicks==expected,"Child control counted as outside in DPI context "+awareness);
        Click(clicks,first,-30000,-30000,awareness);expected++;
        WaitFor(()=>form.Clicks==expected && form.Token==17,"Outside click was not delivered in DPI context "+awareness);
      }
      covering.FormBorderStyle=FormBorderStyle.None;covering.StartPosition=FormStartPosition.Manual;
      covering.Bounds=form.Bounds;covering.TopMost=true;covering.Show();Pump();
      WaitFor(()=>GetAncestor(WindowFromPoint(inside),2)==covering.Handle,"Test covering window did not become hittable");
      Click(clicks,first,inside.X,inside.Y);expected++;WaitFor(()=>form.Clicks==expected,"Occluding window was mistaken for an inside click");
      covering.Hide();
      start(handle,18);stop(17);object second=Watch(clicks);
      Check(second!=null && !Object.ReferenceEquals(first,second),"Old stop removed new watch");
      Click(clicks,second,-30000,-30000);expected++;WaitFor(()=>form.Clicks==expected && form.Token==18,"New session token was not delivered");
      stop(18);Check(Watch(clicks)==null,"Hook did not stop");stop(18);
      try { start("0",19);throw new Exception("Invalid search HWND accepted"); }
      catch(TargetInvocationException error) { Check(error.InnerException is ArgumentException,"Unexpected invalid-HWND error"); }
    } finally {
      stop(0);covering.Dispose();form.Dispose();
      if(dpi!=IntPtr.Zero) SetThreadDpiAwarenessContext(dpi);
    }
  }
}
'@
[TestOnlyDesktopNative]::State([DeskIslandWindowState])
[TestOnlyDesktopNative]::Clicks([DeskIslandSearchClicks])
'DESKTOP_WINDOW_NATIVE_PASSED'
