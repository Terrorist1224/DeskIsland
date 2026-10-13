using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class DeskIslandShellIcon {
  [StructLayout(LayoutKind.Sequential)]
  private struct Size { public int Width, Height; }
  [StructLayout(LayoutKind.Sequential)]
  private struct BitmapInfo { public int Type, Width, Height, WidthBytes; public ushort Planes, BitsPixel; public IntPtr Bits; }
  [StructLayout(LayoutKind.Sequential)]
  private struct DibHeader {
    public uint Size; public int Width, Height; public ushort Planes, BitCount;
    public uint Compression, ImageSize; public int XPixels, YPixels; public uint ColorsUsed, ColorsImportant;
  }
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface ImageFactory {
    [PreserveSig] int GetImage(Size size, uint flags, out IntPtr bitmap);
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out ImageFactory factory);
  [DllImport("gdi32.dll", EntryPoint = "GetObjectW")]
  private static extern int GetObject(IntPtr bitmap, int size, out BitmapInfo info);
  [DllImport("gdi32.dll")]
  private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint start, uint lines, byte[] pixels, ref DibHeader header, uint usage);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr bitmap);
  [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);

  public static string Read(string path, int pixels) {
    if (!Path.IsPathRooted(path) || (!File.Exists(path) && !Directory.Exists(path))) throw new ArgumentException("Icon item does not exist.");
    if (pixels < 16 || pixels > 512) throw new ArgumentOutOfRangeException("pixels");
    ImageFactory factory = null;
    IntPtr bitmap = IntPtr.Zero, dc = IntPtr.Zero;
    try {
      Guid iid = typeof(ImageFactory).GUID;
      SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out factory);
      // Run on the hidden worker: ICONONLY avoids thumbnails; BIGGERSIZEOK retains higher-resolution assets.
      Marshal.ThrowExceptionForHR(factory.GetImage(new Size { Width = pixels, Height = pixels }, 0x5, out bitmap));
      BitmapInfo info;
      if (bitmap == IntPtr.Zero || GetObject(bitmap, Marshal.SizeOf(typeof(BitmapInfo)), out info) == 0) throw new InvalidOperationException("Cannot read icon bitmap.");
      if (info.Width < 1 || info.Width > 1024 || info.Height < 1 || info.Height > 1024) throw new InvalidOperationException("Invalid icon dimensions.");
      dc = GetDC(IntPtr.Zero);
      if (dc == IntPtr.Zero) throw new InvalidOperationException("Cannot acquire icon drawing context.");
      byte[] data = new byte[checked(info.Width * info.Height * 4)];
      DibHeader header = new DibHeader { Size = 40, Width = info.Width, Height = -info.Height, Planes = 1, BitCount = 32 };
      if (GetDIBits(dc, bitmap, 0, (uint)info.Height, data, ref header, 0) != info.Height) throw new InvalidOperationException("Cannot read icon pixels.");
      return Encode(data, info.Width, info.Height);
    } finally {
      if (dc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, dc);
      if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
      if (factory != null) Marshal.ReleaseComObject(factory);
    }
  }

  public static string Encode(byte[] data, int width, int height) {
    if (width < 1 || width > 1024 || height < 1 || height > 1024 || data == null || data.Length != width * height * 4) throw new ArgumentException("Invalid icon pixels.");
    // Shell HBITMAP contains premultiplied BGRA; FromHbitmap drops alpha and produces opaque icon backgrounds.
    using (Bitmap image = new Bitmap(width, height, PixelFormat.Format32bppPArgb)) {
      BitmapData locked = image.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
      try {
        for (int row = 0; row < height; row++) Marshal.Copy(data, row * width * 4, IntPtr.Add(locked.Scan0, row * locked.Stride), width * 4);
      } finally { image.UnlockBits(locked); }
      using (MemoryStream output = new MemoryStream()) {
        image.Save(output, ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(output.ToArray());
      }
    }
  }
}
