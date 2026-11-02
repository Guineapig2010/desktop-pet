// macOS window tracker (JavaScript for Automation). Prints one JSON line per tick with the
// on-screen windows, front to back. Window *bounds* need no special permission.
ObjC.import('Foundation');
ObjC.import('CoreGraphics');

function run(argv) {
  var interval = parseFloat(argv[0] || '0.1');
  var out = $.NSFileHandle.fileHandleWithStandardOutput;
  var last = '';
  var quietTicks = 0;
  while (true) {
    var list = [];
    try {
      // kCGWindowListOptionOnScreenOnly (1) | kCGWindowListExcludeDesktopElements (16)
      var ref = $.CGWindowListCopyWindowInfo(1 | 16, 0);
      var arr = ObjC.deepUnwrap(ObjC.castRefToObject(ref)) || [];
      for (var i = 0; i < arr.length; i++) {
        var w = arr[i];
        if (w.kCGWindowLayer !== 0) continue;
        if (w.kCGWindowAlpha !== undefined && w.kCGWindowAlpha < 0.05) continue;
        var b = w.kCGWindowBounds;
        if (!b || b.Width < 100 || b.Height < 60) continue;
        list.push({ id: w.kCGWindowNumber, pid: w.kCGWindowOwnerPID, owner: w.kCGWindowOwnerName || '', x: Math.round(b.X), y: Math.round(b.Y), w: Math.round(b.Width), h: Math.round(b.Height) });
      }
    } catch (e) {
      list = { error: String(e) };
    }
    var line = JSON.stringify({ w: list });
    // only print when something changed (plus a heartbeat every ~2 s)
    if (line !== last || ++quietTicks > 20) {
      quietTicks = 0;
      last = line;
      out.writeData($(line + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    }
    delay(interval);
  }
}
