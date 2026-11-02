// macOS 14+ background removal with Apple's Vision framework ("lift subject from background").
// Usage: osascript -l JavaScript mac-subject-lift.js <input image> <output png>
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('Vision');
ObjC.import('CoreImage');

function run(argv) {
  var url = $.NSURL.fileURLWithPath(argv[0]);
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  var req = $.VNGenerateForegroundInstanceMaskRequest.alloc.init;
  var err = Ref();
  if (!handler.performRequestsError($.NSArray.arrayWithObject(req), err)) throw new Error('Vision request failed');
  var results = req.results;
  if (!results || results.count === 0) throw new Error('No subject found in the photo');
  var obs = results.objectAtIndex(0);
  var buffer = obs.generateMaskedImageOfInstancesFromRequestHandlerCroppedToInstancesExtentError(obs.allInstances, handler, false, err);
  if (!buffer) throw new Error('Could not create the cut-out');
  var ci = $.CIImage.imageWithCVPixelBuffer(buffer);
  var rep = $.NSBitmapImageRep.alloc.initWithCIImage(ci);
  var png = rep.representationUsingTypeProperties(4 /* PNG */, $.NSDictionary.dictionary);
  png.writeToFileAtomically(argv[1], true);
  return 'ok';
}
