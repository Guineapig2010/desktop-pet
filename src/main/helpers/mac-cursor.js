// macOS cursor mover for the optional "cursor restraint" gag. Reads "x y" lines on stdin and
// moves the pointer there. Exits when stdin closes. No permission is needed to move the cursor.
ObjC.import('Foundation');
ObjC.import('CoreGraphics');

function run() {
  var input = $.NSFileHandle.fileHandleWithStandardInput;
  var buf = '';
  while (true) {
    var data = input.availableData;
    if (!data || data.length === 0) return;
    buf += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    var lines = buf.split('\n');
    buf = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var p = lines[i].trim().split(/\s+/);
      if (p.length === 2) $.CGWarpMouseCursorPosition({ x: parseFloat(p[0]), y: parseFloat(p[1]) });
    }
  }
}
